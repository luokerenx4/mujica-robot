from __future__ import annotations

import numpy as np


class TripodGaitController:
    def __init__(self, config):
        self.config = config

    def reset(self, seed: int) -> None:
        self.seed = seed

    def act(self, observation, time_seconds: float):
        position = observation["joint-position"]
        velocity = observation["joint-velocity"]
        phase = self.config["frequencyHz"] * time_seconds
        offsets = np.array([0.0, 0.5, 0.5, 0.0, 0.0, 0.5])
        target = np.empty(12)
        for leg in range(6):
            cycle = (phase + offsets[leg]) % 1.0
            if cycle < 0.65:
                stance = cycle / 0.65
                target[2 * leg] = -self.config["hipAmplitude"] + 2.0 * self.config["hipAmplitude"] * stance
                target[2 * leg + 1] = -0.25
            else:
                swing = (cycle - 0.65) / 0.35
                target[2 * leg] = self.config["hipAmplitude"] - 2.0 * self.config["hipAmplitude"] * swing
                target[2 * leg + 1] = -0.25 - self.config["kneeAmplitude"] * np.sin(np.pi * swing)
        torque = self.config["kp"] * (target - position) - self.config["kd"] * velocity
        return np.clip(torque, -6.0, 6.0)


def create_controller(config):
    return TripodGaitController(config)
