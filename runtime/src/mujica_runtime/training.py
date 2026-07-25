from __future__ import annotations

import json
import random
import shutil
import time
from collections import deque
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import mujoco
import numpy as np
import torch

from .controllers import Controller, PolicyNetwork, advance_program_residual_gate_scale, create_policy_network, load_program_controller, load_python_module, program_residual_scale_vector, transform_policy_action
from .environment import RobotEnvironment
from .io import atomic_directory, hardware_info, hash_file, hash_json, write_json


QUALITY_REWARD_REFERENCES = {
    "jointAcceleration": 1000.0,
    "bodyAngularAcceleration": 100.0,
    "actionSlew": 800.0,
    "actuatorSaturation": 1.0,
    "footSlip": 1.0,
    "footImpact": 20000.0,
}
QUALITY_REWARD_FEATURES = {
    "jointAcceleration": "jointAccelerationMeanAbsRadPerSec2",
    "bodyAngularAcceleration": "bodyAngularAccelerationMeanAbsRadPerSec2",
    "actionSlew": "actionSlewMeanAbsPerSec",
    "actuatorSaturation": "actuatorSaturationRate",
    "footSlip": "footSlipMeanMps",
    "footImpact": "footContactImpactMeanNPerSec",
}
DOMAIN_PARAMETER_NAMES = (
    "bodyMassScale",
    "jointDampingScale",
    "actuatorStrengthScale",
    "frictionScale",
    "observationNoiseStd",
    "actuatorDelayJitterSteps",
    "pushTimeOffsetSeconds",
    "pushForceScale",
    "pushDirectionJitterRad",
)


def sample_domain_profile(profile: dict[str, Any] | None, seed: int) -> dict[str, float | int]:
    if not profile:
        return {}
    rng = np.random.default_rng(seed)
    sample: dict[str, float | int] = {}
    for name in DOMAIN_PARAMETER_NAMES:
        bounds = profile.get("parameters", {}).get(name)
        if not bounds:
            continue
        minimum = bounds["minimum"]; maximum = bounds["maximum"]
        if name == "actuatorDelayJitterSteps":
            sample[name] = int(rng.integers(int(minimum), int(maximum) + 1))
        else:
            sample[name] = float(rng.uniform(float(minimum), float(maximum)))
    return sample


def summarize_domain_samples(samples: list[dict[str, Any]]) -> dict[str, dict[str, float]]:
    summary: dict[str, dict[str, float]] = {}
    for name in DOMAIN_PARAMETER_NAMES:
        values = [float(item["parameters"][name]) for item in samples if name in item["parameters"]]
        if values:
            summary[name] = {"minimum": min(values), "mean": float(np.mean(values)), "maximum": max(values)}
    return summary


def summarize_actuator_delay_coverage(
    samples: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """Expose whether a bounded delay envelope actually received actor authority."""
    summary: dict[int, dict[str, Any]] = {}
    for sample in samples:
        delay_steps = int(sample["effectiveActuatorDelaySteps"])
        outcome = summary.setdefault(delay_steps, {
            "effectiveActuatorDelaySteps": delay_steps,
            "episodesStarted": 0,
            "episodesCompleted": 0,
            "completeMissionEpisodes": 0,
            "steps": 0,
            "activePolicySteps": 0,
            "actorAuthoritySum": 0.0,
            "actorRecoveryTargetEntryCount": 0,
            "actorContributedRecoveryTargetEntryCount": 0,
            "episodesWithActorRecoveryTargetEntry": 0,
            "episodesWithActorContributedRecoveryTargetEntry": 0,
            "recoveryStableTransitionCount": 0,
            "episodesWithRecoveryStableTransition": 0,
            "missionPhaseTimeoutEpisodes": 0,
            "timeoutFreeMissionEpisodes": 0,
        })
        outcome["episodesStarted"] += 1
        outcome["episodesCompleted"] += int(bool(sample.get("completed")))
        outcome["completeMissionEpisodes"] += int(
            bool(sample.get("completeMissionStage"))
        )
        outcome["steps"] += int(sample.get("steps", 0))
        outcome["activePolicySteps"] += int(sample.get("activePolicySteps", 0))
        outcome["actorAuthoritySum"] += float(
            sample.get("actorAuthoritySum", 0.0)
        )
        actor_target_entries = int(
            sample.get("actorRecoveryTargetEntryCount", 0)
        )
        contributed_target_entries = int(
            sample.get("actorContributedRecoveryTargetEntryCount", 0)
        )
        stable_transitions = int(
            sample.get("recoveryStableTransitionCount", 0)
        )
        phase_timeouts = int(sample.get("missionPhaseTimeoutCount", 0))
        mission_completed = bool(sample.get("missionCompleted"))
        outcome["actorRecoveryTargetEntryCount"] += actor_target_entries
        outcome["actorContributedRecoveryTargetEntryCount"] += (
            contributed_target_entries
        )
        outcome["episodesWithActorRecoveryTargetEntry"] += int(
            actor_target_entries > 0
        )
        outcome["episodesWithActorContributedRecoveryTargetEntry"] += int(
            contributed_target_entries > 0
        )
        outcome["recoveryStableTransitionCount"] += stable_transitions
        outcome["episodesWithRecoveryStableTransition"] += int(
            stable_transitions > 0
        )
        outcome["missionPhaseTimeoutEpisodes"] += int(phase_timeouts > 0)
        outcome["timeoutFreeMissionEpisodes"] += int(
            mission_completed and phase_timeouts == 0
        )
    for outcome in summary.values():
        steps = max(int(outcome["steps"]), 1)
        outcome["activePolicyFraction"] = float(
            outcome["activePolicySteps"] / steps
        )
        outcome["meanActorAuthority"] = float(
            outcome.pop("actorAuthoritySum") / steps
        )
    return {
        str(delay_steps): summary[delay_steps]
        for delay_steps in sorted(summary)
    }


def authored_lateral_impact(scenario: dict[str, Any]) -> dict[str, Any] | None:
    """Describe the authored lateral impulse without inferring from an id label."""
    push = scenario.get("externalPush")
    if push is not None:
        direction = np.asarray(push["directionXY"], dtype=np.float64)
        norm = float(np.linalg.norm(direction))
        force_newton = float(push["forceNewton"])
        if norm <= 0.0:
            return None
        direction /= norm
    else:
        legacy = scenario.get("lateralPush")
        if legacy is None:
            return None
        force_newton = abs(float(legacy["forceNewton"]))
        direction = np.asarray(
            [0.0, 1.0 if float(legacy["forceNewton"]) >= 0.0 else -1.0],
            dtype=np.float64,
        )
        push = legacy
    if abs(float(direction[1])) <= 1e-9:
        return None
    duration_seconds = float(push["durationSeconds"])
    return {
        "direction": "positive-y" if direction[1] > 0.0 else "negative-y",
        "directionXY": direction.tolist(),
        "forceNewton": force_newton,
        "durationSeconds": duration_seconds,
        "lateralImpulseNs": float(
            force_newton * duration_seconds * direction[1]
        ),
    }


def summarize_lateral_impact_pairs(
    samples: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """Audit whether opposite labels are also physically mirrored plants."""
    by_curriculum: dict[str, dict[str, dict[str, Any]]] = {}
    for sample in samples:
        impact = sample.get("authoredLateralImpact")
        if not isinstance(impact, dict):
            continue
        curriculum = str(sample["curriculum"])
        scenarios = by_curriculum.setdefault(curriculum, {})
        scenarios.setdefault(str(sample["scenario"]), {
            "scenario": sample["scenario"],
            "direction": impact["direction"],
            "directionXY": impact["directionXY"],
            "forceNewton": impact["forceNewton"],
            "durationSeconds": impact["durationSeconds"],
            "lateralImpulseNs": impact["lateralImpulseNs"],
            "friction": sample["authoredPlant"]["friction"],
            "payloadKg": sample["authoredPlant"]["payloadKg"],
            "observationNoiseStd": sample["authoredPlant"][
                "observationNoiseStd"
            ],
            "actuatorDelaySteps": sample["authoredPlant"][
                "actuatorDelaySteps"
            ],
        })
    audits: dict[str, dict[str, Any]] = {}
    for curriculum, scenario_map in by_curriculum.items():
        scenarios = sorted(
            scenario_map.values(), key=lambda item: str(item["scenario"])
        )
        positive = [
            item for item in scenarios if item["direction"] == "positive-y"
        ]
        negative = [
            item for item in scenarios if item["direction"] == "negative-y"
        ]
        pair_complete = len(positive) == 1 and len(negative) == 1
        opposite_directions = bool(
            pair_complete
            and np.allclose(
                np.asarray(positive[0]["directionXY"]),
                -np.asarray(negative[0]["directionXY"]),
                rtol=0.0,
                atol=1e-9,
            )
        )
        equal_impulse_magnitude = bool(
            pair_complete
            and np.isclose(
                abs(float(positive[0]["lateralImpulseNs"])),
                abs(float(negative[0]["lateralImpulseNs"])),
                rtol=0.0,
                atol=1e-9,
            )
        )
        same_plant = bool(
            pair_complete
            and all(
                np.isclose(
                    float(positive[0][name]),
                    float(negative[0][name]),
                    rtol=0.0,
                    atol=1e-9,
                )
                for name in (
                    "friction",
                    "payloadKg",
                    "observationNoiseStd",
                    "actuatorDelaySteps",
                )
            )
        )
        physically_mirrored = bool(
            pair_complete
            and opposite_directions
            and equal_impulse_magnitude
            and same_plant
        )
        audits[curriculum] = {
            "curriculum": curriculum,
            "scenarios": scenarios,
            "pairComplete": pair_complete,
            "oppositeDirections": opposite_directions,
            "equalImpulseMagnitude": equal_impulse_magnitude,
            "samePlant": same_plant,
            "physicallyMirrored": physically_mirrored,
            "status": (
                "PHYSICALLY-MIRRORED"
                if physically_mirrored
                else "LOAD-MAGNITUDE-ASYMMETRIC"
                if pair_complete
                and opposite_directions
                and same_plant
                and not equal_impulse_magnitude
                else "NOT-A-MIRROR-PAIR"
            ),
        }
    return audits


def summarize_mission_outcomes(
    samples: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """Aggregate episode outcomes without hiding Scenario direction or Mission stage."""
    summary: dict[str, dict[str, Any]] = {}
    for sample in samples:
        key = f"{sample['curriculum']}:{sample['scenario']}"
        outcome = summary.setdefault(key, {
            "curriculum": sample["curriculum"],
            "role": sample["role"],
            "task": sample["task"],
            "scenario": sample["scenario"],
            "episodesStarted": 0,
            "episodesCompleted": 0,
            "steps": 0,
            "activePolicySteps": 0,
            "actorAuthoritySum": 0.0,
            "recoveryTargetEntryCount": 0,
            "actorRecoveryTargetEntryCount": 0,
            "actorContributedRecoveryTargetEntryCount": 0,
            "episodesWithRecoveryTargetEntry": 0,
            "episodesWithActorRecoveryTargetEntry": 0,
            "episodesWithActorContributedRecoveryTargetEntry": 0,
            "recoveryStableTransitionCount": 0,
            "episodesWithRecoveryStableTransition": 0,
            "recoveryRelapseCount": 0,
            "episodesWithRecoveryRelapse": 0,
            "recoveryDeadlineExpiredEpisodes": 0,
            "missionPhaseTimeoutCount": 0,
            "missionPhaseTimeoutEpisodes": 0,
            "missionCompletedEpisodes": 0,
            "timeoutFreeMissionEpisodes": 0,
            "maximumRecoveryStableProgress": 0.0,
        })
        outcome["episodesStarted"] += 1
        outcome["episodesCompleted"] += int(bool(sample.get("completed")))
        outcome["steps"] += int(sample.get("steps", 0))
        outcome["activePolicySteps"] += int(sample.get("activePolicySteps", 0))
        outcome["actorAuthoritySum"] += float(sample.get("actorAuthoritySum", 0.0))
        target_entries = int(sample.get("recoveryTargetEntryCount", 0))
        actor_target_entries = int(sample.get("actorRecoveryTargetEntryCount", 0))
        contributed_target_entries = int(
            sample.get("actorContributedRecoveryTargetEntryCount", 0)
        )
        stable_transitions = int(sample.get("recoveryStableTransitionCount", 0))
        relapses = int(sample.get("recoveryRelapseCount", 0))
        phase_timeouts = int(sample.get("missionPhaseTimeoutCount", 0))
        outcome["recoveryTargetEntryCount"] += target_entries
        outcome["actorRecoveryTargetEntryCount"] += actor_target_entries
        outcome["actorContributedRecoveryTargetEntryCount"] += (
            contributed_target_entries
        )
        outcome["episodesWithRecoveryTargetEntry"] += int(target_entries > 0)
        outcome["episodesWithActorRecoveryTargetEntry"] += int(actor_target_entries > 0)
        outcome["episodesWithActorContributedRecoveryTargetEntry"] += int(
            contributed_target_entries > 0
        )
        outcome["recoveryStableTransitionCount"] += stable_transitions
        outcome["episodesWithRecoveryStableTransition"] += int(stable_transitions > 0)
        outcome["recoveryRelapseCount"] += relapses
        outcome["episodesWithRecoveryRelapse"] += int(relapses > 0)
        outcome["recoveryDeadlineExpiredEpisodes"] += int(
            bool(sample.get("recoveryDeadlineExpired"))
        )
        outcome["missionPhaseTimeoutCount"] += phase_timeouts
        outcome["missionPhaseTimeoutEpisodes"] += int(phase_timeouts > 0)
        mission_completed = bool(sample.get("missionCompleted"))
        outcome["missionCompletedEpisodes"] += int(mission_completed)
        outcome["timeoutFreeMissionEpisodes"] += int(
            mission_completed and phase_timeouts == 0
        )
        outcome["maximumRecoveryStableProgress"] = max(
            float(outcome["maximumRecoveryStableProgress"]),
            float(sample.get("maximumRecoveryStableProgress", 0.0)),
        )
    for outcome in summary.values():
        steps = max(int(outcome["steps"]), 1)
        outcome["activePolicyFraction"] = float(
            outcome["activePolicySteps"] / steps
        )
        outcome["meanActorAuthority"] = float(
            outcome.pop("actorAuthoritySum") / steps
        )
    return summary


def summarize_intervention_timing(
    samples: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """Expose whether Program and learned authority arrive inside the Task budget."""
    summary: dict[str, dict[str, Any]] = {}
    for sample in samples:
        key = f"{sample['curriculum']}:{sample['scenario']}"
        outcome = summary.setdefault(key, {
            "curriculum": sample["curriculum"],
            "role": sample["role"],
            "task": sample["task"],
            "scenario": sample["scenario"],
            "episodesStarted": 0,
            "episodesWithImpactEnd": 0,
            "episodesWithRecoveryPhase": 0,
            "episodesWithProgramRecovery": 0,
            "episodesWithActorAuthority": 0,
            "actorBeforeProgramEpisodes": 0,
            "programResponseLatenciesSeconds": [],
            "actorResponseLatenciesSeconds": [],
            "programRecoveryBudgetsRemainingSeconds": [],
            "actorRecoveryBudgetsRemainingSeconds": [],
        })
        outcome["episodesStarted"] += 1
        impact_end = sample.get("impactEndedAtSeconds")
        recovery_entry = sample.get("recoveryPhaseEnteredAtSeconds")
        deadline = sample.get("recoveryDeadlineAtSeconds")
        program_entry = sample.get("firstProgramRecoveryAtSeconds")
        actor_entry = sample.get("firstActorAuthorityAtSeconds")
        outcome["episodesWithImpactEnd"] += int(impact_end is not None)
        outcome["episodesWithRecoveryPhase"] += int(recovery_entry is not None)
        outcome["episodesWithProgramRecovery"] += int(program_entry is not None)
        outcome["episodesWithActorAuthority"] += int(actor_entry is not None)
        outcome["actorBeforeProgramEpisodes"] += int(
            actor_entry is not None
            and (program_entry is None or float(actor_entry) < float(program_entry))
        )
        if impact_end is not None and program_entry is not None:
            outcome["programResponseLatenciesSeconds"].append(
                float(program_entry) - float(impact_end)
            )
        if impact_end is not None and actor_entry is not None:
            outcome["actorResponseLatenciesSeconds"].append(
                float(actor_entry) - float(impact_end)
            )
        if deadline is not None and program_entry is not None:
            outcome["programRecoveryBudgetsRemainingSeconds"].append(
                float(deadline) - float(program_entry)
            )
        if deadline is not None and actor_entry is not None:
            outcome["actorRecoveryBudgetsRemainingSeconds"].append(
                float(deadline) - float(actor_entry)
            )
    for outcome in summary.values():
        for source, prefix in (
            ("programResponseLatenciesSeconds", "programResponseLatencySeconds"),
            ("actorResponseLatenciesSeconds", "actorResponseLatencySeconds"),
            (
                "programRecoveryBudgetsRemainingSeconds",
                "programRecoveryBudgetRemainingSeconds",
            ),
            (
                "actorRecoveryBudgetsRemainingSeconds",
                "actorRecoveryBudgetRemainingSeconds",
            ),
        ):
            values = outcome.pop(source)
            outcome[prefix] = (
                {
                    "minimum": min(values),
                    "mean": float(np.mean(values)),
                    "maximum": max(values),
                }
                if values
                else None
            )
    return summary


def mission_outcome_sample(
    *,
    episode: int,
    curriculum_index: int,
    entry: dict[str, Any],
    scenario: dict[str, Any],
    environment_seed: int,
    domain_seed: int,
    domain_profile: dict[str, Any] | None,
    domain_profile_hash: str | None,
    domain_sample: dict[str, float | int],
    global_step_start: int | None,
) -> dict[str, Any]:
    """Create one lossless episode ledger row for training or frozen probing."""
    mission_phases = entry["task"].get("missionPhases", [])
    complete_mission_stage = bool(
        mission_phases
        and entry.get("throughPhase") == mission_phases[-1]["id"]
    )
    recovery_phase = next(
        (
            phase
            for phase in mission_phases
            if phase.get("intent") == "recover"
        ),
        None,
    )
    recovery_timeout_seconds = (
        float(recovery_phase["exit"]["timeoutSeconds"])
        if recovery_phase
        and recovery_phase.get("exit", {}).get("kind") == "recovery-stable"
        else None
    )
    impact = authored_lateral_impact(scenario)
    return {
        "episode": episode,
        "curriculum": str(entry["id"]),
        "curriculumIndex": curriculum_index,
        "role": entry["role"],
        "task": entry["task"]["id"],
        "scenario": scenario["id"],
        "environmentSeed": environment_seed,
        "domainSeed": domain_seed,
        "globalStepStart": global_step_start,
        "throughPhase": entry.get("throughPhase"),
        "completeMissionStage": complete_mission_stage,
        "episodeEndSeconds": entry.get(
            "episodeEndSeconds", float(entry["task"]["durationSeconds"])
        ),
        "episodeEndPhase": entry.get("episodeEndPhase"),
        "domainProfileId": domain_profile.get("id") if domain_profile else None,
        "domainProfileHash": domain_profile_hash,
        "effectiveActuatorDelaySteps": (
            int(scenario.get("actuatorDelaySteps", 0))
            + int(domain_sample.get("actuatorDelayJitterSteps", 0))
        ),
        "authoredLateralImpact": impact,
        "authoredPlant": {
            "friction": float(scenario.get("friction", 1.0)),
            "payloadKg": float(scenario.get("payloadKg", 0.0)),
            "observationNoiseStd": float(
                scenario.get("observationNoiseStd", 0.0)
            ),
            "actuatorDelaySteps": int(
                scenario.get("actuatorDelaySteps", 0)
            ),
        },
        "steps": 0,
        "completed": False,
        "activePolicySteps": 0,
        "actorAuthoritySum": 0.0,
        "recoveryTargetEntryCount": 0,
        "actorRecoveryTargetEntryCount": 0,
        "actorContributedRecoveryTargetEntryCount": 0,
        "actorInterventionSinceTargetEntry": False,
        "recoveryStableTransitionCount": 0,
        "recoveryRelapseCount": 0,
        "recoveryDeadlineExpired": False,
        "missionPhaseTimeoutCount": 0,
        "missionCompleted": False,
        "maximumRecoveryStableProgress": 0.0,
        "impactEndedAtSeconds": None,
        "recoveryPhaseEnteredAtSeconds": None,
        "recoveryTimeoutSeconds": recovery_timeout_seconds,
        "recoveryDeadlineAtSeconds": None,
        "firstProgramRecoveryAtSeconds": None,
        "firstActorAuthorityAtSeconds": None,
        "parameters": domain_sample,
    }


def record_mission_outcome_step(
    sample: dict[str, Any],
    info: dict[str, Any],
    actor_authority: float,
    previous_target_satisfied: bool,
    *,
    time_seconds: float | None = None,
    program_telemetry: dict[str, Any] | None = None,
) -> bool:
    """Advance an episode ledger row and return the current target state."""
    now = float(time_seconds) if time_seconds is not None else None
    if (
        sample.get("recoveryPhaseEnteredAtSeconds") is None
        and info.get("missionIntent") == "recover"
        and info.get("missionPhaseEnteredAtSeconds") is not None
    ):
        recovery_entry = float(info["missionPhaseEnteredAtSeconds"])
        sample["recoveryPhaseEnteredAtSeconds"] = recovery_entry
        timeout = sample.get("recoveryTimeoutSeconds")
        sample["recoveryDeadlineAtSeconds"] = (
            recovery_entry + float(timeout) if timeout is not None else None
        )
    if (
        sample.get("firstProgramRecoveryAtSeconds") is None
        and isinstance(program_telemetry, dict)
        and program_telemetry.get("mode") == "recovery"
        and now is not None
    ):
        sample["firstProgramRecoveryAtSeconds"] = now
    if (
        sample.get("firstActorAuthorityAtSeconds") is None
        and actor_authority > 0.0
        and now is not None
    ):
        sample["firstActorAuthorityAtSeconds"] = now
    target_satisfied = bool(info.get("recoveryTargetSatisfied"))
    sample["actorInterventionSinceTargetEntry"] = bool(
        sample.get("actorInterventionSinceTargetEntry")
        or actor_authority > 0.0
    )
    if target_satisfied and not previous_target_satisfied:
        sample["recoveryTargetEntryCount"] += 1
        sample["actorRecoveryTargetEntryCount"] += int(actor_authority > 0.0)
        sample["actorContributedRecoveryTargetEntryCount"] += int(
            sample["actorInterventionSinceTargetEntry"]
        )
        sample["actorInterventionSinceTargetEntry"] = False
    mission_transition = info.get("missionTransition")
    if isinstance(mission_transition, dict):
        if (
            sample.get("impactEndedAtSeconds") is None
            and mission_transition.get("condition") == "external-push-end"
            and now is not None
        ):
            sample["impactEndedAtSeconds"] = now
        sample["recoveryStableTransitionCount"] += int(
            mission_transition.get("condition") == "recovery-stable"
            and mission_transition.get("conditionMet") is True
        )
        sample["missionPhaseTimeoutCount"] += int(
            mission_transition.get("timedOut") is True
        )
    sample["recoveryRelapseCount"] += int(
        info.get("recoveryRelapseEntered") is True
    )
    sample["recoveryDeadlineExpired"] = bool(
        sample["recoveryDeadlineExpired"]
        or info.get("recoveryDeadlineExpired")
    )
    sample["missionCompleted"] = bool(
        sample["missionCompleted"] or info.get("missionCompleted")
    )
    sample["maximumRecoveryStableProgress"] = max(
        float(sample["maximumRecoveryStableProgress"]),
        float(info.get("recoveryStableProgress", 0.0)),
    )
    return target_satisfied


def quality_reward_penalty(info: dict[str, Any], weights: dict[str, Any] | None) -> tuple[float, dict[str, float]]:
    quality = info.get("motionQuality", {})
    terms = {
        name: float((weights or {}).get(name, 0.0)) * float(quality.get(feature, 0.0)) / reference
        for name, reference in QUALITY_REWARD_REFERENCES.items()
        for feature in [QUALITY_REWARD_FEATURES[name]]
    }
    return float(sum(terms.values())), terms


def mission_reward_bonus(
    info: dict[str, Any],
    weights: dict[str, Any] | None,
    actor_authority: float,
) -> tuple[float, dict[str, float]]:
    terms = {
        "commandProgress": 0.0,
        "velocityTracking": 0.0,
        "stopStability": 0.0,
        "recoverySuccess": 0.0,
        "recoveryRelapsePenalty": 0.0,
        "phaseTimeoutPenalty": 0.0,
        "timeoutFreeCompletion": 0.0,
    }
    if not weights or info.get("missionPhase") is None:
        return 0.0, terms
    if actor_authority > 0.0:
        target = np.asarray(info.get("motionCommand", np.zeros(3)), dtype=np.float64)
        target_speed = float(np.linalg.norm(target[:2]))
        intent = info.get("missionIntent")
        if target_speed > 1e-9 and intent not in ("disturbance", "recover", "stop"):
            terms["commandProgress"] = float(weights.get("commandProgress", 0.0)) * float(info.get("normalizedProgressRate", 0.0))
            velocity_error = float(info.get("velocityError", 0.0))
            terms["velocityTracking"] = float(weights.get("velocityTracking", 0.0)) * float(np.exp(-10.0 * velocity_error * velocity_error))
        elif intent == "stop":
            velocity_error = float(info.get("velocityError", 0.0))
            terms["stopStability"] = float(weights.get("stopStability", 0.0)) * float(np.exp(-10.0 * velocity_error * velocity_error))
    if info.get("recoveryRelapseEntered") is True:
        terms["recoveryRelapsePenalty"] = -float(weights.get("recoveryRelapsePenalty", 0.0))
    transition = info.get("missionTransition")
    if isinstance(transition, dict):
        if transition.get("condition") == "recovery-stable" and transition.get("conditionMet") is True:
            terms["recoverySuccess"] = float(weights.get("recoverySuccess", 0.0))
        if transition.get("timedOut") is True:
            terms["phaseTimeoutPenalty"] = -float(weights.get("phaseTimeoutPenalty", 0.0))
        if (
            transition.get("to") is None
            and info.get("missionCompleted") is True
            and int(info.get("missionPhaseTimeoutCount", 0)) == 0
        ):
            terms["timeoutFreeCompletion"] = float(weights.get("timeoutFreeCompletion", 0.0))
    return float(sum(terms.values())), terms


def recovery_reward_bonus(
    info: dict[str, Any],
    telemetry: dict[str, Any] | None,
    weights: dict[str, Any] | None,
    actor_authority: float,
) -> tuple[float, dict[str, float]]:
    terms = {
        "upright": 0.0,
        "height": 0.0,
        "stillness": 0.0,
        "support": 0.0,
        "tiltEscape": 0.0,
        "taskTargetProgress": 0.0,
        "taskTargetEntry": 0.0,
    }
    if (
        not weights
        or actor_authority <= 0.0
        or not isinstance(telemetry, dict)
        or telemetry.get("mode") != "recovery"
    ):
        return 0.0, terms
    values = {
        "tilt": telemetry.get("bodyTiltRad"),
        "height": info.get("height"),
        "linearSpeed": info.get("baseLinearSpeedMps"),
        "angularSpeed": info.get("baseAngularSpeedRadPerSec"),
        "supportFeet": telemetry.get("supportFeet"),
    }
    if any(
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not np.isfinite(float(value))
        for value in values.values()
    ):
        return 0.0, terms
    tilt = float(values["tilt"])
    height = float(values["height"])
    linear_speed = float(values["linearSpeed"])
    angular_speed = float(values["angularSpeed"])
    support_feet = float(values["supportFeet"])
    terms["upright"] = float(weights.get("upright", 0.0)) * float(
        np.exp(-8.0 * tilt * tilt)
    )
    terms["tiltEscape"] = float(weights.get("tiltEscape", 0.0)) * float(
        np.clip((np.pi - tilt) / np.pi, 0.0, 1.0)
    )
    terms["height"] = float(weights.get("height", 0.0)) * float(
        np.clip((height - 0.05) / (0.32 - 0.05), 0.0, 1.0)
    )
    stillness_maximum_tilt = float(
        weights.get("stillnessMaximumTiltRad", np.pi)
    )
    if tilt <= stillness_maximum_tilt:
        terms["stillness"] = float(weights.get("stillness", 0.0)) * float(
            1.0
            / (
                1.0
                + 2.0 * linear_speed * linear_speed
                + 2.0 * angular_speed * angular_speed
            )
        )
    terms["support"] = float(weights.get("support", 0.0)) * float(
        np.clip(support_feet / 4.0, 0.0, 1.0)
    )
    terms["taskTargetProgress"] = float(
        weights.get("taskTargetProgress", 0.0)
    ) * float(np.clip(info.get("recoveryTargetProgress", 0.0), 0.0, 1.0))
    # The gate is evaluated before this action and the Task target afterward.
    # This therefore credits only an actor-authorized action that causally enters
    # the authored target. The next step fails closed because target-satisfied is
    # a Runtime authority predicate, preventing target-occupancy reward farming.
    if info.get("recoveryTargetSatisfied") is True:
        terms["taskTargetEntry"] = float(weights.get("taskTargetEntry", 0.0))
    return float(sum(terms.values())), terms


def normalize_masked_advantages(
    advantages: np.ndarray, policy_masks: np.ndarray
) -> np.ndarray:
    normalized = np.zeros_like(advantages, dtype=np.float32)
    active = policy_masks > 0.0
    if not np.any(active):
        return normalized
    active_advantages = advantages[active]
    normalized[active] = (
        active_advantages - active_advantages.mean()
    ) / (active_advantages.std() + 1e-8)
    return normalized


def masked_mean(values: torch.Tensor, masks: torch.Tensor) -> torch.Tensor:
    denominator = masks.sum()
    if float(denominator.detach().item()) <= 0.0:
        return values.sum() * 0.0
    return (values * masks).sum() / denominator


@dataclass(frozen=True)
class BilateralSymmetry:
    """A declared involution over one compiled Observation/Action ABI."""

    contract: dict[str, Any]
    observation_permutation: np.ndarray
    observation_signs: np.ndarray
    action_permutation: np.ndarray
    action_signs: np.ndarray

    def mirror_observation(self, value: np.ndarray) -> np.ndarray:
        array = np.asarray(value)
        return array[..., self.observation_permutation] * self.observation_signs

    def mirror_action(self, value: np.ndarray) -> np.ndarray:
        array = np.asarray(value)
        return array[..., self.action_permutation] * self.action_signs

    def mirror_action_tensor(self, value: torch.Tensor) -> torch.Tensor:
        permutation = torch.as_tensor(
            self.action_permutation, dtype=torch.long, device=value.device
        )
        signs = torch.as_tensor(
            self.action_signs, dtype=value.dtype, device=value.device
        )
        return value.index_select(-1, permutation) * signs


def _expand_symmetry_transform(
    size: int,
    definition: dict[str, Any],
    label: str,
) -> tuple[np.ndarray, np.ndarray]:
    block_size = int(definition.get("blockSize", size))
    if block_size <= 0 or size % block_size != 0:
        raise RuntimeError(
            f"Bilateral symmetry {label} blockSize must divide channel size {size}"
        )
    permutation = np.asarray(definition.get("permutation"), dtype=np.int64)
    signs = np.asarray(definition.get("signs"), dtype=np.float64)
    if permutation.shape != (block_size,) or signs.shape != (block_size,):
        raise RuntimeError(
            f"Bilateral symmetry {label} requires {block_size} permutation and sign entries"
        )
    if sorted(permutation.tolist()) != list(range(block_size)):
        raise RuntimeError(
            f"Bilateral symmetry {label} permutation must contain each block index once"
        )
    if not np.all(np.isin(signs, (-1.0, 1.0))):
        raise RuntimeError(
            f"Bilateral symmetry {label} signs must contain only -1 or 1"
        )
    if not np.array_equal(permutation[permutation], np.arange(block_size)):
        raise RuntimeError(
            f"Bilateral symmetry {label} permutation must be an involution"
        )
    if not np.allclose(signs * signs[permutation], 1.0):
        raise RuntimeError(
            f"Bilateral symmetry {label} signs must invert back to identity"
        )
    blocks = size // block_size
    expanded_permutation = np.concatenate(
        [permutation + block * block_size for block in range(blocks)]
    )
    expanded_signs = np.tile(signs, blocks)
    return expanded_permutation, expanded_signs


def compile_bilateral_symmetry(
    definition: dict[str, Any] | None,
    observation_contract: dict[str, Any],
    action_size: int,
) -> BilateralSymmetry | None:
    """Validate a robot-authored reflection against the exact compiled ABI."""
    if definition is None:
        return None
    if definition.get("kind") != "lateral-reflection-v1":
        raise RuntimeError("Unsupported bilateral symmetry kind")
    coefficient = float(definition.get("policyConsistencyCoefficient", 0.0))
    if not np.isfinite(coefficient) or coefficient <= 0.0:
        raise RuntimeError(
            "Bilateral symmetry policyConsistencyCoefficient must be positive"
        )
    transforms = definition.get("observationTransforms")
    identities = definition.get("identityObservationChannels")
    if not isinstance(transforms, dict) or not isinstance(identities, list):
        raise RuntimeError(
            "Bilateral symmetry requires observationTransforms and identityObservationChannels"
        )
    channels = observation_contract["channels"]
    channel_names = [str(channel["name"]) for channel in channels]
    declared_names = set(map(str, transforms)) | set(map(str, identities))
    if declared_names != set(channel_names):
        missing = sorted(set(channel_names) - declared_names)
        unknown = sorted(declared_names - set(channel_names))
        raise RuntimeError(
            "Bilateral symmetry must classify every Observation channel exactly "
            f"(missing={missing}, unknown={unknown})"
        )
    overlap = set(map(str, transforms)) & set(map(str, identities))
    if overlap:
        raise RuntimeError(
            f"Bilateral symmetry channels cannot be transformed and identity: {sorted(overlap)}"
        )
    observation_size = int(observation_contract["size"])
    observation_permutation = np.arange(observation_size, dtype=np.int64)
    observation_signs = np.ones(observation_size, dtype=np.float64)
    offset = 0
    for channel in channels:
        name = str(channel["name"])
        size = int(channel["size"])
        if name in transforms:
            permutation, signs = _expand_symmetry_transform(
                size, transforms[name], f"Observation channel '{name}'"
            )
            observation_permutation[offset : offset + size] = (
                offset + permutation
            )
            observation_signs[offset : offset + size] = signs
        offset += size
    action_definition = definition.get("actionTransform")
    if not isinstance(action_definition, dict):
        raise RuntimeError("Bilateral symmetry requires an actionTransform")
    action_permutation, action_signs = _expand_symmetry_transform(
        action_size, action_definition, "Action"
    )
    canonical_contract = deepcopy(definition)
    canonical_contract["identityObservationChannels"] = [
        name for name in channel_names if name in set(map(str, identities))
    ]
    canonical_contract["observationSize"] = observation_size
    canonical_contract["actionSize"] = action_size
    canonical_contract["validatedInvolution"] = True
    return BilateralSymmetry(
        contract=canonical_contract,
        observation_permutation=observation_permutation,
        observation_signs=observation_signs,
        action_permutation=action_permutation,
        action_signs=action_signs,
    )


class RunningNormalizer:
    def __init__(self, size: int):
        self.count = 1e-4
        self.mean = np.zeros(size, dtype=np.float64)
        self.m2 = np.ones(size, dtype=np.float64) * 1e-4

    @property
    def variance(self) -> np.ndarray: return np.maximum(self.m2 / self.count, 1e-6)

    def update(self, value: np.ndarray) -> None:
        self.count += 1.0
        delta = value - self.mean
        self.mean += delta / self.count
        self.m2 += delta * (value - self.mean)

    def normalize(self, value: np.ndarray) -> np.ndarray: return ((value - self.mean) / np.sqrt(self.variance + 1e-8)).astype(np.float32)


def effective_action_transform(base: dict[str, Any] | None, config: dict[str, Any]) -> dict[str, Any] | None:
    transform = deepcopy(base)
    if "residualScale" in config:
        if transform is None:
            raise RuntimeError("Training residualScale requires a Trainer action transform")
        transform["residualScale"] = float(config["residualScale"])
        transform.pop("residualScaleByAction", None)
    return transform


def select_curriculum_index(
    weights: np.ndarray,
    completed_steps: np.ndarray,
    rng: np.random.Generator,
    sampling: str,
) -> int:
    if sampling == "episode-probability":
        return int(rng.choice(len(weights), p=weights))
    if sampling != "step-share":
        raise RuntimeError(f"Unsupported curriculum sampling '{sampling}'")
    total = float(completed_steps.sum())
    if total <= 0.0:
        return int(rng.choice(len(weights), p=weights))
    deficits = weights * total - completed_steps
    maximum = float(deficits.max())
    tied = np.flatnonzero(np.isclose(deficits, maximum, rtol=0.0, atol=1e-9))
    if tied.size == 1:
        return int(tied[0])
    tied_weights = weights[tied] / weights[tied].sum()
    return int(rng.choice(tied, p=tied_weights))


def select_progression_index(
    progression: list[dict[str, Any]], completed_steps: int
) -> int:
    for index, stage in enumerate(progression):
        if completed_steps < int(stage["untilStep"]):
            return index
    return len(progression) - 1


def mission_prefix_end_seconds(task: dict[str, Any], through_phase: str) -> float:
    if int(task.get("version", 0)) != 7:
        raise RuntimeError("Mission progression requires an integrated Mission Task")
    phases = task["missionPhases"]
    for index, phase in enumerate(phases):
        if phase["id"] != through_phase:
            continue
        if index + 1 < len(phases):
            return float(phases[index + 1]["atSeconds"])
        return float(task["durationSeconds"])
    raise RuntimeError(f"Mission progression names unknown phase '{through_phase}'")


def mission_progression_episode_limit(
    task: dict[str, Any],
    through_phase: str,
) -> dict[str, Any]:
    version = int(task.get("version", 0))
    if version == 7:
        return {"episodeEndSeconds": mission_prefix_end_seconds(task, through_phase)}
    if version == 8:
        if through_phase not in {str(phase["id"]) for phase in task["missionPhases"]}:
            raise RuntimeError(f"Mission progression names unknown phase '{through_phase}'")
        return {
            "episodeEndSeconds": float(task["durationSeconds"]),
            "episodeEndPhase": through_phase,
        }
    raise RuntimeError("Mission progression requires an integrated Mission Task")


def run_deterministic_mission_probe(
    *,
    request: dict[str, Any],
    curriculum: list[dict[str, Any]],
    network: PolicyNetwork,
    normalizer: RunningNormalizer,
    action_transform: dict[str, Any] | None,
    residual_scale_vector: np.ndarray | None,
    lows: np.ndarray,
    highs: np.ndarray,
    seed: int,
) -> dict[str, Any]:
    """Replay each Mission stage and Scenario with the frozen actor mean.

    Probe steps are evaluation-only: they neither update the normalizer/network
    nor consume the declared Training budget.
    """
    samples: list[dict[str, Any]] = []
    probe_index = 0
    network.eval()
    for curriculum_index, entry in enumerate(curriculum):
        for scenario in entry["scenarios"]:
            probe_index += 1
            environment_seed = seed + 30_000_000 + probe_index
            domain_seed = seed + 40_000_000 + probe_index
            effective_domain_profile = (
                entry.get("domainProfile") or request.get("domainProfile")
            )
            domain_sample = sample_domain_profile(
                effective_domain_profile, domain_seed
            )
            sample = mission_outcome_sample(
                episode=probe_index,
                curriculum_index=curriculum_index,
                entry=entry,
                scenario=scenario,
                environment_seed=environment_seed,
                domain_seed=domain_seed,
                domain_profile=effective_domain_profile,
                domain_profile_hash=entry.get("domainProfileHash")
                or request.get("domainProfileHash"),
                domain_sample=domain_sample,
                global_step_start=None,
            )
            environment = RobotEnvironment(
                Path(request["modelPath"]),
                request["compiled"],
                entry["task"],
                scenario,
                environment_seed,
                domain_sample,
                entry.get("episodeEndSeconds"),
                entry.get("episodeEndPhase"),
            )
            program_prior: Controller | None = None
            if (
                action_transform
                and action_transform.get("kind") == "program-controller-residual"
            ):
                program_prior = load_program_controller(
                    Path(request["priorControllerRoot"]),
                    request["priorController"],
                )
                program_prior.reset(environment_seed)
            observation_map = environment.reset()
            observation = environment.vector(observation_map)
            previous_target_satisfied = environment.recovery_target_satisfied()
            residual_gate_scale_state = 0.0
            while True:
                normalized = normalizer.normalize(observation)
                with torch.no_grad():
                    mean, _, _ = network(
                        torch.from_numpy(normalized).unsqueeze(0)
                    )
                raw_action = mean[0].numpy()
                prior_telemetry: dict[str, Any] | None = None
                if (
                    action_transform
                    and action_transform.get("kind")
                    == "program-controller-residual"
                ):
                    if program_prior is None or residual_scale_vector is None:
                        raise RuntimeError(
                            "Program residual deterministic probe has no prior"
                        )
                    prior_action = program_prior.act(
                        observation_map, float(environment.data.time)
                    )
                    telemetry_provider = getattr(program_prior, "telemetry", None)
                    prior_telemetry = (
                        telemetry_provider()
                        if telemetry_provider is not None
                        else None
                    )
                    if not isinstance(prior_telemetry, dict):
                        prior_telemetry = None
                    residual_gate_scale, _ = advance_program_residual_gate_scale(
                        action_transform,
                        program_prior,
                        observation_map,
                        residual_gate_scale_state,
                        environment.control_dt,
                        environment.runtime_state(),
                    )
                    residual_gate_scale_state = residual_gate_scale
                    transformed = (
                        prior_action
                        + residual_gate_scale
                        * residual_scale_vector
                        * raw_action
                    )
                    actor_authority = residual_gate_scale * float(
                        np.max(residual_scale_vector)
                    )
                else:
                    transformed = transform_policy_action(
                        raw_action,
                        observation_map,
                        action_transform,
                        float(environment.data.time),
                    )
                    actor_authority = 1.0
                result = environment.step(np.clip(transformed, lows, highs))
                sample["steps"] += 1
                sample["activePolicySteps"] += int(actor_authority > 0.0)
                sample["actorAuthoritySum"] += actor_authority
                previous_target_satisfied = record_mission_outcome_step(
                    sample,
                    result.info,
                    actor_authority,
                    previous_target_satisfied,
                    time_seconds=float(environment.data.time),
                    program_telemetry=prior_telemetry,
                )
                observation_map = result.observation
                observation = environment.vector(observation_map)
                if result.terminated or result.truncated:
                    sample["completed"] = True
                    sample["observedDurationSeconds"] = float(
                        environment.data.time
                    )
                    sample["missionCompleted"] = bool(
                        environment.mission_completed
                    )
                    sample["missionPrefixCompleted"] = bool(
                        environment.mission_prefix_completed
                    )
                    break
            samples.append(sample)
    return {
        "actionMode": "deterministic-actor-mean",
        "trainingBudgetCharged": False,
        "episodes": samples,
        "actuatorDelayCoverage": summarize_actuator_delay_coverage(samples),
        "lateralImpactPairAudit": summarize_lateral_impact_pairs(samples),
        "interventionTimingCoverage": summarize_intervention_timing(samples),
        "missionOutcomeCoverage": summarize_mission_outcomes(samples),
    }


def deterministic_checkpoint_rank(
    probe: dict[str, Any],
) -> dict[str, Any]:
    """Rank one frozen actor by complete-Mission, side-balanced Task evidence.

    This is intentionally not a Benchmark score. Training may select which
    frozen weights to publish, but the locked Judge remains the only promotion
    authority.
    """
    episodes = [
        sample
        for sample in probe.get("episodes", [])
        if sample.get("completeMissionStage") is True
    ]
    if not episodes:
        raise RuntimeError(
            "Deterministic checkpoint selection requires a complete Mission stage"
        )
    scenarios = sorted({str(sample["scenario"]) for sample in episodes})

    def minimum_per_scenario(value: Any) -> int:
        return min(
            sum(int(value(sample)) for sample in episodes if sample["scenario"] == scenario)
            for scenario in scenarios
        )

    timeout_free = lambda sample: bool(
        sample.get("missionCompleted")
        and int(sample.get("missionPhaseTimeoutCount", 0)) == 0
    )
    mission_completed = lambda sample: bool(sample.get("missionCompleted"))
    stable_transition = lambda sample: int(
        sample.get("recoveryStableTransitionCount", 0)
    )
    actor_target_entry = lambda sample: bool(
        int(sample.get("actorRecoveryTargetEntryCount", 0)) > 0
    )
    actor_contributed_target_entry = lambda sample: bool(
        int(sample.get("actorContributedRecoveryTargetEntryCount", 0)) > 0
    )
    progress = [
        float(sample.get("maximumRecoveryStableProgress", 0.0))
        for sample in episodes
    ]
    rank = {
        "scope": "complete-mission",
        "episodes": len(episodes),
        "scenarios": scenarios,
        "minimumTimeoutFreeMissionsPerScenario": minimum_per_scenario(timeout_free),
        "timeoutFreeMissionEpisodes": sum(int(timeout_free(sample)) for sample in episodes),
        "minimumCompletedMissionsPerScenario": minimum_per_scenario(mission_completed),
        "missionCompletedEpisodes": sum(int(mission_completed(sample)) for sample in episodes),
        "minimumRecoveryStableTransitionsPerScenario": minimum_per_scenario(stable_transition),
        "recoveryStableTransitionCount": sum(stable_transition(sample) for sample in episodes),
        "minimumActorContributedTargetEntryEpisodesPerScenario": minimum_per_scenario(actor_contributed_target_entry),
        "actorContributedTargetEntryEpisodes": sum(int(actor_contributed_target_entry(sample)) for sample in episodes),
        "minimumActorTargetEntryEpisodesPerScenario": minimum_per_scenario(actor_target_entry),
        "actorTargetEntryEpisodes": sum(int(actor_target_entry(sample)) for sample in episodes),
        "recoveryRelapseCount": sum(
            int(sample.get("recoveryRelapseCount", 0)) for sample in episodes
        ),
        "missionPhaseTimeoutEpisodes": sum(
            int(int(sample.get("missionPhaseTimeoutCount", 0)) > 0)
            for sample in episodes
        ),
        "minimumRecoveryStableProgress": min(progress),
        "meanRecoveryStableProgress": float(np.mean(progress)),
    }
    rank["comparisonKey"] = [
        rank["minimumTimeoutFreeMissionsPerScenario"],
        rank["timeoutFreeMissionEpisodes"],
        rank["minimumCompletedMissionsPerScenario"],
        rank["missionCompletedEpisodes"],
        rank["minimumRecoveryStableTransitionsPerScenario"],
        rank["recoveryStableTransitionCount"],
        rank["minimumActorContributedTargetEntryEpisodesPerScenario"],
        rank["actorContributedTargetEntryEpisodes"],
        rank["minimumActorTargetEntryEpisodesPerScenario"],
        rank["actorTargetEntryEpisodes"],
        -rank["recoveryRelapseCount"],
        -rank["missionPhaseTimeoutEpisodes"],
        rank["minimumRecoveryStableProgress"],
        rank["meanRecoveryStableProgress"],
    ]
    return rank


@dataclass
class PPOTrainer:
    hidden_sizes: list[int]
    action_transform: dict[str, Any] | None = None
    initial_log_std: float = -0.5
    history_encoder: dict[str, Any] | None = None
    bilateral_symmetry: dict[str, Any] | None = None

    def train(self, request: dict[str, Any], output_dir: Path) -> dict[str, Any]:
        config = request["training"]
        action_transform = effective_action_transform(self.action_transform, config)
        elite_replay_config = config.get("eliteReplay")
        deterministic_checkpoint_config = config.get("deterministicCheckpoint")
        if (
            deterministic_checkpoint_config
            and deterministic_checkpoint_config.get("scope") != "complete-mission"
        ):
            raise RuntimeError(
                "Deterministic checkpoint selection supports only complete Missions"
            )
        seed = int(request["seed"])
        random.seed(seed); np.random.seed(seed); torch.manual_seed(seed)
        torch.use_deterministic_algorithms(True, warn_only=True)
        progression = request.get("progression")
        curriculum = request.get("curriculum")
        if progression:
            if not request.get("task") or not request.get("scenarios"):
                raise RuntimeError("Mission progression requires one expanded Task and at least one Scenario")
            curriculum = [{
                **stage,
                "role": "mission-progression",
                "task": request["task"],
                "scenarios": request["scenarios"],
                **mission_progression_episode_limit(
                    request["task"], str(stage["throughPhase"])
                ),
            } for stage in progression]
        elif not curriculum:
            curriculum = [{
                "id": "legacy-training",
                "role": "skill",
                "weight": 1.0,
                "task": request["task"],
                "scenarios": request["scenarios"],
            }]
        progression_sampling = (
            str(config.get("progressionSampling", "sequential"))
            if progression
            else None
        )
        if progression_sampling not in (None, "sequential", "interleaved-step-share"):
            raise RuntimeError(
                f"Unsupported Mission progression sampling '{progression_sampling}'"
            )
        progression_step_budgets = (
            [
                int(entry["untilStep"])
                - (
                    0
                    if index == 0
                    else int(curriculum[index - 1]["untilStep"])
                )
                for index, entry in enumerate(curriculum)
            ]
            if progression
            else None
        )
        weights = np.asarray(
            progression_step_budgets
            if progression_step_budgets is not None
            else [float(entry["weight"]) for entry in curriculum],
            dtype=np.float64,
        )
        weights /= weights.sum()
        curriculum_sampling = (
            progression_sampling
            if progression
            else str(config.get("curriculumSampling", "episode-probability"))
        )
        curriculum_rng = np.random.default_rng(seed + 20_000_000)
        scenario_indices = {str(entry["id"]): 0 for entry in curriculum}
        curriculum_step_counts = np.zeros(len(curriculum), dtype=np.int64)
        curriculum_active_policy_steps = np.zeros(len(curriculum), dtype=np.int64)
        curriculum_actor_authority_sums = np.zeros(len(curriculum), dtype=np.float64)
        curriculum_learning_reward_sums = np.zeros(len(curriculum), dtype=np.float64)
        episode_index = 0
        completed_steps = 0
        domain_samples: list[dict[str, Any]] = []

        def make_environment() -> RobotEnvironment:
            nonlocal episode_index
            if progression and progression_sampling == "sequential":
                curriculum_index = select_progression_index(
                    curriculum, completed_steps
                )
            else:
                curriculum_index = select_curriculum_index(
                    weights,
                    curriculum_step_counts,
                    curriculum_rng,
                    "step-share"
                    if progression
                    else str(curriculum_sampling),
                )
            entry = curriculum[curriculum_index]
            entry_id = str(entry["id"])
            scenario_index = scenario_indices[entry_id]
            scenario = entry["scenarios"][scenario_index % len(entry["scenarios"])]
            scenario_indices[entry_id] = scenario_index + 1
            episode_index += 1
            episode_seed = seed + episode_index
            domain_seed = seed + 10_000_000 + episode_index
            effective_domain_profile = entry.get("domainProfile") or request.get("domainProfile")
            domain_sample = sample_domain_profile(effective_domain_profile, domain_seed)
            domain_samples.append(mission_outcome_sample(
                episode=episode_index,
                curriculum_index=curriculum_index,
                entry=entry,
                scenario=scenario,
                environment_seed=episode_seed,
                domain_seed=domain_seed,
                domain_profile=effective_domain_profile,
                domain_profile_hash=entry.get("domainProfileHash") or request.get("domainProfileHash"),
                domain_sample=domain_sample,
                global_step_start=completed_steps,
            ))
            return RobotEnvironment(
                Path(request["modelPath"]),
                request["compiled"],
                entry["task"],
                scenario,
                episode_seed,
                domain_sample,
                entry.get("episodeEndSeconds"),
                entry.get("episodeEndPhase"),
            )

        environment = make_environment()
        program_prior: Controller | None = None
        if action_transform and action_transform.get("kind") == "program-controller-residual":
            if not request.get("priorController") or not request.get("priorControllerRoot"): raise RuntimeError("Program residual Trainer requires a priorController")
            program_prior = load_program_controller(Path(request["priorControllerRoot"]), request["priorController"])
            program_prior.reset(seed + episode_index)
        observation_map = environment.reset(); observation = environment.vector(observation_map)
        episode_recovery_target_satisfied = environment.recovery_target_satisfied()
        observation_size = observation.size; action_size = environment.model.nu
        bilateral_symmetry = compile_bilateral_symmetry(
            self.bilateral_symmetry,
            request["compiled"]["observationContract"],
            action_size,
        )
        residual_scale_vector = (
            program_residual_scale_vector(action_transform, action_size)
            if action_transform
            and action_transform.get("kind") == "program-controller-residual"
            else None
        )
        residual_gate_scale_state = 0.0
        architecture: dict[str, Any] = {"kind": "mlp-actor-critic", "observationSize": observation_size, "actionSize": action_size, "hiddenSizes": self.hidden_sizes, "activation": "tanh", "distribution": "diagonal-normal"}
        if bilateral_symmetry:
            architecture["bilateralSymmetry"] = bilateral_symmetry.contract
        if self.history_encoder:
            offsets: dict[str, int] = {}; offset = 0
            for channel in request["compiled"]["observationContract"]["channels"]:
                offsets[channel["name"]] = offset; offset += int(channel["size"])
            architecture["kind"] = "history-gru-actor-critic"
            if "channels" in self.history_encoder:
                architecture["history"] = {
                    "channels": [
                        {
                            "start": offsets[str(channel["channel"])],
                            "steps": int(channel["steps"]),
                            "size": int(channel["size"]),
                        }
                        for channel in self.history_encoder["channels"]
                    ],
                    "recurrentSize": int(self.history_encoder["recurrentSize"]),
                }
            else:
                architecture["history"] = {
                    "commandStart": offsets[str(self.history_encoder["commandChannel"])],
                    "appliedStart": offsets[str(self.history_encoder["appliedChannel"])],
                    "steps": int(self.history_encoder["steps"]),
                    "actionSize": action_size,
                    "recurrentSize": int(self.history_encoder["recurrentSize"]),
                }
        network = create_policy_network(architecture)
        if self.action_transform:
            torch.nn.init.zeros_(network.actor.weight); torch.nn.init.zeros_(network.actor.bias)
        with torch.no_grad(): network.log_std.fill_(self.initial_log_std)
        optimizer = torch.optim.Adam(network.parameters(), lr=float(config["learningRate"]))
        normalizer = RunningNormalizer(observation_size)
        total_steps = int(config["totalSteps"]); rollout_steps = int(config["rolloutSteps"])
        metrics: list[dict[str, Any]] = []
        episode_reward = 0.0; completed_rewards: list[float] = []
        mission_phase_samples: dict[str, dict[str, Any]] = {}
        lows = np.asarray(request["compiled"]["actionLow"], dtype=np.float32); highs = np.asarray(request["compiled"]["actionHigh"], dtype=np.float32)
        elite_replay_observations: deque[np.ndarray] = deque(
            maxlen=int(elite_replay_config["capacity"])
            if elite_replay_config
            else 1
        )
        elite_replay_actions: deque[np.ndarray] = deque(
            maxlen=int(elite_replay_config["capacity"])
            if elite_replay_config
            else 1
        )
        elite_replay_rng = np.random.default_rng(seed + 50_000_000)
        episode_elite_candidates: list[tuple[np.ndarray, np.ndarray]] = []
        episode_elite_admitted = False
        elite_replay_admissions = 0
        elite_replay_mirrored_admissions = 0
        elite_replay_episode_admissions = 0
        elite_replay_admission_coverage: dict[str, dict[str, Any]] = {}
        deterministic_checkpoint_candidates: list[dict[str, Any]] = []
        selected_checkpoint_state: dict[str, torch.Tensor] | None = None
        selected_checkpoint_normalizer: dict[str, Any] | None = None
        selected_checkpoint_rank: dict[str, Any] | None = None
        selected_checkpoint_steps: int | None = None
        checkpoint_every_steps = (
            int(deterministic_checkpoint_config["everySteps"])
            if deterministic_checkpoint_config
            else total_steps
        )
        checkpoint_minimum_steps = (
            int(
                deterministic_checkpoint_config.get(
                    "minimumSteps", checkpoint_every_steps
                )
            )
            if deterministic_checkpoint_config
            else total_steps
        )
        next_checkpoint_step = max(
            checkpoint_every_steps,
            (
                (checkpoint_minimum_steps + checkpoint_every_steps - 1)
                // checkpoint_every_steps
            )
            * checkpoint_every_steps,
        )

        def consider_deterministic_checkpoint() -> None:
            nonlocal selected_checkpoint_state
            nonlocal selected_checkpoint_normalizer
            nonlocal selected_checkpoint_rank
            nonlocal selected_checkpoint_steps
            probe = run_deterministic_mission_probe(
                request=request,
                curriculum=curriculum,
                network=network,
                normalizer=normalizer,
                action_transform=action_transform,
                residual_scale_vector=residual_scale_vector,
                lows=lows,
                highs=highs,
                seed=seed,
            )
            rank = deterministic_checkpoint_rank(probe)
            deterministic_checkpoint_candidates.append({
                "steps": completed_steps,
                "rank": rank,
            })
            if (
                selected_checkpoint_rank is None
                or tuple(rank["comparisonKey"])
                > tuple(selected_checkpoint_rank["comparisonKey"])
            ):
                selected_checkpoint_state = {
                    name: tensor.detach().clone()
                    for name, tensor in network.state_dict().items()
                }
                selected_checkpoint_normalizer = {
                    "count": float(normalizer.count),
                    "mean": normalizer.mean.copy(),
                    "m2": normalizer.m2.copy(),
                }
                selected_checkpoint_rank = rank
                selected_checkpoint_steps = completed_steps
            network.train()

        while completed_steps < total_steps:
            batch_obs: list[np.ndarray] = []; batch_actions: list[np.ndarray] = []; batch_log_probs: list[float] = []; batch_rewards: list[float] = []; batch_dones: list[float] = []; batch_values: list[float] = []
            batch_mirrored_obs: list[np.ndarray] = []
            batch_base_rewards: list[float] = []; batch_quality_penalties: list[float] = []; batch_quality_terms: dict[str, list[float]] = {name: [] for name in QUALITY_REWARD_REFERENCES}
            batch_mission_bonuses: list[float] = []; batch_mission_terms: dict[str, list[float]] = {name: [] for name in ("commandProgress", "velocityTracking", "stopStability", "recoverySuccess", "recoveryRelapsePenalty", "phaseTimeoutPenalty", "timeoutFreeCompletion")}
            batch_recovery_bonuses: list[float] = []; batch_recovery_terms: dict[str, list[float]] = {name: [] for name in ("upright", "height", "stillness", "support", "tiltEscape", "taskTargetProgress", "taskTargetEntry")}
            batch_residual_gate_scales: list[float] = []
            batch_residual_l2: list[float] = []
            batch_policy_masks: list[float] = []
            batch_elite_replay_losses: list[float] = []
            batch_symmetry_losses: list[float] = []
            for _ in range(min(rollout_steps, total_steps - completed_steps)):
                normalizer.update(observation)
                if (
                    bilateral_symmetry
                    and bilateral_symmetry.contract.get(
                        "augmentNormalizer", False
                    )
                ):
                    normalizer.update(
                        bilateral_symmetry.mirror_observation(observation)
                    )
                normalized = normalizer.normalize(observation)
                mirrored_normalized = (
                    normalizer.normalize(
                        bilateral_symmetry.mirror_observation(observation)
                    )
                    if bilateral_symmetry
                    else None
                )
                obs_tensor = torch.from_numpy(normalized).unsqueeze(0)
                with torch.no_grad():
                    mean, value, log_std = network(obs_tensor); distribution = torch.distributions.Normal(mean, log_std.exp()); action_tensor = distribution.sample(); log_prob = distribution.log_prob(action_tensor).sum(-1)
                raw_action = action_tensor[0].numpy()
                prior_telemetry: dict[str, Any] | None = None
                if action_transform and action_transform.get("kind") == "program-controller-residual":
                    if program_prior is None: raise RuntimeError("Program residual prior is unavailable")
                    prior_action = program_prior.act(
                        observation_map, float(environment.data.time)
                    )
                    telemetry_provider = getattr(program_prior, "telemetry", None)
                    if telemetry_provider is not None:
                        provided = telemetry_provider()
                        if isinstance(provided, dict):
                            prior_telemetry = provided
                    residual_gate_scale, _ = advance_program_residual_gate_scale(
                        action_transform,
                        program_prior,
                        observation_map,
                        residual_gate_scale_state,
                        environment.control_dt,
                        environment.runtime_state(),
                    )
                    residual_gate_scale_state = residual_gate_scale
                    transformed = (
                        prior_action
                        + residual_gate_scale
                        * residual_scale_vector
                        * raw_action
                    )
                    batch_residual_gate_scales.append(residual_gate_scale)
                    batch_policy_masks.append(residual_gate_scale)
                    batch_residual_l2.append(
                        float(np.linalg.norm(raw_action) / np.sqrt(raw_action.size))
                    )
                else:
                    transformed = transform_policy_action(raw_action, observation_map, action_transform, float(environment.data.time))
                    batch_policy_masks.append(1.0)
                actor_authority = float(batch_policy_masks[-1]) * (
                    float(np.max(residual_scale_vector))
                    if residual_scale_vector is not None
                    else 1.0
                )
                if elite_replay_config and actor_authority > 0.0:
                    episode_elite_candidates.append(
                        (observation.copy(), raw_action.astype(np.float32))
                    )
                    tail_steps = int(elite_replay_config["tailSteps"])
                    if len(episode_elite_candidates) > tail_steps:
                        del episode_elite_candidates[:-tail_steps]
                action = np.clip(transformed, lows, highs)
                result = environment.step(action)
                quality_penalty, quality_terms = quality_reward_penalty(result.info, config.get("qualityReward"))
                mission_bonus, mission_terms = mission_reward_bonus(result.info, config.get("missionReward"), actor_authority)
                recovery_bonus, recovery_terms = recovery_reward_bonus(
                    result.info,
                    prior_telemetry,
                    config.get("recoveryReward"),
                    actor_authority,
                )
                learning_reward = result.reward - quality_penalty + mission_bonus + recovery_bonus
                curriculum_index = int(domain_samples[-1]["curriculumIndex"])
                curriculum_active_policy_steps[curriculum_index] += int(actor_authority > 0.0)
                curriculum_actor_authority_sums[curriculum_index] += actor_authority
                curriculum_learning_reward_sums[curriculum_index] += learning_reward
                episode_sample = domain_samples[-1]
                episode_sample["activePolicySteps"] += int(actor_authority > 0.0)
                episode_sample["actorAuthoritySum"] += actor_authority
                previous_target_satisfied = episode_recovery_target_satisfied
                previous_contributed_target_entries = int(
                    episode_sample.get(
                        "actorContributedRecoveryTargetEntryCount", 0
                    )
                )
                episode_recovery_target_satisfied = record_mission_outcome_step(
                    episode_sample,
                    result.info,
                    actor_authority,
                    episode_recovery_target_satisfied,
                    time_seconds=float(environment.data.time),
                    program_telemetry=prior_telemetry,
                )
                actor_target_entry = bool(
                    actor_authority > 0.0
                    and episode_recovery_target_satisfied
                    and not previous_target_satisfied
                )
                actor_contributed_target_entry = bool(
                    int(
                        episode_sample.get(
                            "actorContributedRecoveryTargetEntryCount", 0
                        )
                    )
                    > previous_contributed_target_entries
                )
                elite_triggered = bool(
                    elite_replay_config
                    and (
                        actor_target_entry
                        if elite_replay_config["trigger"]
                        == "actor-recovery-target-entry"
                        else actor_contributed_target_entry
                    )
                )
                if (
                    elite_replay_config
                    and elite_triggered
                    and not episode_elite_admitted
                    and (
                        elite_replay_config.get("scope", "all-progression")
                        == "all-progression"
                        or episode_sample.get("completeMissionStage") is True
                    )
                ):
                    for elite_observation, elite_action in episode_elite_candidates:
                        elite_replay_observations.append(elite_observation)
                        elite_replay_actions.append(elite_action)
                        if (
                            bilateral_symmetry
                            and bilateral_symmetry.contract.get(
                                "mirrorEliteReplay", False
                            )
                        ):
                            elite_replay_observations.append(
                                bilateral_symmetry.mirror_observation(
                                    elite_observation
                                ).astype(np.float32)
                            )
                            elite_replay_actions.append(
                                bilateral_symmetry.mirror_action(
                                    elite_action
                                ).astype(np.float32)
                            )
                            elite_replay_mirrored_admissions += 1
                    elite_replay_admissions += len(episode_elite_candidates)
                    elite_replay_episode_admissions += 1
                    admission_key = (
                        f"{episode_sample['curriculum']}:"
                        f"{episode_sample['scenario']}"
                    )
                    admission = elite_replay_admission_coverage.setdefault(
                        admission_key,
                        {
                            "curriculum": episode_sample["curriculum"],
                            "scenario": episode_sample["scenario"],
                            "completeMissionStage": bool(
                                episode_sample.get("completeMissionStage")
                            ),
                            "episodes": 0,
                            "transitions": 0,
                            "mirroredTransitions": 0,
                        },
                    )
                    admission["episodes"] += 1
                    admission["transitions"] += len(episode_elite_candidates)
                    admission["mirroredTransitions"] += (
                        len(episode_elite_candidates)
                        if bilateral_symmetry
                        and bilateral_symmetry.contract.get(
                            "mirrorEliteReplay", False
                        )
                        else 0
                    )
                    episode_elite_admitted = True
                episode_reward += learning_reward
                done = result.terminated or result.truncated
                batch_obs.append(normalized); batch_actions.append(raw_action.astype(np.float32)); batch_log_probs.append(float(log_prob.item())); batch_rewards.append(learning_reward); batch_dones.append(float(done)); batch_values.append(float(value.item()))
                if mirrored_normalized is not None:
                    batch_mirrored_obs.append(mirrored_normalized)
                batch_base_rewards.append(result.reward); batch_quality_penalties.append(quality_penalty)
                for name, value in quality_terms.items(): batch_quality_terms[name].append(value)
                batch_mission_bonuses.append(mission_bonus)
                for name, value in mission_terms.items(): batch_mission_terms[name].append(value)
                batch_recovery_bonuses.append(recovery_bonus)
                for name, value in recovery_terms.items(): batch_recovery_terms[name].append(value)
                phase_id = result.info.get("missionPhase")
                if phase_id is not None:
                    curriculum_id = str(domain_samples[-1]["curriculum"])
                    phase_key = f"{curriculum_id}:{phase_id}"
                    sample = mission_phase_samples.setdefault(phase_key, {
                        "curriculum": curriculum_id,
                        "role": domain_samples[-1]["role"],
                        "task": domain_samples[-1]["task"],
                        "phase": str(phase_id),
                        "intent": result.info.get("missionIntent"),
                        "steps": 0,
                        "activePolicySteps": 0,
                        "actorAuthoritySum": 0.0,
                        "baseRewardSum": 0.0,
                        "missionRewardSum": 0.0,
                        "recoveryRewardSum": 0.0,
                        "learningRewardSum": 0.0,
                        "qualityPenaltySum": 0.0,
                        "commandedProgressM": 0.0,
                    })
                    sample["steps"] += 1
                    sample["activePolicySteps"] += int(actor_authority > 0.0)
                    sample["actorAuthoritySum"] += actor_authority
                    sample["baseRewardSum"] += float(result.reward)
                    sample["missionRewardSum"] += mission_bonus
                    sample["recoveryRewardSum"] += recovery_bonus
                    sample["learningRewardSum"] += learning_reward
                    sample["qualityPenaltySum"] += quality_penalty
                    sample["commandedProgressM"] += float(result.info.get("commandedProgressDeltaM", 0.0))
                observation_map = result.observation; observation = environment.vector(observation_map); completed_steps += 1
                domain_samples[-1]["steps"] += 1
                curriculum_step_counts[int(domain_samples[-1]["curriculumIndex"])] += 1
                if done:
                    domain_samples[-1]["completed"] = True
                    domain_samples[-1]["observedDurationSeconds"] = float(environment.data.time)
                    domain_samples[-1]["missionCompleted"] = bool(environment.mission_completed)
                    domain_samples[-1]["missionPrefixCompleted"] = bool(environment.mission_prefix_completed)
                    completed_rewards.append(episode_reward); episode_reward = 0.0
                    if completed_steps < total_steps:
                        environment = make_environment()
                        if program_prior is not None: program_prior = load_program_controller(Path(request["priorControllerRoot"]), request["priorController"]); program_prior.reset(seed + episode_index)
                        residual_gate_scale_state = 0.0
                        episode_elite_candidates = []
                        episode_elite_admitted = False
                        observation_map = environment.reset(); observation = environment.vector(observation_map)
                        episode_recovery_target_satisfied = environment.recovery_target_satisfied()
            with torch.no_grad():
                normalized = normalizer.normalize(observation); _, next_value, _ = network(torch.from_numpy(normalized).unsqueeze(0)); bootstrap = float(next_value.item())
            advantages = np.zeros(len(batch_rewards), dtype=np.float32); last_advantage = 0.0
            for index in reversed(range(len(batch_rewards))):
                next_nonterminal = 1.0 - batch_dones[index]
                following = bootstrap if index == len(batch_rewards) - 1 else batch_values[index + 1]
                delta = batch_rewards[index] + float(config["gamma"]) * following * next_nonterminal - batch_values[index]
                last_advantage = delta + float(config["gamma"]) * float(config["gaeLambda"]) * next_nonterminal * last_advantage
                advantages[index] = last_advantage
            returns = advantages + np.asarray(batch_values, dtype=np.float32)
            policy_masks = np.asarray(batch_policy_masks, dtype=np.float32)
            advantages = normalize_masked_advantages(advantages, policy_masks)
            tensors = (torch.tensor(np.asarray(batch_obs)), torch.tensor(np.asarray(batch_actions)), torch.tensor(np.asarray(batch_log_probs)), torch.tensor(advantages), torch.tensor(returns), torch.tensor(policy_masks))
            mirrored_observation_tensor = (
                torch.tensor(np.asarray(batch_mirrored_obs))
                if bilateral_symmetry
                else None
            )
            losses: list[float] = []
            indices = np.arange(len(batch_rewards))
            for _ in range(int(config["epochs"])):
                np.random.shuffle(indices)
                for start in range(0, len(indices), int(config["minibatchSize"])):
                    selected = indices[start:start + int(config["minibatchSize"])]
                    obs_t, action_t, old_log_t, advantage_t, return_t, policy_mask_t = (tensor[selected] for tensor in tensors)
                    mean, value, log_std = network(obs_t); distribution = torch.distributions.Normal(mean, log_std.exp()); new_log = distribution.log_prob(action_t).sum(-1); entropy = masked_mean(distribution.entropy().sum(-1), policy_mask_t)
                    ratio = (new_log - old_log_t).exp(); clipped = torch.clamp(ratio, 1.0 - float(config["clipRatio"]), 1.0 + float(config["clipRatio"]))
                    policy_loss = -masked_mean(torch.min(ratio * advantage_t, clipped * advantage_t), policy_mask_t); value_loss = 0.5 * torch.square(value - return_t).mean()
                    residual_penalty = float(config.get("residualPenalty", 0.0)) * masked_mean(torch.square(mean).mean(dim=-1), policy_mask_t)
                    elite_replay_loss = torch.zeros((), dtype=mean.dtype)
                    symmetry_loss = torch.zeros((), dtype=mean.dtype)
                    if bilateral_symmetry and mirrored_observation_tensor is not None:
                        mirrored_mean, _, _ = network(
                            mirrored_observation_tensor[selected]
                        )
                        symmetry_error = torch.square(
                            mirrored_mean
                            - bilateral_symmetry.mirror_action_tensor(mean)
                        ).mean(dim=-1)
                        symmetry_loss = float(
                            bilateral_symmetry.contract[
                                "policyConsistencyCoefficient"
                            ]
                        ) * masked_mean(symmetry_error, policy_mask_t)
                        batch_symmetry_losses.append(
                            float(symmetry_loss.detach().item())
                        )
                    if elite_replay_config and elite_replay_observations:
                        elite_batch_size = min(
                            int(elite_replay_config["minibatchSize"]),
                            len(elite_replay_observations),
                        )
                        elite_indices = elite_replay_rng.integers(
                            0,
                            len(elite_replay_observations),
                            size=elite_batch_size,
                        )
                        elite_observations = normalizer.normalize(np.asarray([
                            elite_replay_observations[int(index)]
                            for index in elite_indices
                        ]))
                        elite_actions = np.asarray([
                            elite_replay_actions[int(index)]
                            for index in elite_indices
                        ])
                        elite_mean, _, _ = network(
                            torch.tensor(elite_observations)
                        )
                        elite_replay_loss = float(
                            elite_replay_config["coefficient"]
                        ) * torch.square(
                            elite_mean - torch.tensor(elite_actions)
                        ).mean()
                        batch_elite_replay_losses.append(
                            float(elite_replay_loss.detach().item())
                        )
                    loss = policy_loss + value_loss + residual_penalty + elite_replay_loss + symmetry_loss - float(config["entropyCoefficient"]) * entropy
                    optimizer.zero_grad(); loss.backward(); torch.nn.utils.clip_grad_norm_(network.parameters(), 0.5); optimizer.step(); losses.append(float(loss.item()))
            metrics.append({
                "steps": completed_steps, "meanLoss": float(np.mean(losses)), "meanEpisodeReward": float(np.mean(completed_rewards[-10:])) if completed_rewards else episode_reward,
                "meanBaseReward": float(np.mean(batch_base_rewards)), "meanQualityPenalty": float(np.mean(batch_quality_penalties)),
                "meanQualityTerms": {name: float(np.mean(values)) if values else 0.0 for name, values in batch_quality_terms.items()},
                "meanMissionReward": float(np.mean(batch_mission_bonuses)),
                "meanMissionTerms": {name: float(np.mean(values)) if values else 0.0 for name, values in batch_mission_terms.items()},
                "meanRecoveryReward": float(np.mean(batch_recovery_bonuses)),
                "meanRecoveryTerms": {name: float(np.mean(values)) if values else 0.0 for name, values in batch_recovery_terms.items()},
                "meanResidualGateScale": float(np.mean(batch_residual_gate_scales)) if batch_residual_gate_scales else None,
                "meanResidualL2": float(np.mean(batch_residual_l2)) if batch_residual_l2 else None,
                "activePolicyFraction": float(np.mean(policy_masks > 0.0)),
                "meanEliteReplayLoss": float(np.mean(batch_elite_replay_losses)) if batch_elite_replay_losses else None,
                "meanBilateralSymmetryLoss": float(np.mean(batch_symmetry_losses)) if batch_symmetry_losses else None,
                "eliteReplayTransitions": len(elite_replay_observations),
                "eliteReplayEpisodeAdmissions": elite_replay_episode_admissions,
            })
            if deterministic_checkpoint_config and (
                completed_steps >= next_checkpoint_step
                or completed_steps == total_steps
            ):
                consider_deterministic_checkpoint()
                while next_checkpoint_step <= completed_steps:
                    next_checkpoint_step += checkpoint_every_steps

        deterministic_checkpoint_selection: dict[str, Any] | None = None
        if deterministic_checkpoint_config:
            if (
                not deterministic_checkpoint_candidates
                or deterministic_checkpoint_candidates[-1]["steps"]
                != completed_steps
            ):
                consider_deterministic_checkpoint()
            if (
                selected_checkpoint_state is None
                or selected_checkpoint_normalizer is None
                or selected_checkpoint_rank is None
                or selected_checkpoint_steps is None
            ):
                raise RuntimeError("Deterministic checkpoint selection found no candidate")
            network.load_state_dict(selected_checkpoint_state)
            normalizer.count = selected_checkpoint_normalizer["count"]
            normalizer.mean = selected_checkpoint_normalizer["mean"]
            normalizer.m2 = selected_checkpoint_normalizer["m2"]
            for candidate in deterministic_checkpoint_candidates:
                candidate["selected"] = (
                    candidate["steps"] == selected_checkpoint_steps
                )
            deterministic_checkpoint_selection = {
                **deterministic_checkpoint_config,
                "trainingBudgetCharged": False,
                "comparisonOrder": [
                    "minimumTimeoutFreeMissionsPerScenario",
                    "timeoutFreeMissionEpisodes",
                    "minimumCompletedMissionsPerScenario",
                    "missionCompletedEpisodes",
                    "minimumRecoveryStableTransitionsPerScenario",
                    "recoveryStableTransitionCount",
                    "minimumActorContributedTargetEntryEpisodesPerScenario",
                    "actorContributedTargetEntryEpisodes",
                    "minimumActorTargetEntryEpisodesPerScenario",
                    "actorTargetEntryEpisodes",
                    "negativeRecoveryRelapseCount",
                    "negativeMissionPhaseTimeoutEpisodes",
                    "minimumRecoveryStableProgress",
                    "meanRecoveryStableProgress",
                ],
                "tieBreak": "earliest-checkpoint",
                "latestTrainedSteps": completed_steps,
                "selectedSteps": selected_checkpoint_steps,
                "restoredEarlierCheckpoint": selected_checkpoint_steps
                != completed_steps,
                "selectedRank": selected_checkpoint_rank,
                "candidates": deterministic_checkpoint_candidates,
            }
        deterministic_mission_probe = (
            run_deterministic_mission_probe(
                request=request,
                curriculum=curriculum,
                network=network,
                normalizer=normalizer,
                action_transform=action_transform,
                residual_scale_vector=residual_scale_vector,
                lows=lows,
                highs=highs,
                seed=seed,
            )
            if progression
            else None
        )
        torch.save(network.state_dict(), output_dir / "model.pt")
        if action_transform and action_transform.get("kind") == "program-controller-residual":
            prior_dir = output_dir / "prior"; prior_definition = request["priorController"]
            shutil.copytree(Path(request["priorControllerRoot"]), prior_dir, ignore=shutil.ignore_patterns(".DS_Store", "__pycache__"))
            action_transform = {**action_transform, "controllerId": prior_definition["id"], "controllerHash": request["priorControllerHash"]}
        write_json(output_dir / "architecture.json", {**architecture, "actionTransform": action_transform})
        write_json(output_dir / "normalizer.json", {"count": normalizer.count, "mean": normalizer.mean.tolist(), "variance": normalizer.variance.tolist()})
        write_json(output_dir / "training-metrics.json", {
            "updates": metrics, "totalSteps": completed_steps, "episodes": len(completed_rewards),
            "finalMeanEpisodeReward": float(np.mean(completed_rewards[-10:])) if completed_rewards else episode_reward,
            "qualityRewardReferences": QUALITY_REWARD_REFERENCES,
            "trainingMode": "mission-progression" if progression else "curriculum",
            "curriculumSampling": curriculum_sampling,
            "domainProfile": {
                "id": request["domainProfile"]["id"],
                "hash": request["domainProfileHash"],
                "evidenceHash": request.get("domainProfileEvidenceHash"),
                "provenance": request["domainProfile"]["provenance"],
            } if request.get("domainProfile") else None,
            "domainSamples": domain_samples,
            "domainCoverage": summarize_domain_samples(domain_samples),
            "actuatorDelayCoverage": summarize_actuator_delay_coverage(
                domain_samples
            ),
            "lateralImpactPairAudit": summarize_lateral_impact_pairs(
                domain_samples
            ),
            "interventionTimingCoverage": summarize_intervention_timing(
                domain_samples
            ),
            "bilateralSymmetry": {
                **bilateral_symmetry.contract,
                "normalizerSamplesPerEnvironmentStep": (
                    2
                    if bilateral_symmetry.contract.get(
                        "augmentNormalizer", False
                    )
                    else 1
                ),
                "sourceEliteReplayTransitions": elite_replay_admissions,
                "mirroredEliteReplayTransitions": (
                    elite_replay_mirrored_admissions
                ),
            } if bilateral_symmetry else None,
            "missionOutcomeActionMode": "stochastic-sampled",
            "missionOutcomeCoverage": summarize_mission_outcomes(domain_samples),
            "deterministicMissionProbe": deterministic_mission_probe,
            "deterministicCheckpointSelection": deterministic_checkpoint_selection,
            "eliteReplay": {
                **elite_replay_config,
                "admittedTransitions": elite_replay_admissions,
                "mirroredTransitions": elite_replay_mirrored_admissions,
                "retainedTransitions": len(elite_replay_observations),
                "admittedEpisodes": elite_replay_episode_admissions,
                "admissionCoverage": dict(
                    sorted(elite_replay_admission_coverage.items())
                ),
            } if elite_replay_config else None,
            "progressionSampling": progression_sampling,
            "curriculumCoverage": {
                str(entry["id"]): {
                    "role": entry["role"],
                    "weight": float(entry["weight"]),
                    "targetStepShare": float(weights[index]),
                    "episodesStarted": sum(sample["curriculum"] == entry["id"] for sample in domain_samples),
                    "episodesCompleted": sum(sample["curriculum"] == entry["id"] and sample["completed"] for sample in domain_samples),
                    "steps": int(curriculum_step_counts[index]),
                    "actualStepShare": float(curriculum_step_counts[index] / completed_steps),
                    "stepShareDeviation": float(curriculum_step_counts[index] / completed_steps - weights[index]),
                    "activePolicySteps": int(curriculum_active_policy_steps[index]),
                    "activePolicyFraction": float(curriculum_active_policy_steps[index] / max(curriculum_step_counts[index], 1)),
                    "meanActorAuthority": float(curriculum_actor_authority_sums[index] / max(curriculum_step_counts[index], 1)),
                    "meanLearningReward": float(curriculum_learning_reward_sums[index] / max(curriculum_step_counts[index], 1)),
                }
                for index, entry in enumerate(curriculum)
            } if not progression else None,
            "missionProgression": {
                str(entry["id"]): {
                    "throughPhase": entry["throughPhase"],
                    "sampling": progression_sampling,
                    "quotaSteps": int(progression_step_budgets[index]),
                    "targetStepShare": float(weights[index]),
                    "actualStepShare": float(
                        curriculum_step_counts[index] / completed_steps
                    ),
                    "stepShareDeviation": float(
                        curriculum_step_counts[index] / completed_steps
                        - weights[index]
                    ),
                    "scheduledStartStep": (
                        0
                        if index == 0
                        else int(curriculum[index - 1]["untilStep"])
                    ) if progression_sampling == "sequential" else None,
                    "scheduledUntilStep": (
                        int(entry["untilStep"])
                        if progression_sampling == "sequential"
                        else None
                    ),
                    "episodeEndSeconds": float(entry["episodeEndSeconds"]),
                    "episodeEndPhase": entry.get("episodeEndPhase"),
                    "meanObservedDurationSeconds": float(np.mean([
                        float(sample["observedDurationSeconds"])
                        for sample in domain_samples
                        if sample["curriculum"] == entry["id"] and sample.get("observedDurationSeconds") is not None
                    ])) if any(sample["curriculum"] == entry["id"] and sample.get("observedDurationSeconds") is not None for sample in domain_samples) else None,
                    "domainProfileId": entry["domainProfile"]["id"] if entry.get("domainProfile") else (
                        request["domainProfile"]["id"] if request.get("domainProfile") else None
                    ),
                    "domainProfileHash": entry.get("domainProfileHash") or request.get("domainProfileHash"),
                    "episodesStarted": sum(sample["curriculum"] == entry["id"] for sample in domain_samples),
                    "episodesCompleted": sum(sample["curriculum"] == entry["id"] and sample["completed"] for sample in domain_samples),
                    "steps": int(curriculum_step_counts[index]),
                    "observedStartStep": min(
                        (int(sample["globalStepStart"]) for sample in domain_samples if sample["curriculum"] == entry["id"]),
                        default=None,
                    ),
                    "observedEndStep": max(
                        (int(sample["globalStepStart"]) + int(sample["steps"]) for sample in domain_samples if sample["curriculum"] == entry["id"]),
                        default=None,
                    ),
                    "activePolicySteps": int(curriculum_active_policy_steps[index]),
                    "activePolicyFraction": float(curriculum_active_policy_steps[index] / max(curriculum_step_counts[index], 1)),
                    "meanActorAuthority": float(curriculum_actor_authority_sums[index] / max(curriculum_step_counts[index], 1)),
                    "meanLearningReward": float(curriculum_learning_reward_sums[index] / max(curriculum_step_counts[index], 1)),
                }
                for index, entry in enumerate(curriculum)
            } if progression else None,
            "missionPhaseCoverage": {
                key: {
                    "curriculum": sample["curriculum"],
                    "role": sample["role"],
                    "task": sample["task"],
                    "phase": sample["phase"],
                    "intent": sample["intent"],
                    "steps": sample["steps"],
                    "activePolicySteps": sample["activePolicySteps"],
                    "activePolicyFraction": sample["activePolicySteps"] / sample["steps"],
                    "meanActorAuthority": sample["actorAuthoritySum"] / sample["steps"],
                    "meanBaseReward": sample["baseRewardSum"] / sample["steps"],
                    "meanMissionReward": sample["missionRewardSum"] / sample["steps"],
                    "meanRecoveryReward": sample["recoveryRewardSum"] / sample["steps"],
                    "meanLearningReward": sample["learningRewardSum"] / sample["steps"],
                    "meanQualityPenalty": sample["qualityPenaltySum"] / sample["steps"],
                    "commandedProgressM": sample["commandedProgressM"],
                }
                for key, sample in mission_phase_samples.items()
            },
        })
        return {
            "totalSteps": completed_steps,
            "updates": len(metrics),
            "episodes": len(completed_rewards),
            "finalMeanEpisodeReward": float(np.mean(completed_rewards[-10:]))
            if completed_rewards
            else episode_reward,
            "selectedCheckpointSteps": selected_checkpoint_steps,
            "restoredEarlierCheckpoint": bool(
                deterministic_checkpoint_selection
                and deterministic_checkpoint_selection[
                    "restoredEarlierCheckpoint"
                ]
            ),
        }


def assert_domain_profile_plant_compatible(request: dict[str, Any]) -> None:
    profiles = [request.get("domainProfile")]
    profiles.extend(stage.get("domainProfile") for stage in request.get("progression") or [])
    for profile in profiles:
        if profile and profile.get("plantHash") is not None and profile["plantHash"] != request["compiled"]["plantHash"]:
            raise RuntimeError(f"Training Domain Profile '{profile['id']}' plantHash does not match compiled Assembly '{request['compiled']['id']}'")


def train(request: dict[str, Any]) -> dict[str, Any]:
    project_dir = Path(request["projectDir"]); trainer_root = Path(request["trainerRoot"]); definition = request["trainer"]
    assert_domain_profile_plant_compatible(request)
    module = load_python_module((trainer_root / definition["entry"]).resolve(), f"mujica_trainer_{definition['id'].replace('-', '_')}")
    trainer = module.create_trainer()
    run_key = hash_json({"runtimeVersion": request["runtimeVersion"], "runtimeSourceHash": request["runtimeSourceHash"], "harnessSourceHash": request["harnessSourceHash"], "harnessDependencyLockHash": request["harnessDependencyLockHash"], "mujocoVersion": mujoco.__version__, "torchVersion": torch.__version__, "assemblyHash": request["compiled"]["assemblyHash"], "plantHash": request["compiled"]["plantHash"], "trainerHash": request["trainerHash"], "priorControllerHash": request.get("priorControllerHash"), "domainProfile": request.get("domainProfile"), "domainProfileHash": request.get("domainProfileHash"), "domainProfileEvidenceHash": request.get("domainProfileEvidenceHash"), "training": request["training"], "task": request.get("task"), "scenarios": request.get("scenarios"), "curriculum": request.get("curriculum"), "progression": request.get("progression"), "seed": request["seed"], "dependencyLockHash": request["dependencyLockHash"]})
    training_run_id = f"training-{run_key[:16]}"; training_run = project_dir / "training-runs" / training_run_id
    if (training_run / "manifest.json").exists(): return {**json.loads((training_run / "result.json").read_text()), "artifactPath": str(training_run), "cached": True}
    policy_result: dict[str, Any] = {}

    def run_writer(directory: Path) -> None:
        nonlocal policy_result
        work = directory / "work"; work.mkdir()
        started = time.time(); training_metrics = trainer.train(request, work); elapsed = time.time() - started
        model_hash = hash_file(work / "model.pt")
        observation_hash = hash_json(request["compiled"]["observationContract"]); action_hash = hash_json(request["compiled"]["actionContract"])
        policy_identity = {"runtimeVersion": request["runtimeVersion"], "runtimeSourceHash": request["runtimeSourceHash"], "harnessSourceHash": request["harnessSourceHash"], "harnessDependencyLockHash": request["harnessDependencyLockHash"], "mujocoVersion": mujoco.__version__, "torchVersion": torch.__version__, "trainerHash": request["trainerHash"], "priorControllerHash": request.get("priorControllerHash"), "domainProfileId": request["domainProfile"]["id"] if request.get("domainProfile") else None, "domainProfileHash": request.get("domainProfileHash"), "domainProfileEvidenceHash": request.get("domainProfileEvidenceHash"), "trainingHash": hash_json(request["training"]), "assemblyHash": request["compiled"]["assemblyHash"], "executionHash": request["compiled"]["executionHash"], "modelXmlHash": request["compiled"]["modelHash"], "plantHash": request["compiled"]["plantHash"], "catalogHash": request["compiled"]["catalogHash"], "observationContractHash": observation_hash, "actionContractHash": action_hash, "taskHash": hash_json(request["task"]) if request.get("task") else None, "scenarioHashes": [hash_json(item) for item in request.get("scenarios", [])], "curriculumHash": hash_json(request["curriculum"]) if request.get("curriculum") else None, "progressionHash": hash_json(request["progression"]) if request.get("progression") else None, "seed": request["seed"], "budget": request["training"]["totalSteps"], "dependencyLockHash": request["dependencyLockHash"], "modelHash": model_hash}
        policy_id = f"{request['training']['id']}-{hash_json(policy_identity)[:16]}"; policy_dir = project_dir / "policies" / policy_id
        reuse_policy = False
        if policy_dir.exists():
            existing = json.loads((policy_dir / "manifest.json").read_text())
            if existing.get("modelHash") != model_hash: raise RuntimeError(f"Policy identity collision with different model: {policy_dir}")
            reuse_policy = True

        def policy_writer(target: Path) -> None:
            for name in ["model.pt", "architecture.json", "normalizer.json", "training-metrics.json"]: shutil.copy2(work / name, target / name)
            if (work / "prior").exists(): shutil.copytree(work / "prior", target / "prior")
            write_json(target / "observation-contract.json", request["compiled"]["observationContract"]); write_json(target / "action-contract.json", request["compiled"]["actionContract"])
            write_json(target / "training-config.json", request["training"]); write_json(target / "source-hashes.json", request["sourceHashes"])
            if request.get("domainProfile"):
                write_json(target / "domain-profile.json", {
                    "definition": request["domainProfile"],
                    "evidenceHash": request.get("domainProfileEvidenceHash"),
                    "hash": request["domainProfileHash"],
                })
            if request.get("progression"):
                write_json(target / "mission-progression.json", [{
                    "id": stage["id"],
                    "throughPhase": stage["throughPhase"],
                    "untilStep": stage["untilStep"],
                    "domainProfile": stage.get("domainProfile"),
                    "domainProfileEvidenceHash": stage.get("domainProfileEvidenceHash"),
                    "domainProfileHash": stage.get("domainProfileHash"),
                } for stage in request["progression"]])
            write_json(target / "manifest.json", {"version": 1, "id": policy_id, **policy_identity, "hardware": hardware_info(), "trainingDeterminism": "best-effort", "evaluationDeterminism": "same-environment-bitwise-intended", "createdByTrainingRun": training_run_id})
        if not reuse_policy: atomic_directory(policy_dir, policy_writer)
        policy_result = {"trainingRunId": training_run_id, "policyId": policy_id, "policyPath": str(policy_dir), "modelHash": model_hash, "trainingMetrics": training_metrics, "elapsedSeconds": elapsed}
        write_json(directory / "request.json", request); write_json(directory / "result.json", policy_result)
        write_json(directory / "manifest.json", {"version": 1, "id": training_run_id, "runKey": run_key, "policyId": policy_id, "completed": True})
        shutil.rmtree(work)
    atomic_directory(training_run, run_writer)
    return {**policy_result, "artifactPath": str(training_run), "cached": False}
