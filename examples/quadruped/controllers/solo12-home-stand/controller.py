from __future__ import annotations

import numpy as np


class Solo12HomeStandController:
    """Hold the source-grounded home configuration with bounded joint PD.

    This deliberately contains no gait, recovery state machine, learned policy,
    or hidden stabilizer. It answers the first plant question: can the compiled
    robot support its authored nominal pose inside the documented torque limit?
    """

    def __init__(self, config):
        self.kp = float(config["kp"])
        self.kd = float(config["kd"])
        self.maximum_torque_nm = float(config["maximumTorqueNm"])
        self.target = np.asarray(config["target"], dtype=np.float64)
        if self.target.shape != (12,):
            raise ValueError("Solo12 home target must contain exactly 12 joints")

    def reset(self, seed: int) -> None:
        self.seed = seed

    def act(self, observation, time_seconds: float):
        del time_seconds
        position = np.asarray(observation["joint-position"], dtype=np.float64)
        velocity = np.asarray(observation["joint-velocity"], dtype=np.float64)
        torque = self.kp * (self.target - position) - self.kd * velocity
        return np.clip(
            torque,
            -self.maximum_torque_nm,
            self.maximum_torque_nm,
        )


def create_controller(config):
    return Solo12HomeStandController(config)
