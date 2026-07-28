from __future__ import annotations

import numpy as np


class Solo12BalanceStandController:
    """Readable bounded joint-space standing candidate.

    The first Research Lab experiments deliberately retain the same mechanism
    as the proven home-stand Controller and tune only its stiffness/damping
    trade-off.  More complex whole-body feedback must earn its complexity
    against the locked disturbance suite rather than being assumed useful.
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
    return Solo12BalanceStandController(config)
