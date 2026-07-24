from __future__ import annotations

import numpy as np


def orientation_angles(quaternion: np.ndarray) -> tuple[float, float, float]:
    w, x, y, z = np.asarray(quaternion, dtype=np.float64)
    roll = np.arctan2(2.0 * (w * x + y * z), 1.0 - 2.0 * (x * x + y * y))
    pitch = np.arcsin(np.clip(2.0 * (w * y - z * x), -1.0, 1.0))
    tilt = np.arccos(np.clip(1.0 - 2.0 * (x * x + y * y), -1.0, 1.0))
    return float(roll), float(pitch), float(tilt)


class RigidSelfRightController:
    """Readable deterministic baseline; morphology and learned policies must beat it."""

    def __init__(self, config):
        self.config = config

    def reset(self, seed: int) -> None:
        self.seed = seed
        self.recovery_started_at = None
        self.recovery_axis = None
        self.recovery_direction = None

    def targets(self, orientation: np.ndarray, time_seconds: float) -> np.ndarray:
        roll, pitch, tilt = orientation_angles(orientation)
        side = np.asarray([1.0, -1.0, 1.0, -1.0])
        front = np.asarray([1.0, 1.0, -1.0, -1.0])
        target = np.zeros((4, 3), dtype=np.float64)
        if tilt < self.config["uprightTiltRad"]:
            target[:, 0] = side * 0.15
            target[:, 1] = 0.15
            target[:, 2] = -0.75
            return target

        if self.recovery_started_at is None:
            self.recovery_started_at = time_seconds
        elapsed = max(0.0, time_seconds - self.recovery_started_at)
        if self.recovery_axis is None:
            self.recovery_axis = (side if abs(roll) >= abs(pitch) else front).copy()
            self.recovery_direction = 1.0 if (roll if abs(roll) >= abs(pitch) else pitch) >= 0.0 else -1.0
        axis = self.recovery_axis
        direction = self.recovery_direction
        down = axis * direction > 0

        if elapsed < self.config["tuckSeconds"]:
            target[:, 0] = -direction * side * 0.3
            target[:, 1] = -0.2 * axis * direction
            target[:, 2] = -1.9
            return target

        maneuver = elapsed - self.config["tuckSeconds"]
        cycle = int(maneuver / self.config["cycleSeconds"])
        pulse = (maneuver % self.config["cycleSeconds"]) / self.config["cycleSeconds"]
        driving = down
        target[:, 0] = side * 0.42 - direction * 0.28
        target[:, 1] = np.where(driving, 0.9 * axis * direction, -0.75 * axis * direction)
        target[:, 2] = np.where(driving, -0.12 if pulse < 0.72 else -1.55, -1.95)
        return target

    def act(self, observation, time_seconds: float):
        q = np.asarray(observation["joint-position"], dtype=np.float64).reshape(4, 3)
        qd = np.asarray(observation["joint-velocity"], dtype=np.float64).reshape(4, 3)
        target = self.targets(observation["base-orientation"], time_seconds)
        action = np.empty((4, 3), dtype=np.float64)
        action[:, 0] = self.config["kpAbduction"] * (target[:, 0] - q[:, 0]) - self.config["kdAbduction"] * qd[:, 0]
        action[:, 1:] = self.config["kpSagittal"] * (target[:, 1:] - q[:, 1:]) - self.config["kdSagittal"] * qd[:, 1:]
        return np.clip(action.reshape(-1), -8.0, 8.0)


def create_controller(config):
    return RigidSelfRightController(config)
