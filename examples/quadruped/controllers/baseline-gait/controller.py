from __future__ import annotations

import numpy as np


class BaselineGaitController:
    def __init__(self, config):
        self.config = config

    def reset(self, seed: int) -> None:
        self.seed = seed

    def act(self, observation, time_seconds: float):
        q = observation["joint-position"]
        qd = observation["joint-velocity"]
        phase = 2.0 * np.pi * self.config["frequencyHz"] * time_seconds
        offsets = np.array([0.0, np.pi, np.pi, 0.0])
        target = np.empty(8)
        for leg in range(4):
            wave = np.sin(phase + offsets[leg])
            target[2 * leg] = 0.15 + self.config["hipAmplitude"] * wave
            target[2 * leg + 1] = -0.75 - self.config["kneeAmplitude"] * max(0.0, wave)
        return np.clip(self.config["kp"] * (target - q) - self.config["kd"] * qd, -6.0, 6.0)


def create_controller(config):
    return BaselineGaitController(config)

