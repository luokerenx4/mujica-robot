from __future__ import annotations

import numpy as np


def quaternion_roll_yaw(quaternion: np.ndarray) -> tuple[float, float]:
    w, x, y, z = quaternion
    roll = np.arctan2(2.0 * (w * x + y * z), 1.0 - 2.0 * (x * x + y * y))
    yaw = np.arctan2(2.0 * (w * z + x * y), 1.0 - 2.0 * (y * y + z * z))
    return float(roll), float(yaw)


class CommandTrackingGaitController:
    def __init__(self, config): self.config = config
    def reset(self, seed: int) -> None:
        self.seed = seed
        self.lateral_position = 0.0
        self.last_time = None

    def act(self, observation, time_seconds: float):
        q = observation["joint-position"].reshape(4, 3); qd = observation["joint-velocity"].reshape(4, 3)
        base_velocity = observation["base-velocity"]; command = observation["motion-command"]
        roll, yaw = quaternion_roll_yaw(observation["base-orientation"])
        world_to_body = np.array([[np.cos(yaw), np.sin(yaw)], [-np.sin(yaw), np.cos(yaw)]])
        body_command = world_to_body @ command[:2]
        body_velocity = world_to_body @ base_velocity[:2]
        forward = body_command[0] / self.config["nominalForwardSpeedMps"] + self.config["forwardVelocityGain"] * (body_command[0] - body_velocity[0]) / self.config["nominalForwardSpeedMps"]
        lateral = body_command[1] / self.config["nominalLateralSpeedMps"] + self.config["lateralVelocityGain"] * (body_command[1] - body_velocity[1]) / self.config["nominalLateralSpeedMps"]
        yaw_drive = command[2] / self.config["nominalYawRateRadPerSec"] + self.config["yawRateCommandGain"] * (command[2] - base_velocity[5]) / self.config["nominalYawRateRadPerSec"]
        forward, lateral, yaw_drive = np.clip([forward, lateral, yaw_drive], -1.0, 1.0)
        deadband = self.config["commandDeadband"]
        if np.linalg.norm(command) <= deadband: forward = lateral = yaw_drive = 0.0
        activity = float(np.clip(max(abs(forward), abs(lateral), abs(yaw_drive)), 0.0, 1.0))
        reverse_phase = -1.0 if abs(forward) >= max(abs(lateral), abs(yaw_drive)) and forward < 0 else 1.0
        delay = int(round(float(observation["actuator-delay-steps"][0])))
        delay = min(max(delay, 0), len(self.config["phaseLeadByDelaySteps"]) - 1)
        lateral_velocity = float(body_velocity[1])
        if self.last_time is not None: self.lateral_position += lateral_velocity * max(0.0, time_seconds - self.last_time)
        self.last_time = time_seconds
        roll_rate = float(observation["imu-angular-velocity"][0])
        phase_lead = self.config["phaseLeadByDelaySteps"][delay]
        if delay > 0 and abs(roll_rate) > self.config["disturbanceRollRateThreshold"]: phase_lead = self.config["disturbancePhaseLeadSeconds"]
        phase = reverse_phase * 2.0 * np.pi * self.config["frequencyHz"] * (time_seconds + phase_lead)
        offsets = np.array([0.0, 0.0, self.config["frontRearPhase"], self.config["frontRearPhase"]]); side = np.array([1.0, -1.0, 1.0, -1.0])
        prediction = self.config["statePredictionSeconds"]
        predicted_roll = roll + prediction * roll_rate
        correction = np.clip(self.config["rollPositionGain"] * predicted_roll + self.config["rollRateGain"] * roll_rate + self.config["rollLateralVelocityGain"] * lateral_velocity + self.config["lateralPositionGain"] * self.lateral_position, -self.config["maximumRollCorrection"], self.config["maximumRollCorrection"])
        contacts = np.tanh(observation["foot-contact-force"] / 20.0); target = np.empty((4, 3))
        for leg in range(4):
            wave = np.sin(phase + offsets[leg])
            sagittal_drive = abs(forward) + self.config["yawHipDifferential"] * yaw_drive * side[leg]
            target[leg, 0] = side[leg] * self.config["neutralAbduction"] - correction + self.config["lateralAbductionAmplitude"] * lateral * wave
            target[leg, 1] = self.config["neutralHip"] + self.config["hipAmplitude"] * sagittal_drive * wave
            target[leg, 2] = self.config["neutralKnee"] - self.config["kneeAmplitude"] * activity * max(0.0, wave) - self.config["contactGain"] * contacts[leg]
        predicted_q = q + prediction * qd; action = np.empty((4, 3))
        action[:, 0] = self.config["kpAbduction"] * (target[:, 0] - predicted_q[:, 0]) - self.config["kdAbduction"] * qd[:, 0]
        action[:, 1:] = self.config["kpSagittal"] * (target[:, 1:] - predicted_q[:, 1:]) - self.config["kdSagittal"] * qd[:, 1:]
        return np.clip(action.reshape(-1), -8.0, 8.0)


def create_controller(config): return CommandTrackingGaitController(config)
