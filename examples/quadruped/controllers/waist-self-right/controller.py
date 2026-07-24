from __future__ import annotations

import numpy as np


def orientation_angles(quaternion: np.ndarray) -> tuple[float, float, float]:
    w, x, y, z = np.asarray(quaternion, dtype=np.float64)
    roll = np.arctan2(2.0 * (w * x + y * z), 1.0 - 2.0 * (x * x + y * y))
    pitch = np.arcsin(np.clip(2.0 * (w * y - z * x), -1.0, 1.0))
    tilt = np.arccos(np.clip(1.0 - 2.0 * (x * x + y * y), -1.0, 1.0))
    return float(roll), float(pitch), float(tilt)


class WaistSelfRightController:
    """Two-axis morphology baseline using the same leg strategy as the rigid robot."""

    def __init__(self, config):
        self.config = config

    def reset(self, seed: int) -> None:
        self.seed = seed
        self.recovery_started_at = None

    def act(self, observation, time_seconds: float):
        raw_q = np.asarray(observation["joint-position"], dtype=np.float64)
        raw_qd = np.asarray(observation["joint-velocity"], dtype=np.float64)
        q = np.concatenate([raw_q[:6], raw_q[8:14]]).reshape(4, 3)
        qd = np.concatenate([raw_qd[:6], raw_qd[8:14]]).reshape(4, 3)
        waist_q = raw_q[6:8]
        waist_qd = raw_qd[6:8]
        roll, pitch, tilt = orientation_angles(observation["base-orientation"])
        side = np.asarray([1.0, -1.0, 1.0, -1.0])
        front = np.asarray([1.0, 1.0, -1.0, -1.0])
        target = np.zeros((4, 3), dtype=np.float64)

        if tilt < self.config["uprightTiltRad"]:
            target[:, 0] = side * 0.15
            target[:, 1] = 0.15
            target[:, 2] = -0.75
            waist_target = np.zeros(2)
        else:
            if self.recovery_started_at is None:
                self.recovery_started_at = time_seconds
            elapsed = max(0.0, time_seconds - self.recovery_started_at)
            axis = side if abs(roll) >= abs(pitch) else front
            direction = 1.0 if (roll if abs(roll) >= abs(pitch) else pitch) >= 0.0 else -1.0
            down = axis * direction > 0
            if elapsed < self.config["tuckSeconds"]:
                target[:, 0] = -direction * side * 0.28
                target[:, 1] = -0.2 * axis * direction
                target[:, 2] = -1.85
            else:
                cycle = int((elapsed - self.config["tuckSeconds"]) / self.config["cycleSeconds"])
                pulse = ((elapsed - self.config["tuckSeconds"]) % self.config["cycleSeconds"]) / self.config["cycleSeconds"]
                driving = down if cycle % 2 == 0 else ~down
                target[:, 0] = side * 0.4 - direction * 0.24
                target[:, 1] = np.where(driving, 0.88 * axis * direction, -0.7 * axis * direction)
                target[:, 2] = np.where(driving, -0.15 if pulse < 0.72 else -1.5, -1.9)
            limit = self.config["maximumWaistTargetRad"]
            phase_sign = 1.0 if int(max(0.0, elapsed - self.config["tuckSeconds"]) / self.config["cycleSeconds"]) % 2 == 0 else -1.0
            waist_target = np.asarray([
                np.clip(-phase_sign * roll, -limit, limit),
                np.clip(-phase_sign * pitch, -limit, limit),
            ])

        leg_action = np.empty((4, 3), dtype=np.float64)
        leg_action[:, 0] = self.config["kpAbduction"] * (target[:, 0] - q[:, 0]) - self.config["kdAbduction"] * qd[:, 0]
        leg_action[:, 1:] = self.config["kpSagittal"] * (target[:, 1:] - q[:, 1:]) - self.config["kdSagittal"] * qd[:, 1:]
        waist_action = self.config["kpWaist"] * (waist_target - waist_q) - self.config["kdWaist"] * waist_qd
        return np.clip(np.concatenate([leg_action.reshape(-1), waist_action]), -8.0, 8.0)


def create_controller(config):
    return WaistSelfRightController(config)
