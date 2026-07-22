from __future__ import annotations

import numpy as np


def quaternion_roll(quaternion: np.ndarray) -> float:
    w, x, y, z = quaternion
    return float(np.arctan2(2.0 * (w * x + y * z), 1.0 - 2.0 * (x * x + y * y)))


class LatencyAwareSpatialGaitController:
    def __init__(self, config): self.config = config
    def reset(self, seed: int) -> None: self.seed = seed

    def act(self, observation, time_seconds: float):
        q = observation["joint-position"].reshape(4, 3); qd = observation["joint-velocity"].reshape(4, 3)
        contacts = np.tanh(observation["foot-contact-force"] / 20.0)
        delay = int(round(float(observation["actuator-delay-steps"][0])))
        delay = min(max(delay, 0), len(self.config["phaseLeadByDelaySteps"]) - 1)
        lateral_velocity = float(observation["base-velocity"][1])
        roll_rate = float(observation["imu-angular-velocity"][0])
        phase_lead = self.config["phaseLeadByDelaySteps"][delay]
        if delay > 0 and abs(roll_rate) > self.config["disturbanceRollRateThreshold"]:
            phase_lead = self.config["disturbancePhaseLeadSeconds"]
        phase = 2.0 * np.pi * self.config["frequencyHz"] * (time_seconds + phase_lead)
        offsets = np.array([0.0, 0.0, self.config["frontRearPhase"], self.config["frontRearPhase"]]); side = np.array([1.0, -1.0, 1.0, -1.0])
        prediction = self.config["statePredictionSeconds"]
        roll = quaternion_roll(observation["base-orientation"]) + prediction * roll_rate
        correction = np.clip(self.config["rollPositionGain"] * roll + self.config["rollRateGain"] * roll_rate + self.config["lateralVelocityGain"] * lateral_velocity, -self.config["maximumRollCorrection"], self.config["maximumRollCorrection"])
        target = np.empty((4, 3))
        for leg in range(4):
            wave = np.sin(phase + offsets[leg])
            target[leg, 0] = side[leg] * self.config["neutralAbduction"] - correction
            target[leg, 1] = self.config["neutralHip"] + self.config["hipAmplitude"] * wave
            target[leg, 2] = self.config["neutralKnee"] - self.config["kneeAmplitude"] * max(0.0, wave) - self.config["contactGain"] * contacts[leg]
        predicted_q = q + prediction * qd; action = np.empty((4, 3))
        action[:, 0] = self.config["kpAbduction"] * (target[:, 0] - predicted_q[:, 0]) - self.config["kdAbduction"] * qd[:, 0]
        action[:, 1:] = self.config["kpSagittal"] * (target[:, 1:] - predicted_q[:, 1:]) - self.config["kdSagittal"] * qd[:, 1:]
        return np.clip(action.reshape(-1), -8.0, 8.0)


def create_controller(config): return LatencyAwareSpatialGaitController(config)
