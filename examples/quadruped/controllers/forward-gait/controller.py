from __future__ import annotations

import numpy as np


class ForwardGaitController:
    """Symmetric front/rear bound with force and roll feedback.

    Keeping the left and right legs in phase prevents a planar two-DOF leg
    model from manufacturing locomotion score through uncontrolled yaw drift.
    """

    def __init__(self, config):
        self.config = config

    def reset(self, seed: int) -> None:
        self.seed = seed

    def act(self, observation, time_seconds: float):
        q = observation["joint-position"]
        qd = observation["joint-velocity"]
        contacts = np.tanh(observation["foot-contact-force"] / 20.0)
        phase = 2.0 * np.pi * self.config["frequencyHz"] * time_seconds
        left_right = self.config["leftRightPhase"]
        front_rear = self.config["frontRearPhase"]
        offsets = np.array([0.0, left_right, front_rear, front_rear + left_right])
        target = np.empty(8)
        for leg in range(4):
            wave = np.sin(phase + offsets[leg])
            target[2 * leg] = self.config["neutralHip"] + self.config["hipAmplitude"] * wave
            target[2 * leg + 1] = self.config["neutralKnee"] - self.config["kneeAmplitude"] * max(0.0, wave) - self.config["contactGain"] * contacts[leg]
        roll_rate = observation["imu-angular-velocity"][0]
        roll_correction = np.clip(self.config["rollGain"] * roll_rate, -0.08, 0.08)
        target[[1, 5]] += roll_correction
        target[[3, 7]] -= roll_correction
        return np.clip(self.config["kp"] * (target - q) - self.config["kd"] * qd, -6.0, 6.0)


def create_controller(config):
    return ForwardGaitController(config)
