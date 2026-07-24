from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import mujoco
import numpy as np


@dataclass
class StepResult:
    observation: dict[str, np.ndarray]
    reward: float
    terminated: bool
    truncated: bool
    info: dict[str, Any]


def motion_command_vector(command: dict[str, Any]) -> np.ndarray:
    return np.asarray([*command["linearVelocityMps"], command["yawRateRadPerSec"]], dtype=np.float64)


def compile_motion_command_schedule(task: dict[str, Any]) -> list[dict[str, Any]]:
    if int(task["version"]) in (2, 4):
        return [{"atStep": 0, "atSeconds": 0.0, "command": motion_command_vector(task["motionCommand"])}]
    if int(task["version"]) not in (3, 5, 6, 7):
        raise RuntimeError(f"Unsupported Task version '{task['version']}'")
    control_hz = float(task["controlHz"])
    schedule: list[dict[str, Any]] = []
    for segment in task["motionCommandSchedule"]:
        raw_step = float(segment["atSeconds"]) * control_hz
        step = round(raw_step)
        if abs(raw_step - step) > 1e-9:
            raise RuntimeError(f"Motion command boundary {segment['atSeconds']} does not align to the control grid")
        schedule.append({"atStep": step, "atSeconds": float(segment["atSeconds"]), "command": motion_command_vector(segment["command"])})
    return schedule


def active_mission_phase(task: dict[str, Any], time_seconds: float) -> dict[str, Any] | None:
    phases = task.get("missionPhases")
    if not phases:
        return None
    if int(task.get("version", 0)) == 8:
        raise RuntimeError("Task v8 Mission phase is state-derived; use RobotEnvironment.mission_phase()")
    active = phases[0]
    for phase in phases[1:]:
        if float(phase["atSeconds"]) > time_seconds + 1e-9:
            break
        active = phase
    return active


class RecoveryRelapseTracker:
    """Online form of the Task recovery-relapse contract used by training and judging."""

    def __init__(self, task: dict[str, Any]):
        self.contract = task.get("recoveryRelapse")
        self.hold_steps = (
            max(1, round(float(self.contract["holdSeconds"]) * float(task["controlHz"])))
            if self.contract is not None
            else 0
        )
        self.reset()

    def reset(self) -> None:
        self.self_righted_at: float | None = None
        self.entered_at: float | None = None
        self.breach_steps = 0
        self.latched = False
        self.breaches: set[str] = set()
        self.count = 0

    def mark_self_righted(self, time_seconds: float) -> None:
        if self.self_righted_at is None:
            self.self_righted_at = float(time_seconds)

    def observe(
        self,
        time_seconds: float,
        height: float,
        body_tilt: float,
        mission_stage: str | None = None,
    ) -> dict[str, Any] | None:
        if (
            self.contract is None
            or self.self_righted_at is None
            or float(time_seconds) <= self.self_righted_at + 1e-9
        ):
            return None
        current_breaches = {
            *({"base-height"} if height < float(self.contract["minimumBaseHeightM"]) else set()),
            *({"body-tilt"} if body_tilt > float(self.contract["maximumBodyTiltRad"]) else set()),
        }
        if not current_breaches:
            self.entered_at = None
            self.breach_steps = 0
            self.latched = False
            self.breaches.clear()
            return None
        if self.latched:
            return None
        if self.breach_steps == 0:
            self.entered_at = float(time_seconds)
        self.breach_steps += 1
        self.breaches.update(current_breaches)
        if self.breach_steps < self.hold_steps:
            return None
        self.latched = True
        self.count += 1
        return {
            "type": "robot.recovery-relapsed",
            "time": float(time_seconds),
            "enteredAt": self.entered_at,
            "stableRecoveryAt": self.self_righted_at,
            "timeSinceSelfRightSeconds": float(time_seconds) - self.self_righted_at,
            "height": float(height),
            "bodyTiltRad": float(body_tilt),
            "missionStage": mission_stage,
            "breaches": sorted(self.breaches),
            "failureEnvelope": self.contract,
        }


class RobotEnvironment:
    def __init__(
        self,
        model_path: Path,
        compiled: dict[str, Any],
        task: dict[str, Any],
        scenario: dict[str, Any],
        seed: int,
        domain_sample: dict[str, Any] | None = None,
        episode_end_seconds: float | None = None,
        episode_end_phase: str | None = None,
    ):
        self.model = mujoco.MjModel.from_xml_path(str(model_path))
        self.data = mujoco.MjData(self.model)
        self.compiled = compiled
        self.morphology = dict(compiled.get("morphology", {}))
        self.contact_points = list(self.morphology.get("contactPoints", []))
        self.base_body_name = str(self.morphology.get("baseBody", "torso"))
        self.task = task
        self.domain_sample = dict(domain_sample or {})
        self.scenario = dict(scenario)
        self.scenario["friction"] = float(scenario["friction"]) * float(scenario.get("frictionScale", 1.0)) * float(self.domain_sample.get("frictionScale", 1.0))
        self.scenario["observationNoiseStd"] = float(scenario["observationNoiseStd"]) + float(self.domain_sample.get("observationNoiseStd", 0.0))
        self.scenario["actuatorDelaySteps"] = max(0, int(scenario["actuatorDelaySteps"]) + int(self.domain_sample.get("actuatorDelayJitterSteps", 0)))
        self.body_mass_scale = float(scenario.get("bodyMassScale", 1.0)) * float(self.domain_sample.get("bodyMassScale", 1.0))
        self.joint_damping_scale = float(scenario.get("jointDampingScale", 1.0)) * float(self.domain_sample.get("jointDampingScale", 1.0))
        self.actuator_strength_scale = float(scenario.get("actuatorStrengthScale", 1.0)) * float(self.domain_sample.get("actuatorStrengthScale", 1.0))
        legacy_push = scenario.get("lateralPush")
        external_push = scenario.get("externalPush")
        if external_push is not None:
            direction = np.asarray(external_push["directionXY"], dtype=np.float64)
            force_newton = float(external_push["forceNewton"])
            push = dict(external_push)
        elif legacy_push is not None:
            force_newton = abs(float(legacy_push["forceNewton"]))
            direction = np.asarray(
                [0.0, 1.0 if float(legacy_push["forceNewton"]) >= 0.0 else -1.0],
                dtype=np.float64,
            )
            push = dict(legacy_push)
        else:
            force_newton = 0.0
            direction = np.asarray([0.0, 1.0], dtype=np.float64)
            push = None
        self.external_push: dict[str, Any] | None = None
        if push is not None:
            direction /= float(np.linalg.norm(direction))
            angle = float(self.domain_sample.get("pushDirectionJitterRad", 0.0))
            rotation = np.asarray(
                [[np.cos(angle), -np.sin(angle)], [np.sin(angle), np.cos(angle)]],
                dtype=np.float64,
            )
            direction = rotation @ direction
            self.external_push = {
                "timeSeconds": max(
                    0.0,
                    float(push["timeSeconds"])
                    + float(self.domain_sample.get("pushTimeOffsetSeconds", 0.0)),
                ),
                "durationSeconds": float(push["durationSeconds"]),
                "forceNewton": force_newton
                * float(self.domain_sample.get("pushForceScale", 1.0)),
                "directionXY": direction.tolist(),
            }
        self.rng = np.random.default_rng(seed)
        self.sensor_history_rng = np.random.default_rng(seed + 30_000_000)
        self.seed = seed
        self.control_dt = 1.0 / float(task["controlHz"])
        self.physics_steps = max(1, round(self.control_dt / self.model.opt.timestep))
        authored_duration = float(task["durationSeconds"])
        effective_duration = authored_duration if episode_end_seconds is None else float(episode_end_seconds)
        if effective_duration <= 0.0 or effective_duration > authored_duration:
            raise RuntimeError(
                f"Training episode end {effective_duration} must be within the authored Task duration {authored_duration}"
            )
        raw_max_steps = effective_duration * float(task["controlHz"])
        if abs(raw_max_steps - round(raw_max_steps)) > 1e-9:
            raise RuntimeError("Training episode end must align to the Task control grid")
        self.episode_end_seconds = effective_duration
        self.max_steps = round(raw_max_steps)
        self.episode_end_phase = episode_end_phase
        self.step_index = 0
        self.motion_command_schedule = [] if int(task["version"]) == 8 else compile_motion_command_schedule(task)
        self.motion_command_by_step = {int(segment["atStep"]): segment["command"] for segment in self.motion_command_schedule}
        self.mission_phase_index = 0
        self.mission_phase_entered_step = 0
        self.mission_completed = False
        self.mission_prefix_completed = False
        self.mission_recovery_stable_steps = 0
        self.recovery_stable_latched = False
        self.recovery_stable_at_seconds: float | None = None
        self.recovery_stable_since_seconds: float | None = None
        self.recovery_deadline_expired_latched = False
        self.recovery_deadline_expired_at_seconds: float | None = None
        self.mission_phase_timeout_count = 0
        self.push_started = False
        if int(task["version"]) == 8 and episode_end_phase is not None:
            phase_ids = [str(phase["id"]) for phase in task["missionPhases"]]
            if episode_end_phase not in phase_ids:
                raise RuntimeError(f"Mission prefix names unknown phase '{episode_end_phase}'")
        self.previous_action = np.zeros(self.model.nu, dtype=np.float64)
        self.last_commanded_action = np.zeros(self.model.nu, dtype=np.float64)
        self.last_applied_action = np.zeros(self.model.nu, dtype=np.float64)
        self.command_history = deque([np.zeros(self.model.nu, dtype=np.float64) for _ in range(4)], maxlen=4)
        self.applied_history = deque([np.zeros(self.model.nu, dtype=np.float64) for _ in range(4)], maxlen=4)
        self.sensor_histories: dict[str, deque[np.ndarray]] = {}
        self.delay = deque([np.zeros(self.model.nu, dtype=np.float64) for _ in range(int(self.scenario["actuatorDelaySteps"]) + 1)], maxlen=int(self.scenario["actuatorDelaySteps"]) + 1)
        self.recovery_relapse_tracker = RecoveryRelapseTracker(task)
        self.recovery_evaluation_active = False
        self.recovery_triggered = False
        self.recovery_stable_steps = 0
        self.events: list[dict[str, Any]] = []
        self._configure_scenario()

    def _configure_scenario(self) -> None:
        self.model.body_mass[:] *= self.body_mass_scale
        self.model.body_inertia[:] *= self.body_mass_scale
        self.model.dof_damping[:] *= self.joint_damping_scale
        self.model.actuator_gainprm[:, 0] *= self.actuator_strength_scale
        self.model.geom_friction[:, 0] = float(self.scenario["friction"])
        torso = mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_BODY, self.base_body_name)
        if torso >= 0:
            self.model.body_mass[torso] += float(self.scenario["payloadKg"])

    def reset(self) -> dict[str, np.ndarray]:
        if self.model.nkey:
            mujoco.mj_resetDataKeyframe(self.model, self.data, 0)
        else:
            mujoco.mj_resetData(self.model, self.data)
        initial_base_pose = self.scenario.get("initialBasePose")
        if initial_base_pose is not None:
            if self.model.nq < 7:
                raise RuntimeError("Scenario initialBasePose requires a free-root robot")
            self.data.qpos[:3] = np.asarray(initial_base_pose["positionM"], dtype=np.float64)
            self.data.qpos[3:7] = np.asarray(initial_base_pose["orientationWxyz"], dtype=np.float64)
            self.data.qvel[:6] = 0.0
        joint_position_noise = float(self.scenario.get("initialJointPositionNoiseStd", 0.0))
        joint_velocity_noise = float(self.scenario.get("initialJointVelocityNoiseStd", 0.0))
        if joint_position_noise:
            self.data.qpos[7:] += self.rng.normal(0.0, joint_position_noise, size=self.model.nq - 7)
        if joint_velocity_noise:
            self.data.qvel[6:] += self.rng.normal(0.0, joint_velocity_noise, size=self.model.nv - 6)
        mujoco.mj_forward(self.model, self.data)
        self.initial_xy = self.data.qpos[:2].copy()
        self.previous_xy = self.initial_xy.copy()
        self.phase_initial_xy = self.initial_xy.copy()
        self.step_index = 0
        self.mission_phase_index = 0
        self.mission_phase_entered_step = 0
        self.mission_completed = False
        self.mission_prefix_completed = False
        self.mission_recovery_stable_steps = 0
        self.recovery_stable_latched = False
        self.recovery_stable_at_seconds = None
        self.recovery_stable_since_seconds = None
        self.recovery_deadline_expired_latched = False
        self.recovery_deadline_expired_at_seconds = None
        self.mission_phase_timeout_count = 0
        self.push_started = False
        initial_phase = self.mission_phase()
        self.active_phase_id = str(initial_phase["id"]) if initial_phase is not None else None
        self.previous_action.fill(0)
        self.last_commanded_action.fill(0)
        self.last_applied_action.fill(0)
        self.command_history = deque([np.zeros(self.model.nu, dtype=np.float64) for _ in range(4)], maxlen=4)
        self.applied_history = deque([np.zeros(self.model.nu, dtype=np.float64) for _ in range(4)], maxlen=4)
        self.sensor_histories = {}
        for channel in self.compiled["observationContract"]["channels"]:
            source = str(channel["source"])
            if source.startswith("sensor-list-history-4:"):
                current = self._sensor_history_sample(source.split(":", 1)[1])
                self.sensor_histories[source] = deque(
                    [current.copy() for _ in range(4)],
                    maxlen=4,
                )
        self.delay = deque([np.zeros(self.model.nu, dtype=np.float64) for _ in range(int(self.scenario["actuatorDelaySteps"]) + 1)], maxlen=int(self.scenario["actuatorDelaySteps"]) + 1)
        self.recovery_relapse_tracker.reset()
        self.recovery_evaluation_active = False
        self.recovery_triggered = False
        self.recovery_stable_steps = 0
        initial_command = self.motion_command(0)
        self.events = [{
            "type": "episode.reset", "time": 0.0, "seed": self.seed, "scenario": self.scenario["id"], "motionCommand": initial_command.tolist(),
            "initialBasePose": initial_base_pose,
            "plant": {
                "bodyMassScale": self.body_mass_scale,
                "jointDampingScale": self.joint_damping_scale,
                "actuatorStrengthScale": self.actuator_strength_scale,
                "friction": float(self.scenario["friction"]),
                "observationNoiseStd": float(self.scenario["observationNoiseStd"]),
                "actuatorDelaySteps": int(self.scenario["actuatorDelaySteps"]),
            },
            "disturbance": self.external_push,
        }]
        if initial_phase is not None and int(self.task["version"]) == 8:
            self.events.append({
                "type": "mission.stage-changed",
                "time": 0.0,
                "step": 0,
                "from": None,
                "to": initial_phase["id"],
                "intent": initial_phase["intent"],
                "requiredCapabilities": initial_phase["requiredCapabilities"],
                "cause": "episode-start",
                "timedOut": False,
            })
        return self.observation()

    def mission_phase(self) -> dict[str, Any] | None:
        phases = self.task.get("missionPhases")
        if not phases:
            return None
        if int(self.task["version"]) == 8:
            if self.mission_completed:
                return None
            return phases[self.mission_phase_index]
        return active_mission_phase(self.task, self.step_index * self.control_dt)

    def motion_command(self, step_index: int | None = None) -> np.ndarray:
        if int(self.task["version"]) == 8:
            phase = self.mission_phase()
            if phase is None:
                phase = self.task["missionPhases"][-1]
            return motion_command_vector(phase["command"])
        step = self.step_index if step_index is None else int(step_index)
        active = self.motion_command_schedule[0]["command"]
        for segment in self.motion_command_schedule[1:]:
            if int(segment["atStep"]) > step: break
            active = segment["command"]
        return np.asarray(active, dtype=np.float64).copy()

    def recovery_target_satisfied(self) -> bool:
        target = self.task.get("recoveryTarget")
        if target is None:
            return False
        quaternion = np.asarray(self.data.qpos[3:7], dtype=np.float64)
        _, x, y, _ = quaternion
        body_tilt = float(np.arccos(np.clip(1.0 - 2.0 * (x * x + y * y), -1.0, 1.0)))
        return bool(
            float(self.data.qpos[2]) >= float(target["minimumBaseHeightM"])
            and body_tilt <= float(target["maximumBodyTiltRad"])
            and float(np.linalg.norm(self.data.qvel[:3])) <= float(target["maximumLinearSpeedMps"])
            and float(np.linalg.norm(self.data.qvel[3:6])) <= float(target["maximumAngularSpeedRadPerSec"])
        )

    def recovery_stable_progress(self) -> float:
        """Task-authored stable-recovery dwell, normalized and latched at success."""
        if self.recovery_stable_latched:
            return 1.0
        target = self.task.get("recoveryTarget")
        if target is None or int(self.task.get("version", 0)) != 8:
            return 0.0
        required_steps = max(
            1,
            round(float(target["holdSeconds"]) / self.control_dt),
        )
        return float(
            np.clip(self.mission_recovery_stable_steps / required_steps, 0.0, 1.0)
        )

    def body_tilt(self) -> float:
        quaternion = np.asarray(self.data.qpos[3:7], dtype=np.float64)
        _, x, y, _ = quaternion
        return float(np.arccos(np.clip(1.0 - 2.0 * (x * x + y * y), -1.0, 1.0)))

    def _sensor_list_values(self, sensor_names: str) -> np.ndarray:
        values: list[np.ndarray] = []
        for sensor_name in sensor_names.split(","):
            sensor_id = mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_SENSOR, sensor_name)
            if sensor_id < 0:
                raise RuntimeError(f"Observation references unknown sensor '{sensor_name}'")
            start = self.model.sensor_adr[sensor_id]
            size = self.model.sensor_dim[sensor_id]
            values.append(self.data.sensordata[start:start + size])
        return np.concatenate(values).astype(np.float64, copy=True)

    def _sensor_history_sample(self, sensor_names: str) -> np.ndarray:
        value = self._sensor_list_values(sensor_names)
        noise = float(self.scenario["observationNoiseStd"])
        if noise:
            value += self.sensor_history_rng.normal(0.0, noise, size=value.shape)
        return value

    def _advance_recovery_monitor(
        self,
        mission_phase: dict[str, Any] | None,
    ) -> dict[str, Any] | None:
        target = self.task.get("recoveryTarget")
        if target is None:
            return None
        if mission_phase is not None and mission_phase.get("intent") == "recover":
            self.recovery_evaluation_active = True
        if not self.recovery_evaluation_active:
            return None
        satisfied = self.recovery_target_satisfied()
        if not satisfied:
            self.recovery_triggered = True
            self.recovery_stable_steps = 0
        elif self.recovery_triggered and self.recovery_relapse_tracker.self_righted_at is None:
            self.recovery_stable_steps += 1
            required_steps = max(
                1,
                round(float(target["holdSeconds"]) / self.control_dt),
            )
            if self.recovery_stable_steps >= required_steps:
                self.recovery_relapse_tracker.mark_self_righted(float(self.data.time))
        return self.recovery_relapse_tracker.observe(
            float(self.data.time),
            float(self.data.qpos[2]),
            self.body_tilt(),
            str(mission_phase["id"]) if mission_phase is not None else None,
        )

    def _advance_causal_mission(self, pushing: bool) -> dict[str, Any] | None:
        if int(self.task["version"]) != 8 or self.mission_completed:
            return None
        phase = self.task["missionPhases"][self.mission_phase_index]
        exit_contract = phase["exit"]
        elapsed_steps = self.step_index - self.mission_phase_entered_step
        elapsed_seconds = elapsed_steps * self.control_dt
        recovery_satisfied = self.recovery_target_satisfied()
        if pushing:
            self.push_started = True
        condition_met = False
        if exit_contract["kind"] == "elapsed":
            condition_met = elapsed_seconds + 1e-9 >= float(exit_contract["afterSeconds"])
            timeout_seconds = None
        else:
            timeout_seconds = float(exit_contract["timeoutSeconds"])
            if exit_contract["kind"] == "external-push-start":
                condition_met = pushing
            elif exit_contract["kind"] == "external-push-end":
                condition_met = self.push_started and not pushing
            elif exit_contract["kind"] == "recovery-stable":
                if recovery_satisfied:
                    self.mission_recovery_stable_steps += 1
                else:
                    self.mission_recovery_stable_steps = 0
                required_steps = max(
                    1,
                    round(float(self.task["recoveryTarget"]["holdSeconds"]) / self.control_dt),
                )
                condition_met = self.mission_recovery_stable_steps >= required_steps
                if condition_met and not self.recovery_stable_latched:
                    self.recovery_stable_latched = True
                    self.recovery_stable_at_seconds = float(self.data.time)
                    self.recovery_stable_since_seconds = float(
                        self.data.time - (required_steps - 1) * self.control_dt
                    )
                    self.events.append({
                        "type": "robot.recovery-stable-latched",
                        "time": self.recovery_stable_at_seconds,
                        "step": self.step_index,
                        "stableSince": self.recovery_stable_since_seconds,
                        "requiredDwellSeconds": float(
                            self.task["recoveryTarget"]["holdSeconds"]
                        ),
                        "source": "task-recovery-target",
                    })
            else:
                raise RuntimeError(f"Unsupported Mission exit '{exit_contract['kind']}'")
        timed_out = bool(
            not condition_met
            and timeout_seconds is not None
            and elapsed_seconds + 1e-9 >= timeout_seconds
        )
        if not condition_met and not timed_out:
            return None
        if timed_out:
            self.mission_phase_timeout_count += 1
            if (
                phase.get("intent") == "recover"
                and not self.recovery_deadline_expired_latched
            ):
                self.recovery_deadline_expired_latched = True
                self.recovery_deadline_expired_at_seconds = float(self.data.time)
                self.events.append({
                    "type": "robot.recovery-deadline-expired",
                    "time": self.recovery_deadline_expired_at_seconds,
                    "step": self.step_index,
                    "phase": phase["id"],
                    "timeoutSeconds": timeout_seconds,
                    "source": "task-mission-exit",
                })
        transition = {
            "from": phase["id"],
            "condition": exit_contract["kind"],
            "cause": exit_contract["kind"] if condition_met else "timeout",
            "conditionMet": condition_met,
            "timedOut": timed_out,
            "phaseEnteredAtSeconds": self.mission_phase_entered_step * self.control_dt,
            "phaseElapsedSeconds": elapsed_seconds,
            "recoveryTargetSatisfied": recovery_satisfied,
            "missionPhaseTimeoutCount": self.mission_phase_timeout_count,
        }
        if self.episode_end_phase == phase["id"]:
            self.mission_prefix_completed = True
        previous_command = motion_command_vector(phase["command"])
        next_index = self.mission_phase_index + 1
        if next_index >= len(self.task["missionPhases"]):
            self.mission_completed = True
            transition["to"] = None
            self.events.append({
                "type": "mission.completed",
                "time": float(self.data.time),
                "step": self.step_index,
                **transition,
            })
            return transition
        next_phase = self.task["missionPhases"][next_index]
        self.mission_phase_index = next_index
        self.mission_phase_entered_step = self.step_index
        self.mission_recovery_stable_steps = 0
        self.phase_initial_xy = self.data.qpos[:2].copy()
        self.active_phase_id = str(next_phase["id"])
        transition["to"] = next_phase["id"]
        self.events.append({
            "type": "mission.stage-changed",
            "time": float(self.data.time),
            "step": self.step_index,
            "intent": next_phase["intent"],
            "requiredCapabilities": next_phase["requiredCapabilities"],
            **transition,
        })
        next_command = motion_command_vector(next_phase["command"])
        if not np.array_equal(previous_command, next_command):
            self.events.append({
                "type": "motion-command.changed",
                "time": float(self.data.time),
                "step": self.step_index,
                "fromMissionPhase": phase["id"],
                "toMissionPhase": next_phase["id"],
                "motionCommand": next_command.tolist(),
            })
        return transition

    def observation(self) -> dict[str, np.ndarray]:
        result: dict[str, np.ndarray] = {}
        for channel in self.compiled["observationContract"]["channels"]:
            source = channel["source"]
            if source == "qpos:joints": value = self.data.qpos[7:]
            elif source == "qvel:joints": value = self.data.qvel[6:]
            elif source == "qpos:root-height": value = self.data.qpos[2:3]
            elif source == "qpos:root-quaternion": value = self.data.qpos[3:7]
            elif source == "qvel:root": value = self.data.qvel[:6]
            elif source == "control:last-commanded": value = self.last_commanded_action
            elif source == "control:last-applied": value = self.last_applied_action
            elif source in ("control:command-history-4", "control:command-history-4-stable"): value = np.concatenate(tuple(self.command_history))
            elif source in ("control:applied-history-4", "control:applied-history-4-stable"): value = np.concatenate(tuple(self.applied_history))
            elif source == "control:actuator-delay-steps": value = np.array([float(self.scenario["actuatorDelaySteps"])])
            elif source.startswith("sensor-list-history-4:"):
                value = np.concatenate(tuple(self.sensor_histories[source]))
            elif source == "task:motion-command":
                value = self.motion_command()
            elif source == "task:recovery-target-satisfied":
                value = np.array([float(self.recovery_target_satisfied())])
            elif source == "task:recovery-stable-progress":
                value = np.array([self.recovery_stable_progress()])
            elif source == "task:recovery-stable-latched":
                value = np.array([float(self.recovery_stable_latched)])
            elif source == "task:recovery-deadline-expired":
                value = np.array([float(self.recovery_deadline_expired_latched)])
            elif source.startswith("sensor:"):
                sensor_name = source.split(":", 1)[1]
                sensor_id = mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_SENSOR, sensor_name)
                if sensor_id < 0: raise RuntimeError(f"Observation references unknown sensor '{sensor_name}'")
                start = self.model.sensor_adr[sensor_id]; size = self.model.sensor_dim[sensor_id]
                value = self.data.sensordata[start:start + size]
            elif source.startswith("sensor-list:"):
                values: list[np.ndarray] = []
                for sensor_name in source.split(":", 1)[1].split(","):
                    sensor_id = mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_SENSOR, sensor_name)
                    if sensor_id < 0: raise RuntimeError(f"Observation references unknown sensor '{sensor_name}'")
                    start = self.model.sensor_adr[sensor_id]; size = self.model.sensor_dim[sensor_id]
                    values.append(self.data.sensordata[start:start + size])
                value = np.concatenate(values)
            else: raise RuntimeError(f"Unsupported observation source '{source}'")
            value = np.asarray(value, dtype=np.float64).reshape(-1)
            if value.size != int(channel["size"]): raise RuntimeError(f"Observation '{channel['name']}' expected {channel['size']} values, got {value.size}")
            noise = float(self.scenario["observationNoiseStd"])
            stable_history = (
                source in ("control:command-history-4-stable", "control:applied-history-4-stable")
                or source.startswith("sensor-list-history-4:")
            )
            if noise and channel["kind"] not in ("command", "runtime-state") and not stable_history:
                value = value + self.rng.normal(0.0, noise, size=value.shape)
            result[channel["name"]] = value.copy()
        return result

    def vector(self, observation: dict[str, np.ndarray]) -> np.ndarray:
        return np.concatenate([observation[channel["name"]] for channel in self.compiled["observationContract"]["channels"]]).astype(np.float32)

    def foot_positions_world(self) -> np.ndarray | None:
        if not self.contact_points:
            return None
        site_ids = [mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_SITE, str(point["site"])) for point in self.contact_points]
        if any(site_id < 0 for site_id in site_ids):
            return None
        return np.asarray([self.data.site_xpos[site_id].copy() for site_id in site_ids], dtype=np.float64)

    def foot_contact_forces(self) -> np.ndarray | None:
        if not self.contact_points or any("sensor" not in point for point in self.contact_points):
            return None
        values: list[float] = []
        for name in [str(point["sensor"]) for point in self.contact_points]:
            sensor_id = mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_SENSOR, name)
            if sensor_id < 0:
                return None
            start = int(self.model.sensor_adr[sensor_id]); size = int(self.model.sensor_dim[sensor_id])
            if size != 1:
                return None
            values.append(float(self.data.sensordata[start]))
        return np.asarray(values, dtype=np.float64)

    def step(self, action: np.ndarray) -> StepResult:
        command_step = self.step_index
        target = self.motion_command(command_step)
        mission_phase = self.mission_phase()
        mission_phase_id = str(mission_phase["id"]) if mission_phase is not None else None
        mission_phase_entered_step = self.mission_phase_entered_step
        if mission_phase_id != self.active_phase_id:
            self.phase_initial_xy = self.data.qpos[:2].copy()
            self.active_phase_id = mission_phase_id
        step_initial_xy = self.data.qpos[:2].copy()
        previous_joint_velocity = self.data.qvel[6:].copy()
        previous_body_angular_velocity = self.data.qvel[3:6].copy()
        previous_foot_positions = self.foot_positions_world()
        previous_foot_forces = self.foot_contact_forces()
        if command_step > 0 and command_step in self.motion_command_by_step:
            self.events.append({"type": "motion-command.changed", "time": command_step * self.control_dt, "step": command_step, "motionCommand": target.tolist()})
        action = np.asarray(action, dtype=np.float64).reshape(-1)
        if action.size != self.model.nu: raise RuntimeError(f"Action expected {self.model.nu} values, got {action.size}")
        if not np.isfinite(action).all(): raise RuntimeError("Action contains non-finite values")
        action = np.clip(action, self.compiled["actionLow"], self.compiled["actionHigh"])
        self.delay.append(action.copy())
        applied = self.delay[0]
        self.last_commanded_action = action.copy()
        self.last_applied_action = applied.copy()
        self.command_history.append(action.copy())
        self.applied_history.append(applied.copy())
        self.data.ctrl[:] = applied
        push = self.external_push
        pushing = False
        if push:
            now = self.step_index * self.control_dt
            pushing = float(push["timeSeconds"]) <= now < float(push["timeSeconds"]) + float(push["durationSeconds"])
            torso = mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_BODY, self.base_body_name)
            if torso >= 0:
                direction = np.asarray(push["directionXY"], dtype=np.float64)
                self.data.xfrc_applied[torso, :2] = (
                    float(push["forceNewton"]) * direction if pushing else 0.0
                )
        for _ in range(self.physics_steps): mujoco.mj_step(self.model, self.data)
        self.step_index += 1
        for source, history in self.sensor_histories.items():
            history.append(self._sensor_history_sample(source.split(":", 1)[1]))
        height = float(self.data.qpos[2])
        healthy_min, healthy_max = self.task["healthyHeight"]
        healthy = float(healthy_min) <= height <= float(healthy_max)
        measured_motion = np.asarray([self.data.qvel[0], self.data.qvel[1], self.data.qvel[5]], dtype=np.float64)
        planar_velocity_error = float(np.linalg.norm(measured_motion[:2] - target[:2]))
        yaw_rate_error = abs(float(measured_motion[2] - target[2]))
        velocity_error = float(np.linalg.norm(measured_motion - target))
        target_speed = float(np.linalg.norm(target[:2]))
        step_displacement_xy = self.data.qpos[:2] - step_initial_xy
        if target_speed > 1e-9:
            direction = target[:2] / target_speed
            forward_velocity = float(np.dot(self.data.qvel[:2], direction))
            normalized_progress_rate = float(np.clip(forward_velocity / target_speed, -1.0, 1.5))
            reference_xy = self.phase_initial_xy if int(self.task["version"]) in (7, 8) else self.initial_xy
            planar_displacement = self.data.qpos[:2] - reference_xy
            lateral_displacement = float(np.linalg.norm(planar_displacement - np.dot(planar_displacement, direction) * direction))
            commanded_progress_delta = float(np.dot(step_displacement_xy, direction))
        else:
            forward_velocity = 0.0
            normalized_progress_rate = 0.0
            reference_xy = self.phase_initial_xy if int(self.task["version"]) in (7, 8) else self.initial_xy
            lateral_displacement = float(np.linalg.norm(self.data.qpos[:2] - reference_xy))
            commanded_progress_delta = 0.0
        upright = float(1.0 - min(1.0, np.linalg.norm(self.data.qpos[4:6])))
        energy = float(np.sum(np.abs(applied * self.data.qvel[6:])))
        smoothness = float(np.mean(np.square(applied - self.previous_action)))
        action_slew = np.abs(applied - self.previous_action) / self.control_dt
        control_low = np.asarray(self.compiled["actionLow"], dtype=np.float64)
        control_high = np.asarray(self.compiled["actionHigh"], dtype=np.float64)
        saturation_tolerance = 0.01 * np.maximum(np.abs(control_high - control_low), 1e-12)
        saturation_rate = float(np.mean(np.logical_or(applied <= control_low + saturation_tolerance, applied >= control_high - saturation_tolerance)))
        joint_acceleration = np.abs(self.data.qvel[6:] - previous_joint_velocity) / self.control_dt
        body_angular_acceleration = np.abs(self.data.qvel[3:6] - previous_body_angular_velocity) / self.control_dt
        current_foot_positions = self.foot_positions_world()
        current_foot_forces = self.foot_contact_forces()
        foot_slip_speeds: list[float] | None = None
        foot_contact_impacts: list[float] | None = None
        if previous_foot_positions is not None and previous_foot_forces is not None and current_foot_positions is not None and current_foot_forces is not None:
            foot_slip_speeds = []
            foot_contact_impacts = []
            for foot_index in range(len(current_foot_forces)):
                planted = previous_foot_forces[foot_index] > 1.0 and current_foot_forces[foot_index] > 1.0
                foot_slip_speeds.append(float(np.linalg.norm(current_foot_positions[foot_index, :2] - previous_foot_positions[foot_index, :2]) / self.control_dt) if planted else 0.0)
                foot_contact_impacts.append(max(0.0, float(current_foot_forces[foot_index] - previous_foot_forces[foot_index]) / self.control_dt))
        quality = {
            "jointAccelerationMeanAbsRadPerSec2": float(np.mean(joint_acceleration)),
            "bodyAngularAccelerationMeanAbsRadPerSec2": float(np.mean(body_angular_acceleration)),
            "actionSlewMeanAbsPerSec": float(np.mean(action_slew)),
            "actuatorSaturationRate": saturation_rate,
            "footEvidenceAvailable": foot_slip_speeds is not None,
            "footSlipMeanMps": float(np.mean(foot_slip_speeds)) if foot_slip_speeds is not None else 0.0,
            "footContactImpactMeanNPerSec": float(np.mean(foot_contact_impacts)) if foot_contact_impacts is not None else 0.0,
        }
        velocity_reward = float(np.exp(-10.0 * velocity_error * velocity_error))
        if int(self.task["version"]) == 4:
            quaternion = self.data.qpos[3:7]
            world_up_alignment = float(1.0 - 2.0 * (quaternion[1] * quaternion[1] + quaternion[2] * quaternion[2]))
            target_height = float(self.task["recoveryTarget"]["minimumBaseHeightM"])
            height_progress = float(np.clip((height - 0.05) / max(target_height - 0.05, 1e-9), 0.0, 1.0))
            reward = 4.0 * world_up_alignment + 2.0 * height_progress - 0.002 * energy - 0.001 * smoothness
        else:
            reward = (1.0 if healthy else -1.0) + 1.5 * velocity_reward + 0.75 * normalized_progress_rate + upright - 2.0 * lateral_displacement - 0.002 * energy - 0.001 * smoothness
        recovery_relapse_event = self._advance_recovery_monitor(mission_phase)
        mission_transition = self._advance_causal_mission(pushing)
        terminated = bool(self.task["terminateOnFall"] and not healthy)
        truncated = bool(
            self.step_index >= self.max_steps
            or self.mission_completed
            or self.mission_prefix_completed
        )
        self.previous_action = applied.copy()
        self.previous_xy = self.data.qpos[:2].copy()
        return StepResult(self.observation(), float(reward), terminated, truncated, {
            "height": height, "healthy": healthy, "velocityError": velocity_error, "planarVelocityError": planar_velocity_error, "yawRateError": yaw_rate_error,
            "baseLinearSpeedMps": float(np.linalg.norm(self.data.qvel[:3])),
            "baseAngularSpeedRadPerSec": float(np.linalg.norm(self.data.qvel[3:6])),
            "commandStep": command_step, "motionCommand": target.copy(), "measuredMotion": measured_motion.copy(),
            "missionPhase": mission_phase_id, "missionIntent": mission_phase.get("intent") if mission_phase is not None else None,
            "missionPhaseEnteredAtSeconds": mission_phase_entered_step * self.control_dt if mission_phase is not None else None,
            "missionPhaseElapsedSeconds": (command_step - mission_phase_entered_step) * self.control_dt if mission_phase is not None else None,
            "missionTransition": mission_transition,
            "missionCompleted": self.mission_completed,
            "missionPhaseTimeoutCount": self.mission_phase_timeout_count,
            "recoveryTargetSatisfied": self.recovery_target_satisfied(),
            "recoveryStableProgress": self.recovery_stable_progress(),
            "recoveryStableLatched": self.recovery_stable_latched,
            "recoveryStableAtSeconds": self.recovery_stable_at_seconds,
            "recoveryStableSinceSeconds": self.recovery_stable_since_seconds,
            "recoveryDeadlineExpired": self.recovery_deadline_expired_latched,
            "recoveryDeadlineExpiredAtSeconds": self.recovery_deadline_expired_at_seconds,
            "recoverySelfRightedAtSeconds": self.recovery_relapse_tracker.self_righted_at,
            "recoveryRelapseEntered": recovery_relapse_event is not None,
            "recoveryRelapseCount": self.recovery_relapse_tracker.count,
            "recoveryRelapseEvent": recovery_relapse_event,
            "stepDisplacementXY": step_displacement_xy.copy(), "commandedProgressDeltaM": commanded_progress_delta,
            "normalizedProgressRate": normalized_progress_rate, "forwardVelocity": forward_velocity, "lateralDisplacement": lateral_displacement,
            "upright": upright, "energy": energy, "smoothness": smoothness, "pushing": pushing,
            "commandedAction": action.copy(), "appliedAction": applied.copy(), "motionQuality": quality,
        })
