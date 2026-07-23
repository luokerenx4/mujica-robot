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
    if int(task["version"]) == 2:
        return [{"atStep": 0, "atSeconds": 0.0, "command": motion_command_vector(task["motionCommand"])}]
    if int(task["version"]) != 3:
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


class RobotEnvironment:
    FOOT_SITE_NAMES = ("foot-fl-site", "foot-fr-site", "foot-rl-site", "foot-rr-site")
    FOOT_SENSOR_NAMES = ("foot-force-fl", "foot-force-fr", "foot-force-rl", "foot-force-rr")

    def __init__(self, model_path: Path, compiled: dict[str, Any], task: dict[str, Any], scenario: dict[str, Any], seed: int, domain_sample: dict[str, Any] | None = None):
        self.model = mujoco.MjModel.from_xml_path(str(model_path))
        self.data = mujoco.MjData(self.model)
        self.compiled = compiled
        self.task = task
        self.domain_sample = dict(domain_sample or {})
        self.scenario = dict(scenario)
        self.scenario["friction"] = float(scenario["friction"]) * float(scenario.get("frictionScale", 1.0)) * float(self.domain_sample.get("frictionScale", 1.0))
        self.scenario["observationNoiseStd"] = float(scenario["observationNoiseStd"]) + float(self.domain_sample.get("observationNoiseStd", 0.0))
        self.scenario["actuatorDelaySteps"] = max(0, int(scenario["actuatorDelaySteps"]) + int(self.domain_sample.get("actuatorDelayJitterSteps", 0)))
        self.body_mass_scale = float(scenario.get("bodyMassScale", 1.0)) * float(self.domain_sample.get("bodyMassScale", 1.0))
        self.joint_damping_scale = float(scenario.get("jointDampingScale", 1.0)) * float(self.domain_sample.get("jointDampingScale", 1.0))
        self.actuator_strength_scale = float(scenario.get("actuatorStrengthScale", 1.0)) * float(self.domain_sample.get("actuatorStrengthScale", 1.0))
        self.rng = np.random.default_rng(seed)
        self.seed = seed
        self.control_dt = 1.0 / float(task["controlHz"])
        self.physics_steps = max(1, round(self.control_dt / self.model.opt.timestep))
        self.max_steps = round(float(task["durationSeconds"]) * float(task["controlHz"]))
        self.step_index = 0
        self.motion_command_schedule = compile_motion_command_schedule(task)
        self.motion_command_by_step = {int(segment["atStep"]): segment["command"] for segment in self.motion_command_schedule}
        self.previous_action = np.zeros(self.model.nu, dtype=np.float64)
        self.last_commanded_action = np.zeros(self.model.nu, dtype=np.float64)
        self.last_applied_action = np.zeros(self.model.nu, dtype=np.float64)
        self.command_history = deque([np.zeros(self.model.nu, dtype=np.float64) for _ in range(4)], maxlen=4)
        self.applied_history = deque([np.zeros(self.model.nu, dtype=np.float64) for _ in range(4)], maxlen=4)
        self.delay = deque([np.zeros(self.model.nu, dtype=np.float64) for _ in range(int(self.scenario["actuatorDelaySteps"]) + 1)], maxlen=int(self.scenario["actuatorDelaySteps"]) + 1)
        self.events: list[dict[str, Any]] = []
        self._configure_scenario()

    def _configure_scenario(self) -> None:
        self.model.body_mass[:] *= self.body_mass_scale
        self.model.body_inertia[:] *= self.body_mass_scale
        self.model.dof_damping[:] *= self.joint_damping_scale
        self.model.actuator_gainprm[:, 0] *= self.actuator_strength_scale
        self.model.geom_friction[:, 0] = float(self.scenario["friction"])
        torso = mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_BODY, "torso")
        if torso >= 0:
            self.model.body_mass[torso] += float(self.scenario["payloadKg"])

    def reset(self) -> dict[str, np.ndarray]:
        if self.model.nkey:
            mujoco.mj_resetDataKeyframe(self.model, self.data, 0)
        else:
            mujoco.mj_resetData(self.model, self.data)
        joint_position_noise = float(self.scenario.get("initialJointPositionNoiseStd", 0.0))
        joint_velocity_noise = float(self.scenario.get("initialJointVelocityNoiseStd", 0.0))
        if joint_position_noise:
            self.data.qpos[7:] += self.rng.normal(0.0, joint_position_noise, size=self.model.nq - 7)
        if joint_velocity_noise:
            self.data.qvel[6:] += self.rng.normal(0.0, joint_velocity_noise, size=self.model.nv - 6)
        mujoco.mj_forward(self.model, self.data)
        self.initial_xy = self.data.qpos[:2].copy()
        self.step_index = 0
        self.previous_action.fill(0)
        self.last_commanded_action.fill(0)
        self.last_applied_action.fill(0)
        self.command_history = deque([np.zeros(self.model.nu, dtype=np.float64) for _ in range(4)], maxlen=4)
        self.applied_history = deque([np.zeros(self.model.nu, dtype=np.float64) for _ in range(4)], maxlen=4)
        self.delay = deque([np.zeros(self.model.nu, dtype=np.float64) for _ in range(int(self.scenario["actuatorDelaySteps"]) + 1)], maxlen=int(self.scenario["actuatorDelaySteps"]) + 1)
        initial_command = self.motion_command(0)
        self.events = [{
            "type": "episode.reset", "time": 0.0, "seed": self.seed, "scenario": self.scenario["id"], "motionCommand": initial_command.tolist(),
            "plant": {
                "bodyMassScale": self.body_mass_scale,
                "jointDampingScale": self.joint_damping_scale,
                "actuatorStrengthScale": self.actuator_strength_scale,
                "friction": float(self.scenario["friction"]),
                "observationNoiseStd": float(self.scenario["observationNoiseStd"]),
                "actuatorDelaySteps": int(self.scenario["actuatorDelaySteps"]),
            },
        }]
        return self.observation()

    def motion_command(self, step_index: int | None = None) -> np.ndarray:
        step = self.step_index if step_index is None else int(step_index)
        active = self.motion_command_schedule[0]["command"]
        for segment in self.motion_command_schedule[1:]:
            if int(segment["atStep"]) > step: break
            active = segment["command"]
        return np.asarray(active, dtype=np.float64).copy()

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
            elif source == "control:command-history-4": value = np.concatenate(tuple(self.command_history))
            elif source == "control:applied-history-4": value = np.concatenate(tuple(self.applied_history))
            elif source == "control:actuator-delay-steps": value = np.array([float(self.scenario["actuatorDelaySteps"])])
            elif source == "task:motion-command":
                value = self.motion_command()
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
            if noise and channel["kind"] != "command": value = value + self.rng.normal(0.0, noise, size=value.shape)
            result[channel["name"]] = value.copy()
        return result

    def vector(self, observation: dict[str, np.ndarray]) -> np.ndarray:
        return np.concatenate([observation[channel["name"]] for channel in self.compiled["observationContract"]["channels"]]).astype(np.float32)

    def foot_positions_world(self) -> np.ndarray | None:
        site_ids = [mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_SITE, name) for name in self.FOOT_SITE_NAMES]
        if any(site_id < 0 for site_id in site_ids):
            return None
        return np.asarray([self.data.site_xpos[site_id].copy() for site_id in site_ids], dtype=np.float64)

    def foot_contact_forces(self) -> np.ndarray | None:
        values: list[float] = []
        for name in self.FOOT_SENSOR_NAMES:
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
        push = self.scenario.get("lateralPush")
        pushing = False
        if push:
            now = self.step_index * self.control_dt
            pushing = float(push["timeSeconds"]) <= now < float(push["timeSeconds"]) + float(push["durationSeconds"])
            torso = mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_BODY, "torso")
            if torso >= 0: self.data.xfrc_applied[torso, 1] = float(push["forceNewton"]) if pushing else 0.0
        for _ in range(self.physics_steps): mujoco.mj_step(self.model, self.data)
        self.step_index += 1
        height = float(self.data.qpos[2])
        healthy_min, healthy_max = self.task["healthyHeight"]
        healthy = float(healthy_min) <= height <= float(healthy_max)
        measured_motion = np.asarray([self.data.qvel[0], self.data.qvel[1], self.data.qvel[5]], dtype=np.float64)
        planar_velocity_error = float(np.linalg.norm(measured_motion[:2] - target[:2]))
        yaw_rate_error = abs(float(measured_motion[2] - target[2]))
        velocity_error = float(np.linalg.norm(measured_motion - target))
        target_speed = float(np.linalg.norm(target[:2]))
        if target_speed > 1e-9:
            direction = target[:2] / target_speed
            forward_velocity = float(np.dot(self.data.qvel[:2], direction))
            normalized_progress_rate = float(np.clip(forward_velocity / target_speed, -1.0, 1.5))
            planar_displacement = self.data.qpos[:2] - self.initial_xy
            lateral_displacement = float(np.linalg.norm(planar_displacement - np.dot(planar_displacement, direction) * direction))
        else:
            forward_velocity = 0.0
            normalized_progress_rate = 0.0
            lateral_displacement = float(np.linalg.norm(self.data.qpos[:2] - self.initial_xy))
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
        reward = (1.0 if healthy else -1.0) + 1.5 * velocity_reward + 0.75 * normalized_progress_rate + upright - 2.0 * lateral_displacement - 0.002 * energy - 0.001 * smoothness
        terminated = bool(self.task["terminateOnFall"] and not healthy)
        truncated = self.step_index >= self.max_steps
        self.previous_action = applied.copy()
        return StepResult(self.observation(), float(reward), terminated, truncated, {"height": height, "healthy": healthy, "velocityError": velocity_error, "planarVelocityError": planar_velocity_error, "yawRateError": yaw_rate_error, "commandStep": command_step, "motionCommand": target.copy(), "measuredMotion": measured_motion.copy(), "forwardVelocity": forward_velocity, "lateralDisplacement": lateral_displacement, "upright": upright, "energy": energy, "smoothness": smoothness, "pushing": pushing, "commandedAction": action.copy(), "appliedAction": applied.copy(), "motionQuality": quality})
