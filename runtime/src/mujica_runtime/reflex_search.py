from __future__ import annotations

from pathlib import Path
from typing import Any

import mujoco
import numpy as np

from .controllers import (
    FrozenPolicyController,
    load_policy_controller,
    program_residual_scale_vector,
)
from .environment import RobotEnvironment
from .io import hash_json
from .simulation import has_disallowed_self_contact, minimum_joint_limit_margin
from .training import compile_bilateral_symmetry


def _finite_float(value: Any, name: str, minimum: float, maximum: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise RuntimeError(f"Reflex Search {name} must be numeric")
    resolved = float(value)
    if not np.isfinite(resolved) or resolved < minimum or resolved > maximum:
        raise RuntimeError(
            f"Reflex Search {name} must be within [{minimum}, {maximum}]"
        )
    return resolved


def _positive_int(value: Any, name: str, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise RuntimeError(f"Reflex Search {name} must be an integer")
    if value < 1 or value > maximum:
        raise RuntimeError(f"Reflex Search {name} must be within [1, {maximum}]")
    return value


def _candidate_deltas(
    action_size: int,
    axes: list[int],
    segments: int,
    samples: int,
    maximum_delta: float,
    seed: int,
) -> list[np.ndarray]:
    candidates = [np.zeros((segments, action_size), dtype=np.float64)]
    for axis in axes:
        for sign in (-1.0, 1.0):
            candidate = np.zeros((segments, action_size), dtype=np.float64)
            candidate[:, axis] = sign * maximum_delta
            candidates.append(candidate)
            if len(candidates) >= samples:
                return candidates
    rng = np.random.default_rng(seed)
    while len(candidates) < samples:
        candidate = np.zeros((segments, action_size), dtype=np.float64)
        values = rng.uniform(
            -maximum_delta,
            maximum_delta,
            size=(segments, len(axes)),
        )
        candidate[:, axes] = values
        candidates.append(candidate)
    return candidates


def _state_fingerprint(
    environment: RobotEnvironment,
    controller: FrozenPolicyController,
) -> str:
    telemetry = controller.telemetry()
    return hash_json({
        "step": environment.step_index,
        "time": float(environment.data.time),
        "qpos": environment.data.qpos.tolist(),
        "qvel": environment.data.qvel.tolist(),
        "actuatorForce": environment.data.actuator_force.tolist(),
        "lastCommandedAction": environment.last_commanded_action.tolist(),
        "lastAppliedAction": environment.last_applied_action.tolist(),
        "commandHistory": [value.tolist() for value in environment.command_history],
        "appliedHistory": [value.tolist() for value in environment.applied_history],
        "delayQueue": [value.tolist() for value in environment.delay],
        "missionPhase": environment.mission_phase_index,
        "missionPhaseEnteredStep": environment.mission_phase_entered_step,
        "runtimeState": environment.runtime_state(),
        "controllerTelemetry": {
            key: value
            for key, value in telemetry.items()
            if key not in ("policyActorMeanL2", "policyRawActionL2")
        },
    })


def _external_push(scenario: dict[str, Any]) -> dict[str, Any]:
    push = scenario.get("externalPush")
    if push is None:
        legacy = scenario.get("lateralPush")
        if legacy is None:
            raise RuntimeError(
                f"Reflex Search Scenario '{scenario['id']}' has no external push"
            )
        force = float(legacy["forceNewton"])
        return {
            "timeSeconds": float(legacy["timeSeconds"]),
            "durationSeconds": float(legacy["durationSeconds"]),
            "directionXY": [0.0, 1.0 if force >= 0.0 else -1.0],
        }
    direction = np.asarray(push["directionXY"], dtype=np.float64)
    if direction.shape != (2,) or abs(float(direction[1])) <= 1e-9:
        raise RuntimeError(
            f"Reflex Search Scenario '{scenario['id']}' requires a lateral push"
        )
    return {
        "timeSeconds": float(push["timeSeconds"]),
        "durationSeconds": float(push["durationSeconds"]),
        "directionXY": direction.tolist(),
    }


def _run_case(
    request: dict[str, Any],
    case: dict[str, Any],
    canonical_delta: np.ndarray,
    mirrored_delta: np.ndarray,
    apply_override: bool,
    reflex_duration: float,
    outcome_horizon: float,
) -> dict[str, Any]:
    scenario = case["scenario"]
    push = _external_push(scenario)
    positive_side = float(push["directionXY"][1]) > 0.0
    candidate_delta = canonical_delta if positive_side else mirrored_delta
    controller = load_policy_controller(
        Path(request["projectDir"]),
        request["controller"],
        request["compiled"],
    )
    controller.reset(int(case["seed"]))
    if not isinstance(controller, FrozenPolicyController):
        raise RuntimeError("Reflex Search requires a frozen Policy Controller")
    environment = RobotEnvironment(
        Path(request["modelPath"]),
        request["compiled"],
        case["task"],
        scenario,
        int(case["seed"]),
    )
    observation_map = environment.reset()
    push_start = float(push["timeSeconds"])
    push_end = push_start + float(push["durationSeconds"])
    reflex_end = push_start + reflex_duration
    outcome_end = push_end + outcome_horizon
    pre_trigger_hash: str | None = None
    demonstrations: list[dict[str, Any]] = []
    minimum_margin = float("inf")
    disallowed_self_contact_steps = 0
    maximum_body_tilt = 0.0
    maximum_angular_speed = 0.0
    maximum_lateral_speed = 0.0
    maximum_recovery_progress = 0.0
    recovery_target_entry_count = 0
    previous_target_satisfied = False
    outcome_tracking_started = False
    override_authority_steps = 0
    override_authority_sum = 0.0
    override_action_l2_sum = 0.0
    previous_raw_action: np.ndarray | None = None
    override_action_slew_sum = 0.0
    while float(environment.data.time) < outcome_end - 1e-9:
        now = float(environment.data.time)
        if pre_trigger_hash is None and now + 1e-9 >= push_start:
            pre_trigger_hash = _state_fingerprint(environment, controller)
        runtime_state_provider = getattr(controller, "set_runtime_state", None)
        if runtime_state_provider is not None:
            runtime_state_provider(environment.runtime_state())
        delta: np.ndarray | None = None
        segment_index: int | None = None
        if apply_override and push_start <= now < reflex_end:
            fraction = (now - push_start) / max(reflex_duration, 1e-9)
            segment_index = min(
                candidate_delta.shape[0] - 1,
                int(np.floor(fraction * candidate_delta.shape[0])),
            )
            delta = candidate_delta[segment_index]
        observation_vector = environment.vector(observation_map)
        action = controller.act_with_raw_delta(observation_map, now, delta)
        gate_scale = float(controller.last_residual_gate_scale)
        if (
            delta is not None
            and gate_scale > 0.0
            and controller.last_actor_mean is not None
            and controller.last_raw_action is not None
        ):
            raw_action = controller.last_raw_action.copy()
            intervention = bool(np.any(np.abs(delta) > 1e-12))
            demonstrations.append({
                "case": case["id"],
                "scenario": scenario["id"],
                "seed": int(case["seed"]),
                "side": "positive-y" if positive_side else "negative-y",
                "role": (
                    "counterfactual-teacher"
                    if intervention
                    else "frozen-policy-anchor"
                ),
                "timeSeconds": now,
                "segment": int(segment_index or 0),
                "gateScale": gate_scale,
                "observation": observation_vector.tolist(),
                "baselineActorMean": controller.last_actor_mean.tolist(),
                "rawAction": raw_action.tolist(),
            })
            if intervention:
                override_authority_steps += 1
                override_authority_sum += gate_scale
                override_action_l2_sum += float(np.linalg.norm(raw_action))
                if previous_raw_action is not None:
                    override_action_slew_sum += float(
                        np.linalg.norm(raw_action - previous_raw_action)
                    )
                previous_raw_action = raw_action
        result = environment.step(action)
        observation_map = result.observation
        after_step = float(environment.data.time)
        if after_step + 1e-9 >= push_start:
            minimum_margin = min(
                minimum_margin,
                minimum_joint_limit_margin(environment.model, environment.data),
            )
            disallowed_self_contact_steps += int(
                has_disallowed_self_contact(environment.model, environment.data)
            )
            maximum_body_tilt = max(maximum_body_tilt, environment.body_tilt())
            maximum_angular_speed = max(
                maximum_angular_speed,
                float(np.linalg.norm(environment.data.qvel[3:6])),
            )
            maximum_lateral_speed = max(
                maximum_lateral_speed, abs(float(environment.data.qvel[1]))
            )
        if after_step + 1e-9 >= push_end:
            target_satisfied = bool(result.info["recoveryTargetSatisfied"])
            if outcome_tracking_started:
                recovery_target_entry_count += int(
                    target_satisfied and not previous_target_satisfied
                )
            else:
                outcome_tracking_started = True
            previous_target_satisfied = target_satisfied
            maximum_recovery_progress = max(
                maximum_recovery_progress,
                float(result.info["recoveryTargetProgress"]),
            )
        if result.terminated or result.truncated:
            break
    if pre_trigger_hash is None:
        raise RuntimeError(
            f"Reflex Search Case '{case['id']}' ended before the push"
        )
    terminal_progress = environment.recovery_target_progress()
    return {
        "id": case["id"],
        "scenario": scenario["id"],
        "seed": int(case["seed"]),
        "side": "positive-y" if positive_side else "negative-y",
        "preTriggerStateHash": pre_trigger_hash,
        "pushStartedAtSeconds": push_start,
        "pushEndedAtSeconds": push_end,
        "outcomeObservedAtSeconds": float(environment.data.time),
        "overrideAuthoritySteps": override_authority_steps,
        "overrideAuthoritySeconds": (
            override_authority_sum / float(case["task"]["controlHz"])
        ),
        "meanOverrideRawActionL2": (
            override_action_l2_sum / max(override_authority_steps, 1)
        ),
        "meanOverrideRawActionSlew": (
            override_action_slew_sum / max(override_authority_steps - 1, 1)
        ),
        "terminal": {
            "baseHeightM": float(environment.data.qpos[2]),
            "bodyTiltRad": environment.body_tilt(),
            "baseAngularSpeedRadPerSec": float(
                np.linalg.norm(environment.data.qvel[3:6])
            ),
            "absoluteLateralVelocityMps": abs(float(environment.data.qvel[1])),
            "recoveryTargetProgress": terminal_progress,
            "recoveryStableProgress": environment.recovery_stable_progress(),
            "recoveryTargetSatisfied": environment.recovery_target_satisfied(),
            "recoveryStableLatched": environment.recovery_stable_latched,
            "missionStage": (
                environment.mission_phase()["id"]
                if environment.mission_phase() is not None
                else None
            ),
        },
        "envelope": {
            "minimumJointLimitMarginRad": (
                minimum_margin
                if np.isfinite(minimum_margin)
                else minimum_joint_limit_margin(
                    environment.model, environment.data
                )
            ),
            "disallowedSelfContactSteps": disallowed_self_contact_steps,
            "maximumBodyTiltRad": maximum_body_tilt,
            "maximumBaseAngularSpeedRadPerSec": maximum_angular_speed,
            "maximumAbsoluteLateralVelocityMps": maximum_lateral_speed,
            "maximumRecoveryTargetProgress": maximum_recovery_progress,
            "recoveryTargetEntryCount": recovery_target_entry_count,
            "missionPhaseTimeoutCount": environment.mission_phase_timeout_count,
        },
        "demonstrations": demonstrations,
    }


def _candidate_rank(
    cases: list[dict[str, Any]],
    baseline_cases: list[dict[str, Any]],
) -> dict[str, Any]:
    safety_regressions = 0
    progress_deltas: list[float] = []
    maximum_progress_deltas: list[float] = []
    for case, baseline in zip(cases, baseline_cases, strict=True):
        safety_regressions += int(
            float(case["envelope"]["minimumJointLimitMarginRad"])
            < float(baseline["envelope"]["minimumJointLimitMarginRad"]) - 0.01
        )
        safety_regressions += int(
            int(case["envelope"]["disallowedSelfContactSteps"])
            > int(baseline["envelope"]["disallowedSelfContactSteps"])
        )
        progress_deltas.append(
            float(case["terminal"]["recoveryTargetProgress"]["combined"])
            - float(baseline["terminal"]["recoveryTargetProgress"]["combined"])
        )
        maximum_progress_deltas.append(
            float(case["envelope"]["maximumRecoveryTargetProgress"])
            - float(baseline["envelope"]["maximumRecoveryTargetProgress"])
        )
    terminal_progress = [
        float(case["terminal"]["recoveryTargetProgress"]["combined"])
        for case in cases
    ]
    maximum_progress = [
        float(case["envelope"]["maximumRecoveryTargetProgress"])
        for case in cases
    ]
    target_entries = sum(
        int(case["envelope"]["recoveryTargetEntryCount"]) for case in cases
    )
    comparison_key = [
        -safety_regressions,
        min(progress_deltas),
        min(terminal_progress),
        float(np.mean(terminal_progress)),
        target_entries,
        min(maximum_progress_deltas),
        min(maximum_progress),
        -float(np.mean([
            case["terminal"]["baseAngularSpeedRadPerSec"] for case in cases
        ])),
        -float(np.mean([
            case["terminal"]["bodyTiltRad"] for case in cases
        ])),
        -float(np.mean([
            case["meanOverrideRawActionL2"] for case in cases
        ])),
    ]
    return {
        "safetyRegressionCount": safety_regressions,
        "minimumTerminalProgressDelta": min(progress_deltas),
        "minimumMaximumProgressDelta": min(maximum_progress_deltas),
        "recoveryTargetEntryCount": target_entries,
        "minimumTerminalRecoveryTargetProgress": min(terminal_progress),
        "minimumMaximumRecoveryTargetProgress": min(maximum_progress),
        "meanTerminalRecoveryTargetProgress": float(np.mean(terminal_progress)),
        "meanTerminalBodyTiltRad": float(np.mean([
            case["terminal"]["bodyTiltRad"] for case in cases
        ])),
        "meanTerminalAngularSpeedRadPerSec": float(np.mean([
            case["terminal"]["baseAngularSpeedRadPerSec"] for case in cases
        ])),
        "meanOverrideRawActionL2": float(np.mean([
            case["meanOverrideRawActionL2"] for case in cases
        ])),
        "comparisonKey": comparison_key,
    }


def search_reflex(request: dict[str, Any]) -> dict[str, Any]:
    contract = request["search"]
    samples = _positive_int(contract["samples"], "samples", 512)
    segments = _positive_int(contract["segments"], "segments", 8)
    reflex_duration = _finite_float(
        contract["reflexDurationSeconds"],
        "reflexDurationSeconds",
        0.02,
        2.0,
    )
    outcome_horizon = _finite_float(
        contract["outcomeHorizonSeconds"],
        "outcomeHorizonSeconds",
        0.1,
        8.0,
    )
    maximum_delta = _finite_float(
        contract["maximumRawActionDelta"],
        "maximumRawActionDelta",
        0.01,
        4.0,
    )
    action_size = int(request["compiled"]["actionContract"]["size"])
    axes = contract["actionAxes"]
    if (
        not isinstance(axes, list)
        or not axes
        or any(isinstance(axis, bool) or not isinstance(axis, int) for axis in axes)
        or len(set(axes)) != len(axes)
        or min(axes) < 0
        or max(axes) >= action_size
    ):
        raise RuntimeError(
            f"Reflex Search actionAxes must be unique indices within [0, {action_size})"
        )
    architecture = request["architecture"]
    action_transform = architecture.get("actionTransform")
    if (
        not isinstance(action_transform, dict)
        or action_transform.get("kind") != "program-controller-residual"
    ):
        raise RuntimeError(
            "Reflex Search requires a program-controller-residual Policy"
        )
    residual_scale = program_residual_scale_vector(action_transform, action_size)
    if any(residual_scale[axis] <= 0.0 for axis in axes):
        raise RuntimeError(
            "Reflex Search actionAxes must have nonzero Policy residual authority"
        )
    symmetry = compile_bilateral_symmetry(
        architecture.get("bilateralSymmetry"),
        request["compiled"]["observationContract"],
        action_size,
    )
    if symmetry is None:
        raise RuntimeError(
            "Reflex Search requires a validated bilateral Policy symmetry contract"
        )
    cases = request["cases"]
    if not isinstance(cases, list) or len(cases) < 2:
        raise RuntimeError("Reflex Search requires at least two locked Cases")
    directions = {
        "positive-y"
        if float(_external_push(case["scenario"])["directionXY"][1]) > 0.0
        else "negative-y"
        for case in cases
    }
    if directions != {"positive-y", "negative-y"}:
        raise RuntimeError(
            "Reflex Search requires both positive-y and negative-y impact Cases"
        )
    positive_deltas = _candidate_deltas(
        action_size, axes, segments, samples, maximum_delta, int(contract["seed"])
    )
    negative_deltas = _candidate_deltas(
        action_size,
        axes,
        segments,
        samples,
        maximum_delta,
        int(contract["seed"]) + 1,
    )
    zero_delta = positive_deltas[0]
    baseline_cases = [
        _run_case(
            request,
            case,
            zero_delta,
            zero_delta,
            False,
            reflex_duration,
            outcome_horizon,
        )
        for case in cases
    ]
    baseline_hashes = {
        case["id"]: case["preTriggerStateHash"] for case in baseline_cases
    }
    baseline_rank = _candidate_rank(baseline_cases, baseline_cases)
    baseline = {
        "index": 0,
        "kind": "frozen-actor-baseline",
        "positiveRawActionDelta": zero_delta.tolist(),
        "negativeRawActionDelta": zero_delta.tolist(),
        "rank": baseline_rank,
        "cases": [{key: value for key, value in case.items() if key != "demonstrations"} for case in baseline_cases],
    }
    baseline_by_id = {case["id"]: case for case in baseline_cases}

    def search_side(
        side: str,
        deltas: list[np.ndarray],
    ) -> tuple[int, np.ndarray, list[dict[str, Any]], list[dict[str, Any]]]:
        side_cases = [
            case
            for case in cases
            if (
                "positive-y"
                if float(_external_push(case["scenario"])["directionXY"][1]) > 0.0
                else "negative-y"
            )
            == side
        ]
        side_baseline = [baseline_by_id[case["id"]] for case in side_cases]
        side_baseline_rank = _candidate_rank(side_baseline, side_baseline)
        summaries: list[dict[str, Any]] = [{
            "index": 0,
            "kind": "frozen-actor-baseline",
            "rawActionDelta": zero_delta.tolist(),
            "rank": side_baseline_rank,
            "cases": [
                {key: value for key, value in case.items() if key != "demonstrations"}
                for case in side_baseline
            ],
        }]
        selected_index = 0
        selected_delta = zero_delta
        selected_cases = side_baseline
        selected_key = tuple(side_baseline_rank["comparisonKey"])
        for index, delta in enumerate(deltas[1:], start=1):
            candidate_cases = [
                _run_case(
                    request,
                    case,
                    delta,
                    delta,
                    True,
                    reflex_duration,
                    outcome_horizon,
                )
                for case in side_cases
            ]
            for candidate_case in candidate_cases:
                if (
                    candidate_case["preTriggerStateHash"]
                    != baseline_hashes[candidate_case["id"]]
                ):
                    raise RuntimeError(
                        f"Reflex Search Case '{candidate_case['id']}' diverged before intervention"
                    )
            rank = _candidate_rank(candidate_cases, side_baseline)
            summaries.append({
                "index": index,
                "kind": "load-conditioned-raw-action-delta",
                "rawActionDelta": delta.tolist(),
                "rank": rank,
                "cases": [
                    {key: value for key, value in case.items() if key != "demonstrations"}
                    for case in candidate_cases
                ],
            })
            comparison_key = tuple(rank["comparisonKey"])
            if comparison_key > selected_key:
                selected_index = index
                selected_delta = delta
                selected_cases = candidate_cases
                selected_key = comparison_key
        return selected_index, selected_delta, selected_cases, summaries

    (
        positive_index,
        positive_delta,
        positive_cases,
        positive_summaries,
    ) = search_side("positive-y", positive_deltas)
    (
        negative_index,
        negative_delta,
        negative_cases,
        negative_summaries,
    ) = search_side("negative-y", negative_deltas)
    if positive_index == 0:
        positive_cases = [
            _run_case(
                request,
                case,
                zero_delta,
                zero_delta,
                True,
                reflex_duration,
                outcome_horizon,
            )
            for case in cases
            if float(_external_push(case["scenario"])["directionXY"][1]) > 0.0
        ]
    if negative_index == 0:
        negative_cases = [
            _run_case(
                request,
                case,
                zero_delta,
                zero_delta,
                True,
                reflex_duration,
                outcome_horizon,
            )
            for case in cases
            if float(_external_push(case["scenario"])["directionXY"][1]) < 0.0
        ]
    for selected_case in [*positive_cases, *negative_cases]:
        if (
            selected_case["preTriggerStateHash"]
            != baseline_hashes[selected_case["id"]]
        ):
            raise RuntimeError(
                f"Reflex Search Case '{selected_case['id']}' diverged before demonstration capture"
            )
    selected_by_id = {
        case["id"]: case for case in [*positive_cases, *negative_cases]
    }
    selected_cases = [selected_by_id[case["id"]] for case in cases]
    selected_rank = _candidate_rank(selected_cases, baseline_cases)
    selected_key = tuple(selected_rank["comparisonKey"])
    selected = {
        "kind": "state-conditioned-load-aware-bilateral-reflex",
        "positiveSelectionIndex": positive_index,
        "negativeSelectionIndex": negative_index,
        "positiveRawActionDelta": positive_delta.tolist(),
        "negativeRawActionDelta": negative_delta.tolist(),
        "rank": selected_rank,
        "cases": [
            {key: value for key, value in case.items() if key != "demonstrations"}
            for case in selected_cases
        ],
        "symmetryAudit": {
            "mirroredPositiveRawActionDelta": symmetry.mirror_action(
                positive_delta
            ).tolist(),
            "meanAbsoluteDeviationFromExactReflection": float(
                np.mean(np.abs(
                    negative_delta - symmetry.mirror_action(positive_delta)
                ))
            ),
            "exactReflectionRequired": False,
            "reason": "search loads are direction-opposed but magnitude-asymmetric",
        },
    }
    selected_index = {
        "positiveY": positive_index,
        "negativeY": negative_index,
    }
    improved = (
        (positive_index != 0 or negative_index != 0)
        and selected_key > tuple(baseline_rank["comparisonKey"])
    )
    demonstrations = (
        [
            item
            for case in selected_cases
            for item in case["demonstrations"]
        ]
        if improved
        else []
    )
    return {
        "contract": {
            **contract,
            "selection": "worst-case-physical-proxy-first",
            "baseline": "frozen-deterministic-actor",
            "intervention": "pre-transform-actor-raw-action-delta",
            "bilateralMapping": "state-conditioned-load-aware",
            "symmetryContract": "policy-lateral-reflection-v1-audited-not-forced",
            "promotionAuthority": "none",
        },
        "preTriggerStateHashes": baseline_hashes,
        "baseline": baseline,
        "selected": selected,
        "selectedIndex": selected_index,
        "candidateCount": 1 + 2 * (samples - 1),
        "candidateSummaries": {
            "positiveY": positive_summaries,
            "negativeY": negative_summaries,
        },
        "assessment": {
            "direction": "IMPROVED_PROXY" if improved else "NO_PROXY_IMPROVEMENT",
            "demonstrationEligible": improved and bool(demonstrations),
            "promotionVerdict": None,
            "judgeRequired": True,
        },
        "demonstrations": demonstrations,
    }
