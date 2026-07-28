from __future__ import annotations

import numpy as np


def quaternion_roll_pitch(quaternion: np.ndarray) -> tuple[float, float]:
    """Return MuJoCo wxyz roll and pitch in radians."""

    w, x, y, z = quaternion
    roll = np.arctan2(
        2.0 * (w * x + y * z),
        1.0 - 2.0 * (x * x + y * y),
    )
    pitch_argument = np.clip(2.0 * (w * y - z * x), -1.0, 1.0)
    return float(roll), float(np.arcsin(pitch_argument))


class Solo12ReadableCrawlController:
    """A deliberately small mechanism probe for the source-grounded robot.

    A four-beat joint-space crawl keeps three feet in stance while one foot
    follows a raised return arc. That is slower than a trot, but its support
    contract is mechanically honest and directly visible. Hip motion increases
    through stance and returns during the lifted swing; the mirrored knee sign
    follows the source-grounded Solo12 linkage.
    Earlier joint-space sign guesses produced either backward travel or
    three-foot sliding; those trajectories are intentionally not accepted as
    locomotion evidence. A bounded activity
    ramp makes zero command exactly the already-qualified home stand. Body
    feedback is explicit but starts disabled; it may be enabled only when
    trajectory evidence identifies a roll or pitch failure.
    """

    def __init__(self, config):
        self.home = np.asarray(config["homeTarget"], dtype=np.float64).reshape(4, 3)
        self.kp = np.asarray(
            [
                config["kpAbduction"],
                config["kpSagittal"],
                config["kpSagittal"],
            ],
            dtype=np.float64,
        )
        self.kd = np.asarray(
            [
                config["kdAbduction"],
                config["kdSagittal"],
                config["kdSagittal"],
            ],
            dtype=np.float64,
        )
        self.maximum_torque = float(config["maximumTorqueNm"])
        self.frequency_hz = float(config["frequencyHz"])
        self.duty_factor = float(config["dutyFactor"])
        self.nominal_speed = float(config["nominalForwardSpeedMps"])
        self.command_deadband = float(config["commandDeadbandMps"])
        self.activity_ramp = float(config["activityRampPerSecond"])
        self.hip_amplitude = float(config["hipAmplitudeRad"])
        self.knee_lift = float(config["kneeLiftRad"])
        self.prediction_seconds = float(config["statePredictionSeconds"])
        self.roll_position_gain = float(config["rollPositionGain"])
        self.roll_rate_gain = float(config["rollRateGain"])
        self.pitch_position_gain = float(config["pitchPositionGain"])
        self.pitch_rate_gain = float(config["pitchRateGain"])
        self.maximum_body_correction = float(config["maximumBodyCorrectionRad"])
        self.contact_threshold = float(config["contactThresholdNewton"])
        # FL, RR, FR, RL swing in sequence, preserving a support triangle.
        self.phase_offsets = np.asarray(
            [1.5 * np.pi, 0.5 * np.pi, 0.0, np.pi]
        )
        self.leg_names = ("fl", "fr", "rl", "rr")
        self.knee_sign = np.sign(self.home[:, 2])

    def reset(self, seed: int) -> None:
        self.seed = seed
        self.activity = 0.0
        self.last_time = None
        self.last_phase = 0.0
        self.last_contacts = np.zeros(4, dtype=bool)
        self.last_swing_legs: list[str] = []

    def telemetry(self):
        return {
            "mode": "locomotion" if self.activity > 1e-6 else "stand",
            "gait": "four-beat-crawl",
            "gaitPhaseRad": self.last_phase,
            "activity": self.activity,
            "swingLegs": self.last_swing_legs,
            "supportFeet": int(np.count_nonzero(self.last_contacts)),
        }

    def act(self, observation, time_seconds: float):
        position = np.asarray(
            observation["joint-position"],
            dtype=np.float64,
        ).reshape(4, 3)
        velocity = np.asarray(
            observation["joint-velocity"],
            dtype=np.float64,
        ).reshape(4, 3)
        command = np.asarray(observation["motion-command"], dtype=np.float64)
        requested = (
            float(np.clip(command[0] / self.nominal_speed, -1.0, 1.0))
            if abs(float(command[0])) > self.command_deadband
            else 0.0
        )
        desired_activity = abs(requested)
        delta_seconds = (
            0.0
            if self.last_time is None
            else max(0.0, float(time_seconds) - self.last_time)
        )
        maximum_delta = self.activity_ramp * delta_seconds
        self.activity += float(
            np.clip(
                desired_activity - self.activity,
                -maximum_delta,
                maximum_delta,
            )
        )
        self.last_time = float(time_seconds)

        direction = -1.0 if requested < 0.0 else 1.0
        phase = (
            direction
            * 2.0
            * np.pi
            * self.frequency_hz
            * float(time_seconds)
        )
        self.last_phase = float(np.mod(phase, 2.0 * np.pi))

        roll, pitch = quaternion_roll_pitch(
            np.asarray(observation["base-orientation"], dtype=np.float64)
        )
        angular_velocity = np.asarray(
            observation["imu-angular-velocity"],
            dtype=np.float64,
        )
        roll_correction = np.clip(
            self.roll_position_gain * roll
            + self.roll_rate_gain * float(angular_velocity[0]),
            -self.maximum_body_correction,
            self.maximum_body_correction,
        )
        pitch_correction = np.clip(
            self.pitch_position_gain * pitch
            + self.pitch_rate_gain * float(angular_velocity[1]),
            -self.maximum_body_correction,
            self.maximum_body_correction,
        )

        target = self.home.copy()
        swing_legs: list[str] = []
        for leg in range(4):
            leg_phase = float(
                np.mod(phase + self.phase_offsets[leg], 2.0 * np.pi)
            )
            cycle_fraction = leg_phase / (2.0 * np.pi)
            stance = cycle_fraction < self.duty_factor
            hip_offset = self.hip_amplitude * np.sin(leg_phase)
            if stance:
                knee_offset = 0.0
            else:
                swing_progress = (
                    cycle_fraction - self.duty_factor
                ) / (1.0 - self.duty_factor)
                knee_offset = (
                    self.knee_sign[leg]
                    * self.knee_lift
                    * np.sin(np.pi * swing_progress) ** 2
                )
                swing_legs.append(self.leg_names[leg])
            # The left and right link frames are mirrored geometrically while
            # their abduction axes share +X. A common signed correction
            # therefore lengthens the low side and shortens the high side.
            target[leg, 0] -= roll_correction
            target[leg, 1] += (
                self.activity * hip_offset - pitch_correction
            )
            target[leg, 2] += self.activity * knee_offset

        predicted_position = position + self.prediction_seconds * velocity
        torque = self.kp * (target - predicted_position) - self.kd * velocity
        contacts = np.asarray(
            observation["foot-contact-force"],
            dtype=np.float64,
        )
        self.last_contacts = contacts >= self.contact_threshold
        self.last_swing_legs = swing_legs
        return np.clip(
            torque.reshape(-1),
            -self.maximum_torque,
            self.maximum_torque,
        )


def create_controller(config):
    return Solo12ReadableCrawlController(config)
