from __future__ import annotations

import numpy as np


def quaternion_roll(quaternion: np.ndarray) -> float:
    w, x, y, z = quaternion
    return float(np.arctan2(2.0 * (w * x + y * z), 1.0 - 2.0 * (x * x + y * y)))


def quaternion_roll_yaw(quaternion: np.ndarray) -> tuple[float, float]:
    w, x, y, z = quaternion
    roll = np.arctan2(2.0 * (w * x + y * z), 1.0 - 2.0 * (x * x + y * y))
    yaw = np.arctan2(2.0 * (w * z + x * y), 1.0 - 2.0 * (y * y + z * z))
    return float(roll), float(yaw)


class TransitionAwareGaitController:
    def __init__(self, config): self.config = config
    def reset(self, seed: int) -> None:
        self.seed = seed
        self.lateral_position = 0.0
        self.world_position = np.zeros(2, dtype=np.float64)
        self.last_time = None
        self.filter_last_time = None
        self.previous_raw_command = None
        self.filtered_command = None
        self.saw_transition = False
        self.motion_mode = None

    def update_command(self, raw_command: np.ndarray, time_seconds: float, delay: int) -> np.ndarray:
        raw = np.asarray(raw_command, dtype=np.float64)
        if self.previous_raw_command is None:
            self.previous_raw_command = raw.copy(); self.filtered_command = raw.copy(); self.filter_last_time = time_seconds
            if np.linalg.norm(raw) > self.config["commandDeadband"]: self.motion_mode = "longitudinal" if abs(raw[1]) <= self.config["commandDeadband"] and abs(raw[2]) <= self.config["commandDeadband"] else "spatial"
            return raw.copy()
        changed = not np.allclose(raw, self.previous_raw_command, rtol=0.0, atol=1e-12)
        if changed:
            self.saw_transition = True
            self.previous_raw_command = raw.copy()
            if np.linalg.norm(raw) > self.config["commandDeadband"]: self.motion_mode = "longitudinal" if abs(raw[1]) <= self.config["commandDeadband"] and abs(raw[2]) <= self.config["commandDeadband"] else "spatial"
        dt = max(0.0, time_seconds - float(self.filter_last_time))
        self.filter_last_time = time_seconds
        scale = self.config["delayedCommandRateScale"] if delay > 0 else 1.0
        planar_rate = self.config["delayedStopRateLimitMps2"] if delay > 0 and self.motion_mode == "longitudinal" and np.linalg.norm(raw) <= self.config["commandDeadband"] else self.config["planarCommandRateLimitMps2"]
        planar_limit = planar_rate * scale * dt
        planar_delta = raw[:2] - self.filtered_command[:2]
        planar_size = float(np.linalg.norm(planar_delta))
        if planar_size > planar_limit > 0: planar_delta *= planar_limit / planar_size
        yaw_limit = self.config["yawCommandRateLimitRadPerSec2"] * scale * dt
        yaw_delta = float(np.clip(raw[2] - self.filtered_command[2], -yaw_limit, yaw_limit)) if yaw_limit > 0 else 0.0
        self.filtered_command[:2] += planar_delta
        self.filtered_command[2] += yaw_delta
        return self.filtered_command.copy()

    def legacy_forward_act(self, observation, time_seconds: float):
        q = observation["joint-position"].reshape(4, 3); qd = observation["joint-velocity"].reshape(4, 3)
        contacts = np.tanh(observation["foot-contact-force"] / 20.0)
        delay = int(round(float(observation["actuator-delay-steps"][0])))
        delay = min(max(delay, 0), len(self.config["phaseLeadByDelaySteps"]) - 1)
        lateral_velocity = float(observation["base-velocity"][1])
        if self.last_time is not None: self.lateral_position += lateral_velocity * max(0.0, time_seconds - self.last_time)
        self.last_time = time_seconds
        roll_rate = float(observation["imu-angular-velocity"][0])
        phase_lead = self.config["phaseLeadByDelaySteps"][delay]
        if delay > 0 and abs(roll_rate) > self.config["disturbanceRollRateThreshold"]: phase_lead = self.config["disturbancePhaseLeadSeconds"]
        phase = 2.0 * np.pi * self.config["frequencyHz"] * (time_seconds + phase_lead)
        offsets = np.array([0.0, 0.0, self.config["frontRearPhase"], self.config["frontRearPhase"]]); side = np.array([1.0, -1.0, 1.0, -1.0])
        prediction = self.config["statePredictionSeconds"]
        roll = quaternion_roll(observation["base-orientation"]) + prediction * roll_rate
        correction = np.clip(self.config["rollPositionGain"] * roll + self.config["rollRateGain"] * roll_rate + self.config["lateralVelocityGain"] * lateral_velocity + self.config["lateralPositionGain"] * self.lateral_position, -self.config["maximumRollCorrection"], self.config["maximumRollCorrection"])
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

    def act(self, observation, time_seconds: float):
        q = observation["joint-position"].reshape(4, 3); qd = observation["joint-velocity"].reshape(4, 3)
        base_velocity = observation["base-velocity"]; raw_command = observation["motion-command"]
        delay = int(round(float(observation["actuator-delay-steps"][0])))
        delay = min(max(delay, 0), len(self.config["phaseLeadByDelaySteps"]) - 1)
        command = self.update_command(raw_command, time_seconds, delay)
        if not self.saw_transition and raw_command[0] > self.config["commandDeadband"] and abs(raw_command[1]) <= self.config["commandDeadband"] and abs(raw_command[2]) <= self.config["commandDeadband"]:
            return self.legacy_forward_act(observation, time_seconds)
        roll, yaw = quaternion_roll_yaw(observation["base-orientation"])
        world_to_body = np.array([[np.cos(yaw), np.sin(yaw)], [-np.sin(yaw), np.cos(yaw)]])
        deadband = self.config["commandDeadband"]
        longitudinal_only = abs(command[1]) <= deadband and abs(command[2]) <= deadband
        body_command = np.array([command[0], 0.0]) if longitudinal_only else world_to_body @ command[:2]
        body_velocity = world_to_body @ base_velocity[:2]
        if self.last_time is not None: self.world_position += base_velocity[:2] * max(0.0, time_seconds - self.last_time)
        planar_speed = float(np.linalg.norm(command[:2]))
        if planar_speed > 1e-9 and not longitudinal_only:
            direction = command[:2] / planar_speed; cross_axis = np.array([-direction[1], direction[0]])
            cross_position = float(np.dot(self.world_position, cross_axis)); cross_velocity = float(np.dot(base_velocity[:2], cross_axis))
            cross_correction_world = -(self.config["crossTrackPositionGain"] * cross_position + self.config["crossTrackVelocityGain"] * cross_velocity) * cross_axis
            body_command = body_command + world_to_body @ cross_correction_world
        transition_gain = 1.0 if self.saw_transition else 0.0
        transition_forward_gain = self.config["transitionForwardVelocityGain"] if self.motion_mode == "longitudinal" else self.config["transitionLateralVelocityGain"]
        forward_gain = self.config["forwardVelocityGain"] + transition_gain * transition_forward_gain
        lateral_gain = self.config["commandLateralVelocityGain"] + transition_gain * self.config["transitionLateralVelocityGain"]
        transition_yaw_gain = self.config["transitionYawRateGain"] if abs(command[2]) > deadband else self.config["transitionYawDampingGain"]
        yaw_gain = self.config["yawRateCommandGain"] + transition_gain * transition_yaw_gain
        forward = body_command[0] / self.config["nominalForwardSpeedMps"] + forward_gain * (body_command[0] - body_velocity[0]) / self.config["nominalForwardSpeedMps"]
        lateral = body_command[1] / self.config["nominalLateralSpeedMps"] + lateral_gain * (body_command[1] - body_velocity[1]) / self.config["nominalLateralSpeedMps"]
        yaw_drive = command[2] / self.config["nominalYawRateRadPerSec"] + yaw_gain * (command[2] - base_velocity[5]) / self.config["nominalYawRateRadPerSec"]
        yaw_bias_drive = float(np.clip(command[2] / self.config["nominalYawRateRadPerSec"], -1.0, 1.0))
        forward, lateral, yaw_drive = np.clip([forward, lateral, yaw_drive], -1.0, 1.0)
        if longitudinal_only:
            lateral = 0.0
            yaw_drive = 0.0
        if np.linalg.norm(command) <= deadband and not self.saw_transition: forward = lateral = yaw_drive = 0.0
        activity = float(np.clip(max(abs(forward), abs(lateral), abs(yaw_drive)), 0.0, 1.0))
        reverse_phase = -1.0 if abs(forward) >= max(abs(lateral), abs(yaw_drive)) and forward < 0 else 1.0
        lateral_velocity = float(body_velocity[1])
        if self.last_time is not None: self.lateral_position += lateral_velocity * max(0.0, time_seconds - self.last_time)
        self.last_time = time_seconds
        roll_rate = float(observation["imu-angular-velocity"][0])
        if self.saw_transition and delay == 2: phase_lead = self.config["transitionDelayTwoPhaseLeadSeconds"]
        elif self.saw_transition and delay == 3: phase_lead = self.config["transitionDelayThreePhaseLeadSeconds"]
        else: phase_lead = self.config["phaseLeadByDelaySteps"][delay]
        if delay > 0 and abs(roll_rate) > self.config["disturbanceRollRateThreshold"]: phase_lead = self.config["disturbancePhaseLeadSeconds"]
        phase = reverse_phase * 2.0 * np.pi * self.config["frequencyHz"] * (time_seconds + phase_lead)
        side = np.array([1.0, -1.0, 1.0, -1.0]); front = np.array([1.0, 1.0, -1.0, -1.0]); offsets = np.array([0.0, 0.0, self.config["frontRearPhase"], self.config["frontRearPhase"]]) + self.config["yawPhaseDifferential"] * yaw_drive * side
        prediction = self.config["statePredictionSeconds"]
        predicted_roll = roll + prediction * roll_rate
        command_lean = self.config["delayedLateralCommandLean"] if delay > 0 else self.config["lateralCommandLean"]
        correction = np.clip(self.config["rollPositionGain"] * predicted_roll + self.config["rollRateGain"] * roll_rate + self.config["rollLateralVelocityGain"] * lateral_velocity + self.config["lateralPositionGain"] * self.lateral_position + command_lean * lateral, -self.config["maximumRollCorrection"], self.config["maximumRollCorrection"])
        contacts = np.tanh(observation["foot-contact-force"] / 20.0); target = np.empty((4, 3))
        for leg in range(4):
            wave = np.sin(phase + offsets[leg])
            sagittal_drive = abs(forward) * (self.config["reverseHipScale"] if reverse_phase < 0 else 1.0) + self.config["yawHipDifferential"] * yaw_drive * side[leg]
            target[leg, 0] = side[leg] * self.config["neutralAbduction"] - correction + self.config["lateralAbductionAmplitude"] * lateral * wave + self.config["yawAbductionDifferential"] * yaw_drive * side[leg] * wave + self.config["yawAbductionBias"] * yaw_bias_drive * front[leg]
            target[leg, 1] = self.config["neutralHip"] + self.config["hipAmplitude"] * sagittal_drive * wave
            target[leg, 2] = self.config["neutralKnee"] - self.config["kneeAmplitude"] * activity * max(0.0, wave) - self.config["contactGain"] * contacts[leg]
        predicted_q = q + prediction * qd; action = np.empty((4, 3))
        action[:, 0] = self.config["kpAbduction"] * (target[:, 0] - predicted_q[:, 0]) - self.config["kdAbduction"] * qd[:, 0]
        action[:, 1:] = self.config["kpSagittal"] * (target[:, 1:] - predicted_q[:, 1:]) - self.config["kdSagittal"] * qd[:, 1:]
        return np.clip(action.reshape(-1), -8.0, 8.0)


def create_controller(config): return TransitionAwareGaitController(config)
