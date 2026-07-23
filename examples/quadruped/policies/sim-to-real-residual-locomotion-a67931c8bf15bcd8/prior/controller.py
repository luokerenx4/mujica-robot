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


def quaternion_pitch(quaternion: np.ndarray) -> float:
    w, x, y, z = quaternion
    return float(np.arcsin(np.clip(2.0 * (w * y - z * x), -1.0, 1.0)))


class UprightTractionGaitController:
    """Traction recovery with a deliberately bounded sagittal authority surface.

    The Controller detects traction loss from measured progress exactly as its
    parent gait does.  Its package config keeps recovery below the empirically
    observed pitch-divergence boundary; no Scenario identity or friction value
    crosses the executable interface.
    """
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
        self.traction_last_time = None
        self.traction_elapsed = 0.0
        self.traction_command_progress = 0.0
        self.traction_measured_progress = 0.0
        self.progress_classification_complete = False
        self.traction_low_progress = False
        self.traction_initial_contact_seen = False
        self.traction_classification_complete = False
        self.traction_recovery = False
        self.traction_recovery_severe = False
        self.traction_recovery_started_at = None
        self.traction_probe_started_at = None
        self.traction_transition_started_at = None
        self.traction_control_blend = 0.0

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
            if self.traction_control_blend > 0.0 and self.traction_transition_started_at is None:
                self.traction_transition_started_at = time_seconds
            self.traction_elapsed = 0.0
            self.traction_command_progress = 0.0
            self.traction_measured_progress = 0.0
            self.progress_classification_complete = False
            self.traction_low_progress = False
            self.traction_initial_contact_seen = False
            self.traction_classification_complete = False
            self.traction_recovery = False
            self.traction_recovery_severe = False
            self.traction_recovery_started_at = None
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

    def crawl_wave(self, phase: float, leg: int, stance_fraction: float | None = None, phase_offsets: list[float] | None = None) -> tuple[float, float]:
        offsets = self.config["crawlPhaseOffsets"] if phase_offsets is None else phase_offsets
        cycle = (phase / (2.0 * np.pi) + offsets[leg]) % 1.0
        stance = self.config["crawlStanceFraction"] if stance_fraction is None else stance_fraction
        if cycle < stance:
            return 1.0 - 2.0 * cycle / stance, 0.0
        swing = (cycle - stance) / (1.0 - stance)
        return -1.0 + 2.0 * swing, float(np.sin(np.pi * swing))

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
        side = np.array([1.0, -1.0, 1.0, -1.0])
        prediction = self.config["statePredictionSeconds"]
        roll = quaternion_roll(observation["base-orientation"]) + prediction * roll_rate
        correction = np.clip(self.config["rollPositionGain"] * roll + self.config["rollRateGain"] * roll_rate + self.config["lateralVelocityGain"] * lateral_velocity + self.config["lateralPositionGain"] * self.lateral_position, -self.config["maximumRollCorrection"], self.config["maximumRollCorrection"])
        target = np.empty((4, 3))
        for leg in range(4):
            if (
                delay == 0
                and self.progress_classification_complete
                and self.traction_low_progress
            ) or (0 < delay < self.config["delayedTractionMinimumDelaySteps"]) or (
                delay >= self.config["delayedTractionMinimumDelaySteps"]
                and float(observation["motion-command"][0]) < self.config["delayedCrawlMinimumForwardCommandMps"]
            ):
                bound_phase_offset = self.config["tractionLowProgressBoundPhaseOffsetSeconds"] if delay == 0 else 0.0
                bound_phase = phase + 2.0 * np.pi * self.config["frequencyHz"] * bound_phase_offset
                hip_wave = lift_wave = float(np.sin(bound_phase + np.array([
                    0.0, 0.0, self.config["frontRearPhase"], self.config["frontRearPhase"]
                ])[leg]))
                hip_scale = self.config["tractionBoundHipScale"] if delay == 0 else 1.0
                knee_wave = -max(0.0, lift_wave)
            else:
                phase_offsets = self.config["delayedCrawlPhaseOffsets"] if delay > 0 else self.config["crawlPhaseOffsets"]
                hip_wave, lift_wave = self.crawl_wave(
                    phase,
                    leg,
                    phase_offsets=phase_offsets,
                )
                hip_scale = self.config["nominalForwardHipScale"]
                knee_wave = max(0.0, lift_wave)
            target[leg, 0] = side[leg] * self.config["neutralAbduction"] - correction
            target[leg, 1] = self.config["neutralHip"] + self.config["hipAmplitude"] * hip_scale * hip_wave
            target[leg, 2] = self.config["neutralKnee"] + self.config["kneeAmplitude"] * knee_wave - self.config["contactGain"] * contacts[leg]
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
        traction_dt = 0.0 if self.traction_last_time is None else max(0.0, time_seconds - self.traction_last_time)
        self.traction_last_time = time_seconds
        forward_assessment = raw_command[0] > self.config["commandDeadband"] and abs(raw_command[1]) <= self.config["commandDeadband"] and abs(raw_command[2]) <= self.config["commandDeadband"]
        if forward_assessment and not self.saw_transition:
            self.traction_elapsed += traction_dt
            self.traction_command_progress += float(raw_command[0]) * traction_dt
            self.traction_measured_progress += float(base_velocity[0]) * traction_dt
            if delay == 0:
                if (
                    not self.progress_classification_complete
                    and self.traction_elapsed >= self.config["tractionProgressClassificationSeconds"]
                ):
                    progress_ratio = self.traction_measured_progress / max(self.traction_command_progress, 1e-9)
                    self.traction_low_progress = progress_ratio < self.config["tractionLowProgressRatio"]
                    self.progress_classification_complete = True
                observed_pitch = quaternion_pitch(observation["base-orientation"])
                if self.traction_elapsed <= self.config["tractionRecoveryEmergencyAssessmentSeconds"] and observed_pitch <= -self.config["tractionRecoveryEmergencyBackwardPitchRad"]:
                    if not self.traction_recovery:
                        self.traction_recovery_started_at = time_seconds
                    self.traction_recovery = True
                    self.traction_recovery_severe = True
                deficit = self.traction_command_progress - self.traction_measured_progress
                if self.traction_elapsed <= self.config["tractionRecoveryAssessmentSeconds"] and deficit > self.config["tractionRecoveryProgressDeficitM"]:
                    if not self.traction_recovery:
                        self.traction_recovery_started_at = time_seconds
                    self.traction_recovery = True
            elif delay >= self.config["delayedTractionMinimumDelaySteps"] and self.traction_elapsed <= self.config["delayedTractionContactAssessmentSeconds"] + 1e-9:
                mean_contact = float(np.mean(observation["foot-contact-force"]))
                if not self.traction_initial_contact_seen:
                    if mean_contact >= self.config["delayedTractionInitialContactMeanN"]: self.traction_initial_contact_seen = True
                else:
                    self.traction_classification_complete = True
                    if mean_contact <= self.config["delayedTractionPostContactLossMeanN"]:
                        if not self.traction_recovery: self.traction_recovery_started_at = time_seconds
                        self.traction_recovery = True
        delayed_probe_blend = 0.0
        if forward_assessment and not self.saw_transition and delay >= self.config["delayedTractionMinimumDelaySteps"]:
            assessment = self.config["delayedTractionContactAssessmentSeconds"]
            if self.traction_recovery:
                delayed_probe_blend = 1.0
            elif self.traction_classification_complete:
                delayed_probe_blend = 1.0
            elif self.traction_elapsed <= assessment:
                delayed_probe_blend = 1.0 if self.traction_elapsed > 0.0 else 0.0
            else:
                delayed_probe_blend = 1.0
            if delayed_probe_blend > 0.0 and self.traction_probe_started_at is None: self.traction_probe_started_at = time_seconds
        if not self.saw_transition and forward_assessment and not self.traction_recovery and delayed_probe_blend <= 0.0:
            self.traction_control_blend = 0.0
            return self.legacy_forward_act(observation, time_seconds)
        roll, yaw = quaternion_roll_yaw(observation["base-orientation"])
        pitch = quaternion_pitch(observation["base-orientation"])
        if self.traction_recovery and delay == 0 and pitch <= -self.config["tractionRecoverySevereBackwardPitchRad"]:
            self.traction_recovery_severe = True
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
        delayed_longitudinal_mode = (
            delay >= self.config["delayedTractionMinimumDelaySteps"]
            and self.motion_mode == "longitudinal"
        )
        delayed_crawl_mode = (
            delayed_longitudinal_mode
            and forward_assessment
            and not self.saw_transition
            and raw_command[0] >= self.config["delayedCrawlMinimumForwardCommandMps"]
        )
        if self.motion_mode == "longitudinal":
            if delay > 0 and self.traction_transition_started_at is not None:
                transition_forward_gain = self.config["delayedTractionBrakingForwardVelocityGain"] if np.linalg.norm(raw_command) <= deadband else self.config["delayedTractionTransitionForwardVelocityGain"]
            else: transition_forward_gain = self.config["delayedTransitionForwardVelocityGain"] if delay > 0 else self.config["transitionForwardVelocityGain"]
        else:
            transition_forward_gain = self.config["transitionLateralVelocityGain"]
        forward_gain = self.config["forwardVelocityGain"] + transition_gain * transition_forward_gain
        lateral_gain = self.config["commandLateralVelocityGain"] + transition_gain * self.config["transitionLateralVelocityGain"]
        if abs(command[2]) > deadband: transition_yaw_gain = self.config["transitionYawRateGain"]
        elif delay > 0 and self.traction_transition_started_at is not None: transition_yaw_gain = self.config["delayedTractionTransitionYawDampingGain"]
        else: transition_yaw_gain = self.config["transitionYawDampingGain"]
        yaw_gain = self.config["yawRateCommandGain"] + transition_gain * transition_yaw_gain
        forward = body_command[0] / self.config["nominalForwardSpeedMps"] + forward_gain * (body_command[0] - body_velocity[0]) / self.config["nominalForwardSpeedMps"]
        lateral = body_command[1] / self.config["nominalLateralSpeedMps"] + lateral_gain * (body_command[1] - body_velocity[1]) / self.config["nominalLateralSpeedMps"]
        yaw_drive = command[2] / self.config["nominalYawRateRadPerSec"] + yaw_gain * (command[2] - base_velocity[5]) / self.config["nominalYawRateRadPerSec"]
        yaw_bias_drive = float(np.clip(command[2] / self.config["nominalYawRateRadPerSec"], -1.0, 1.0))
        forward, lateral, yaw_drive = np.clip([forward, lateral, yaw_drive], -1.0, 1.0)
        if forward_assessment and not self.saw_transition and delay > 0:
            forward = max(0.0, forward)
            if delayed_crawl_mode:
                forward = self.config["delayedCrawlCruiseDrive"]
        if longitudinal_only:
            if self.motion_mode != "spatial" or not self.saw_transition: lateral = 0.0
            if self.traction_transition_started_at is None: yaw_drive = 0.0
        if np.linalg.norm(command) <= deadband and not self.saw_transition: forward = lateral = yaw_drive = 0.0
        activity = float(np.clip(max(abs(forward), abs(lateral), abs(yaw_drive)), 0.0, 1.0))
        reverse_forward = abs(forward) >= max(abs(lateral), abs(yaw_drive)) and forward < 0
        delayed_longitudinal_crawl = delayed_crawl_mode
        phase_direction = -1.0 if reverse_forward and not delayed_longitudinal_crawl else 1.0
        lateral_velocity = float(body_velocity[1])
        if self.last_time is not None: self.lateral_position += lateral_velocity * max(0.0, time_seconds - self.last_time)
        self.last_time = time_seconds
        roll_rate = float(observation["imu-angular-velocity"][0])
        recovery_blend = delayed_probe_blend
        if self.saw_transition and delay >= self.config["delayedTractionMinimumDelaySteps"] and self.traction_transition_started_at is not None:
            recovery_blend = float(np.clip(1.0 - (time_seconds - self.traction_transition_started_at) / self.config["delayedTractionTransitionReleaseSeconds"], 0.0, 1.0))
        self.traction_control_blend = recovery_blend
        if self.saw_transition and delay == 2: legacy_phase_lead = self.config["transitionDelayTwoPhaseLeadSeconds"]
        elif self.saw_transition and delay == 3: legacy_phase_lead = self.config["transitionDelayThreePhaseLeadSeconds"]
        else: legacy_phase_lead = self.config["phaseLeadByDelaySteps"][delay]
        phase_lead = legacy_phase_lead + recovery_blend * (self.config["delayedTractionRecoveryPhaseLeadSeconds"] - legacy_phase_lead)
        if delay > 0 and abs(roll_rate) > self.config["disturbanceRollRateThreshold"]:
            legacy_disturbance_lead = self.config["transitionDisturbancePhaseLeadSeconds"] if self.saw_transition else self.config["disturbancePhaseLeadSeconds"]
            phase_lead = legacy_disturbance_lead + recovery_blend * (self.config["transitionDisturbancePhaseLeadSeconds"] - legacy_disturbance_lead)
        delayed_frequency_scale = self.config["delayedTractionRecoveryFrequencyScale"] if delayed_crawl_mode else self.config["delayedTractionBoundRecoveryFrequencyScale"]
        frequency_scale = 1.0 + recovery_blend * (delayed_frequency_scale - 1.0)
        phase = phase_direction * 2.0 * np.pi * self.config["frequencyHz"] * frequency_scale * (time_seconds + phase_lead)
        crawl_mode = forward_assessment and not self.saw_transition and (
            delay == 0 or delayed_crawl_mode
        )
        traction_bound_mode = (
            crawl_mode
            and delay == 0
            and self.progress_classification_complete
            and self.traction_low_progress
        )
        negative_yaw = command[2] < -deadband
        yaw_phase_differential = self.config["negativeYawPhaseDifferential"] if negative_yaw else self.config["yawPhaseDifferential"]
        yaw_hip_differential = self.config["negativeYawHipDifferential"] if negative_yaw else self.config["yawHipDifferential"]
        yaw_abduction_differential = self.config["negativeYawAbductionDifferential"] if negative_yaw else self.config["yawAbductionDifferential"]
        yaw_abduction_bias = self.config["negativeYawAbductionBias"] if negative_yaw else self.config["yawAbductionBias"]
        side = np.array([1.0, -1.0, 1.0, -1.0]); front = np.array([1.0, 1.0, -1.0, -1.0])
        steering_offsets = yaw_phase_differential * yaw_drive * side
        bound_offsets = np.array([0.0, 0.0, self.config["frontRearPhase"], self.config["frontRearPhase"]]) + steering_offsets
        prediction = self.config["statePredictionSeconds"]
        predicted_roll = roll + prediction * roll_rate
        command_lean = self.config["delayedLateralCommandLean"] if delay > 0 else self.config["lateralCommandLean"]
        delayed_lateral_velocity_gain = self.config["delayedTractionLateralVelocityGain"] if delayed_crawl_mode else self.config["delayedTractionBoundLateralVelocityGain"]
        delayed_lateral_position_gain = self.config["delayedTractionLateralPositionGain"] if delayed_crawl_mode else self.config["delayedTractionBoundLateralPositionGain"]
        lateral_velocity_gain = self.config["rollLateralVelocityGain"] + recovery_blend * (delayed_lateral_velocity_gain - self.config["rollLateralVelocityGain"])
        lateral_position_gain = self.config["lateralPositionGain"] + recovery_blend * (delayed_lateral_position_gain - self.config["lateralPositionGain"])
        if self.saw_transition and delay >= self.config["delayedTractionMinimumDelaySteps"] and self.motion_mode == "longitudinal":
            lateral_position_gain = self.config["delayedTractionBoundLateralPositionGain"]
        correction = np.clip(self.config["rollPositionGain"] * predicted_roll + self.config["rollRateGain"] * roll_rate + lateral_velocity_gain * lateral_velocity + lateral_position_gain * self.lateral_position + command_lean * lateral, -self.config["maximumRollCorrection"], self.config["maximumRollCorrection"])
        contacts = np.tanh(observation["foot-contact-force"] / 20.0); target = np.empty((4, 3))
        if delay > 0:
            recovery_scale = self.config["delayedTractionRecoveryHipScale"] if delayed_crawl_mode else self.config["delayedTractionBoundRecoveryHipScale"]
        elif self.traction_recovery_severe:
            recovery_scale = self.config["tractionRecoverySevereHipScale"]
        else:
            recovery_scale = self.config["tractionRecoveryHipScale"]
        if delay > 0 and recovery_blend > 0.0:
            startup_blend = float(np.clip((time_seconds - float(self.traction_probe_started_at)) / self.config["delayedTractionRecoveryRampSeconds"], 0.0, 1.0))
            hip_blend = min(startup_blend, recovery_blend)
            recovery_scale = 1.0 + (recovery_scale - 1.0) * hip_blend
        hip_amplitude = self.config["hipAmplitude"] * (recovery_scale if self.traction_recovery or recovery_blend > 0.0 else 1.0)
        for leg in range(4):
            if crawl_mode and not traction_bound_mode:
                stance_fraction = self.config["delayedCrawlStanceFraction"] if delay > 0 else self.config["crawlStanceFraction"]
                phase_offsets = self.config["delayedCrawlPhaseOffsets"] if delay > 0 else self.config["crawlPhaseOffsets"]
                hip_wave, lift_wave = self.crawl_wave(
                    phase,
                    leg,
                    stance_fraction,
                    phase_offsets=phase_offsets,
                )
                knee_wave = max(0.0, lift_wave)
            else:
                bound_phase = phase
                if traction_bound_mode:
                    bound_phase += 2.0 * np.pi * self.config["frequencyHz"] * self.config["tractionLowProgressBoundPhaseOffsetSeconds"]
                hip_wave = lift_wave = np.sin(bound_phase + bound_offsets[leg])
                knee_wave = -max(0.0, lift_wave)
            if delayed_longitudinal_crawl:
                longitudinal_drive = forward * (self.config["reverseHipScale"] if reverse_forward else 1.0)
            else:
                longitudinal_drive = abs(forward) * (self.config["reverseHipScale"] if reverse_forward else 1.0)
            sagittal_drive = longitudinal_drive + yaw_hip_differential * yaw_drive * side[leg]
            if crawl_mode and delay > 0:
                drive_ramp = float(np.clip(time_seconds / self.config["delayedCrawlDriveRampSeconds"], 0.0, 1.0))
                sagittal_drive *= drive_ramp
            target[leg, 0] = side[leg] * self.config["neutralAbduction"] - correction + self.config["lateralAbductionAmplitude"] * lateral * lift_wave + yaw_abduction_differential * yaw_drive * side[leg] * lift_wave + yaw_abduction_bias * yaw_bias_drive * front[leg]
            target[leg, 1] = self.config["neutralHip"] + hip_amplitude * sagittal_drive * hip_wave
            knee_amplitude = self.config["delayedCrawlKneeAmplitude"] if crawl_mode and delay > 0 else self.config["kneeAmplitude"]
            target[leg, 2] = self.config["neutralKnee"] + knee_amplitude * activity * knee_wave - self.config["contactGain"] * contacts[leg]
        predicted_q = q + prediction * qd; action = np.empty((4, 3))
        action[:, 0] = self.config["kpAbduction"] * (target[:, 0] - predicted_q[:, 0]) - self.config["kdAbduction"] * qd[:, 0]
        kd_sagittal_scale = 1.0 + recovery_blend * (self.config["delayedTractionKdSagittalScale"] - 1.0)
        action[:, 1:] = self.config["kpSagittal"] * (target[:, 1:] - predicted_q[:, 1:]) - self.config["kdSagittal"] * kd_sagittal_scale * qd[:, 1:]
        return np.clip(action.reshape(-1), -8.0, 8.0)


def create_controller(config): return UprightTractionGaitController(config)
