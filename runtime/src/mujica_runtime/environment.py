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


class RobotEnvironment:
    def __init__(self, model_path: Path, compiled: dict[str, Any], task: dict[str, Any], scenario: dict[str, Any], seed: int):
        self.model = mujoco.MjModel.from_xml_path(str(model_path))
        self.data = mujoco.MjData(self.model)
        self.compiled = compiled
        self.task = task
        self.scenario = scenario
        self.rng = np.random.default_rng(seed)
        self.seed = seed
        self.control_dt = 1.0 / float(task["controlHz"])
        self.physics_steps = max(1, round(self.control_dt / self.model.opt.timestep))
        self.max_steps = round(float(task["durationSeconds"]) * float(task["controlHz"]))
        self.step_index = 0
        self.previous_action = np.zeros(self.model.nu, dtype=np.float64)
        self.last_commanded_action = np.zeros(self.model.nu, dtype=np.float64)
        self.last_applied_action = np.zeros(self.model.nu, dtype=np.float64)
        self.command_history = deque([np.zeros(self.model.nu, dtype=np.float64) for _ in range(4)], maxlen=4)
        self.applied_history = deque([np.zeros(self.model.nu, dtype=np.float64) for _ in range(4)], maxlen=4)
        self.delay = deque([np.zeros(self.model.nu, dtype=np.float64) for _ in range(int(scenario["actuatorDelaySteps"]) + 1)], maxlen=int(scenario["actuatorDelaySteps"]) + 1)
        self.events: list[dict[str, Any]] = []
        self._configure_scenario()

    def _configure_scenario(self) -> None:
        floor = mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_GEOM, "floor")
        if floor >= 0:
            self.model.geom_friction[floor, 0] = float(self.scenario["friction"])
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
        self.events = [{"type": "episode.reset", "time": 0.0, "seed": self.seed, "scenario": self.scenario["id"]}]
        return self.observation()

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
            if noise: value = value + self.rng.normal(0.0, noise, size=value.shape)
            result[channel["name"]] = value.copy()
        return result

    def vector(self, observation: dict[str, np.ndarray]) -> np.ndarray:
        return np.concatenate([observation[channel["name"]] for channel in self.compiled["observationContract"]["channels"]]).astype(np.float32)

    def step(self, action: np.ndarray) -> StepResult:
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
        target = np.asarray(self.task["targetVelocity"], dtype=np.float64)
        velocity_error = float(np.linalg.norm(self.data.qvel[:3] - target))
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
        velocity_reward = float(np.exp(-10.0 * velocity_error * velocity_error))
        reward = (1.0 if healthy else -1.0) + 1.5 * velocity_reward + 0.75 * normalized_progress_rate + upright - 2.0 * lateral_displacement - 0.002 * energy - 0.001 * smoothness
        terminated = bool(self.task["terminateOnFall"] and not healthy)
        truncated = self.step_index >= self.max_steps
        self.previous_action = applied.copy()
        return StepResult(self.observation(), float(reward), terminated, truncated, {"height": height, "healthy": healthy, "velocityError": velocity_error, "forwardVelocity": forward_velocity, "lateralDisplacement": lateral_displacement, "upright": upright, "energy": energy, "smoothness": smoothness, "pushing": pushing, "appliedAction": applied.copy()})
