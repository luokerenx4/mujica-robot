from __future__ import annotations

import numpy as np


def quaternion_yaw(quaternion: np.ndarray) -> float:
    """Return MuJoCo wxyz yaw in radians."""

    w, x, y, z = quaternion
    return float(
        np.arctan2(
            2.0 * (w * z + x * y),
            1.0 - 2.0 * (y * y + z * z),
        )
    )


class Solo12CommandCrawlController:
    """Cartesian command basis on a readable four-beat support schedule.

    The source-grounded Solo12 leg has one HAA joint followed by a planar
    two-link HFE/KFE chain. During stance, each foot moves opposite the
    commanded body translation. Yaw adds the corresponding tangential foot
    velocity. During swing, that foot returns along the same horizontal path
    with explicit vertical clearance. Analytic inverse kinematics maps the
    inspectable foot target back to the twelve torque-controlled joints.
    """

    def __init__(self, config):
        self.home = np.asarray(
            config["homeTarget"], dtype=np.float64
        ).reshape(4, 3)
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
        self.kp_abduction_spatial = float(
            config["kpAbductionSpatial"]
        )
        self.kd_abduction_spatial = float(
            config["kdAbductionSpatial"]
        )
        self.maximum_target_joint_speed = float(
            config["maximumTargetJointSpeedRadPerSec"]
        )
        self.maximum_torque = float(config["maximumTorqueNm"])
        self.frequency_hz = float(config["frequencyHz"])
        self.duty_factor = float(config["dutyFactor"])
        self.nominal_command = np.asarray(
            [
                config["nominalForwardSpeedMps"],
                config["nominalLateralSpeedMps"],
                config["nominalYawRateRadPerSec"],
            ],
            dtype=np.float64,
        )
        self.command_deadband = float(config["commandDeadband"])
        self.command_ramp = float(config["commandRampPerSecond"])
        self.upper_length = float(config["upperLegLengthM"])
        self.lower_length = float(config["lowerLegLengthM"])
        lateral_offset = float(config["hipLateralOffsetM"])
        self.side_sign = np.asarray([1.0, -1.0, 1.0, -1.0])
        self.front_sign = np.asarray([1.0, 1.0, -1.0, -1.0])
        self.sagittal_origin_x = np.asarray(
            [
                config["frontHipLongitudinalOffsetM"],
                config["frontHipLongitudinalOffsetM"],
                config["rearHipLongitudinalOffsetM"],
                config["rearHipLongitudinalOffsetM"],
            ],
            dtype=np.float64,
        )
        self.sagittal_origin_y = lateral_offset * self.side_sign
        self.hip_amplitude = float(config["hipAmplitudeRad"])
        self.reverse_hip_amplitude = float(
            config["reverseHipAmplitudeRad"]
        )
        self.knee_lift = float(config["kneeLiftRad"])
        self.reverse_hip_phase = float(config["reverseHipPhaseRad"])
        self.lateral_half_stroke = float(config["lateralHalfStrokeM"])
        self.lateral_frequency_scale = float(
            config["lateralFrequencyScale"]
        )
        self.yaw_half_stroke = float(config["yawTangentialHalfStrokeM"])
        self.swing_clearance = float(config["swingClearanceM"])
        self.prediction_seconds = float(config["statePredictionSeconds"])
        self.contact_threshold = float(config["contactThresholdNewton"])
        # FL, RR, FR, RL swing in sequence, preserving a support triangle.
        self.phase_offsets = np.asarray(
            [1.5 * np.pi, 0.5 * np.pi, 0.0, np.pi]
        )
        self.leg_names = ("fl", "fr", "rl", "rr")
        self.knee_sign = np.sign(self.home[:, 2])
        self.home_feet = np.asarray(
            [
                self.forward_kinematics(leg, self.home[leg])
                for leg in range(4)
            ]
        )

    def forward_kinematics(
        self, leg: int, joint_position: np.ndarray
    ) -> np.ndarray:
        abduction, hip, knee = joint_position
        x = (
            self.sagittal_origin_x[leg]
            - self.upper_length * np.sin(hip)
            - self.lower_length * np.sin(hip + knee)
        )
        y_before_abduction = self.sagittal_origin_y[leg]
        z_before_abduction = (
            -self.upper_length * np.cos(hip)
            - self.lower_length * np.cos(hip + knee)
        )
        cosine = np.cos(abduction)
        sine = np.sin(abduction)
        return np.asarray(
            [
                x,
                cosine * y_before_abduction
                - sine * z_before_abduction,
                sine * y_before_abduction
                + cosine * z_before_abduction,
            ],
            dtype=np.float64,
        )

    def inverse_kinematics(
        self, leg: int, foot: np.ndarray
    ) -> np.ndarray:
        x, y, z = foot
        lateral_origin = self.sagittal_origin_y[leg]
        radial_squared = max(
            y * y + z * z - lateral_origin * lateral_origin,
            1e-10,
        )
        z_before_abduction = -np.sqrt(radial_squared)
        abduction = (
            np.arctan2(z, y)
            - np.arctan2(z_before_abduction, lateral_origin)
        )

        sagittal_x = x - self.sagittal_origin_x[leg]
        reach_squared = sagittal_x * sagittal_x + z_before_abduction**2
        cosine_knee = np.clip(
            (
                reach_squared
                - self.upper_length**2
                - self.lower_length**2
            )
            / (2.0 * self.upper_length * self.lower_length),
            -1.0,
            1.0,
        )
        knee = self.knee_sign[leg] * np.arccos(cosine_knee)
        hip = np.arctan2(-sagittal_x, -z_before_abduction) - np.arctan2(
            self.lower_length * np.sin(knee),
            self.upper_length + self.lower_length * np.cos(knee),
        )
        return np.asarray([abduction, hip, knee], dtype=np.float64)

    def reset(self, seed: int) -> None:
        self.seed = seed
        self.filtered_drive = np.zeros(3, dtype=np.float64)
        self.requested_drive = np.zeros(3, dtype=np.float64)
        self.phase = 0.0
        self.last_time = None
        self.last_contacts = np.zeros(4, dtype=bool)
        self.last_swing_legs: list[str] = []
        self.last_foot_targets = self.home_feet.copy()
        self.last_basis = "stand"
        self.last_joint_target = self.home.copy()

    def telemetry(self):
        return {
            "mode": (
                "locomotion"
                if np.max(np.abs(self.filtered_drive)) > 1e-6
                else "stand"
            ),
            "gait": "four-beat-cartesian-crawl",
            "gaitPhaseRad": self.phase,
            "requestedDrive": self.requested_drive.tolist(),
            "filteredDrive": self.filtered_drive.tolist(),
            "commandBasis": self.last_basis,
            "swingLegs": self.last_swing_legs,
            "supportFeet": int(np.count_nonzero(self.last_contacts)),
            "footTargetsM": self.last_foot_targets.tolist(),
        }

    def act(self, observation, time_seconds: float):
        position = np.asarray(
            observation["joint-position"], dtype=np.float64
        ).reshape(4, 3)
        velocity = np.asarray(
            observation["joint-velocity"], dtype=np.float64
        ).reshape(4, 3)
        command = np.asarray(
            observation["motion-command"], dtype=np.float64
        )
        yaw = quaternion_yaw(
            np.asarray(
                observation["base-orientation"], dtype=np.float64
            )
        )
        world_to_body = np.asarray(
            [
                [np.cos(yaw), np.sin(yaw)],
                [-np.sin(yaw), np.cos(yaw)],
            ],
            dtype=np.float64,
        )
        body_planar_command = world_to_body @ command[:2]
        requested_drive = np.asarray(
            [
                body_planar_command[0] / self.nominal_command[0],
                body_planar_command[1] / self.nominal_command[1],
                command[2] / self.nominal_command[2],
            ],
            dtype=np.float64,
        )
        requested_drive[np.abs(requested_drive) < self.command_deadband] = 0.0
        self.requested_drive = np.clip(
            requested_drive, -1.0, 1.0
        )

        delta_seconds = (
            0.0
            if self.last_time is None
            else max(0.0, float(time_seconds) - self.last_time)
        )
        maximum_delta = self.command_ramp * delta_seconds
        self.filtered_drive += np.clip(
            self.requested_drive - self.filtered_drive,
            -maximum_delta,
            maximum_delta,
        )
        self.last_time = float(time_seconds)
        forward, lateral, yaw_drive = self.filtered_drive
        activity = float(np.max(np.abs(self.filtered_drive)))
        dominant_axis = int(np.argmax(np.abs(self.filtered_drive)))
        if activity <= 1e-6:
            basis = "stand"
        elif dominant_axis == 0:
            basis = "longitudinal"
        elif dominant_axis == 1:
            basis = "lateral"
        else:
            basis = "yaw"
        frequency_scale = (
            self.lateral_frequency_scale
            if basis == "lateral"
            else 1.0
        )
        self.phase = float(
            np.mod(
                self.phase
                + 2.0
                * np.pi
                * self.frequency_hz
                * frequency_scale
                * delta_seconds,
                2.0 * np.pi,
            )
        )

        target = self.home.copy()
        foot_targets = self.home_feet.copy()
        swing_legs: list[str] = []
        for leg in range(4):
            leg_phase = float(
                np.mod(
                    self.phase + self.phase_offsets[leg],
                    2.0 * np.pi,
                )
            )
            cycle_fraction = leg_phase / (2.0 * np.pi)
            stance = cycle_fraction < self.duty_factor
            if stance:
                stance_progress = cycle_fraction / self.duty_factor
                # All planted feet receive one constant relative velocity.
                # Phase-dependent cosine velocity would make the support feet
                # fight and slide against one another.
                stroke = 1.0 - 2.0 * stance_progress
                clearance = 0.0
            else:
                swing_progress = (
                    cycle_fraction - self.duty_factor
                ) / (1.0 - self.duty_factor)
                stroke = -np.cos(np.pi * swing_progress)
                clearance = (
                    activity
                    * self.swing_clearance
                    * np.sin(np.pi * swing_progress) ** 2
                )
                swing_legs.append(self.leg_names[leg])

            foot_targets[leg, 0] += (
                -self.yaw_half_stroke
                * yaw_drive
                * self.side_sign[leg]
                * stroke
            )
            foot_targets[leg, 1] += (
                self.lateral_half_stroke * lateral * stroke
                + self.yaw_half_stroke
                * yaw_drive
                * self.front_sign[leg]
                * stroke
            )
            foot_targets[leg, 2] += clearance
            if basis == "longitudinal":
                reverse_phase = (
                    self.reverse_hip_phase if forward < 0.0 else 0.0
                )
                target[leg, 1] += (
                    (
                        self.reverse_hip_amplitude
                        if forward < 0.0
                        else self.hip_amplitude
                    )
                    * abs(float(forward))
                    * np.sin(leg_phase + reverse_phase)
                )
                target[leg, 2] += (
                    activity
                    * self.knee_sign[leg]
                    * self.knee_lift
                    * (
                        np.sin(
                            np.pi
                            * (
                                (cycle_fraction - self.duty_factor)
                                / (1.0 - self.duty_factor)
                            )
                        )
                        ** 2
                        if not stance
                        else 0.0
                    )
                )
            elif basis in ("lateral", "yaw"):
                target[leg] = self.inverse_kinematics(
                    leg, foot_targets[leg]
                )

        predicted_position = (
            position + self.prediction_seconds * velocity
        )
        kp = self.kp.copy()
        kd = self.kd.copy()
        target_velocity = np.zeros_like(target)
        if basis in ("lateral", "yaw"):
            kp[0] = self.kp_abduction_spatial
            kd[0] = self.kd_abduction_spatial
            if delta_seconds > 0.0:
                target_velocity = np.clip(
                    (target - self.last_joint_target) / delta_seconds,
                    -self.maximum_target_joint_speed,
                    self.maximum_target_joint_speed,
                )
        torque = (
            kp * (target - predicted_position)
            + kd * (target_velocity - velocity)
        )
        contacts = np.asarray(
            observation["foot-contact-force"], dtype=np.float64
        )
        self.last_contacts = contacts >= self.contact_threshold
        self.last_swing_legs = swing_legs
        self.last_foot_targets = foot_targets
        self.last_basis = basis
        self.last_joint_target = target.copy()
        return np.clip(
            torque.reshape(-1),
            -self.maximum_torque,
            self.maximum_torque,
        )


def create_controller(config):
    return Solo12CommandCrawlController(config)
