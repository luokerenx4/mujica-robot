from __future__ import annotations

import numpy as np


SIDE = np.asarray([1.0, -1.0, 1.0, -1.0])
FRONT = np.asarray([1.0, 1.0, -1.0, -1.0])


def orientation_state(quaternion: np.ndarray) -> tuple[float, float, float, float, float]:
    w, x, y, z = np.asarray(quaternion, dtype=np.float64)
    roll = np.arctan2(2.0 * (w * x + y * z), 1.0 - 2.0 * (x * x + y * y))
    pitch = np.arcsin(np.clip(2.0 * (w * y - z * x), -1.0, 1.0))
    tilt = np.arccos(np.clip(1.0 - 2.0 * (x * x + y * y), -1.0, 1.0))
    body_up_x = 2.0 * (x * z + w * y)
    body_up_y = 2.0 * (y * z - w * x)
    return float(roll), float(pitch), float(tilt), float(body_up_x), float(body_up_y)


def front_rear_target(values: list[float]) -> np.ndarray:
    front_abduction, front_hip, front_knee, rear_abduction, rear_hip, rear_knee = values
    target = np.zeros((4, 3), dtype=np.float64)
    target[:, 0] = SIDE * np.asarray(
        [front_abduction, front_abduction, rear_abduction, rear_abduction]
    )
    target[:2, 1:] = [front_hip, front_knee]
    target[2:, 1:] = [rear_hip, rear_knee]
    return target


def left_right_target(values: list[float]) -> np.ndarray:
    left_abduction, left_hip, left_knee, right_abduction, right_hip, right_knee = values
    target = np.zeros((4, 3), dtype=np.float64)
    target[[0, 2]] = [left_abduction, left_hip, left_knee]
    target[[1, 3]] = [right_abduction, right_hip, right_knee]
    return target


class WaistSelfRightController:
    """Phased leg recovery with a bounded, independently testable waist action."""

    def __init__(self, config):
        self.config = config
        self.stand_target = front_rear_target(config["standTarget"])
        self.targets_by_pose = {
            "front": (
                front_rear_target(config["frontImpulseTarget"]),
                front_rear_target(config["frontCaptureTarget"]),
            ),
            "back": (
                front_rear_target(config["backImpulseTarget"]),
                front_rear_target(config["backCaptureTarget"]),
            ),
            "left": (
                left_right_target(config["leftImpulseTarget"]),
                left_right_target(config["leftCaptureTarget"]),
            ),
        }
        right_impulse = self.targets_by_pose["left"][0][[1, 0, 3, 2]].copy()
        right_capture = self.targets_by_pose["left"][1][[1, 0, 3, 2]].copy()
        right_impulse[:, 0] *= -1.0
        right_capture[:, 0] *= -1.0
        self.targets_by_pose["right"] = (right_impulse, right_capture)
        self.reset(0)

    def reset(self, seed: int) -> None:
        self.seed = seed
        self.started_at = None
        self.fallen_pose = None
        self.phase = "uninitialized"
        self.target_streak = 0
        self.last_telemetry = {
            "phase": self.phase,
            "fallenPose": None,
            "supportFeet": 0,
            "recoveryTargetSatisfied": False,
            "targetStreakSteps": 0,
            "waistTargetRad": [0.0, 0.0],
        }

    def classify_pose(self, orientation: np.ndarray) -> str:
        _, _, tilt, body_up_x, body_up_y = orientation_state(orientation)
        if tilt <= self.config["uprightTiltRad"]:
            return "upright"
        if abs(body_up_x) >= abs(body_up_y):
            return "front" if body_up_x >= 0.0 else "back"
        return "right" if body_up_y >= 0.0 else "left"

    def recovery_target_satisfied(self, observation, tilt: float) -> bool:
        velocity = np.asarray(observation["base-velocity"], dtype=np.float64)
        return (
            float(observation["base-height"][0]) >= self.config["minimumRecoveryHeightM"]
            and tilt <= self.config["maximumRecoveryTiltRad"]
            and float(np.linalg.norm(velocity[:3]))
            <= self.config["maximumRecoveryLinearSpeedMps"]
            and float(np.linalg.norm(velocity[3:6]))
            <= self.config["maximumRecoveryAngularSpeedRadPerSec"]
        )

    def stabilized_target(
        self,
        target: np.ndarray,
        roll: float,
        pitch: float,
        angular_velocity: np.ndarray,
        pose: str,
    ) -> np.ndarray:
        result = target.copy()
        feedback = self.config["feedbackByPose"][pose]
        result[:, 0] -= (
            feedback["rollGain"] * roll
            + feedback["rollRateGain"] * angular_velocity[0]
        )
        result[:, 1] += FRONT * (
            feedback["pitchGain"] * pitch
            + feedback["pitchRateGain"] * angular_velocity[1]
        )
        return result

    def targets(
        self, observation, time_seconds: float
    ) -> tuple[np.ndarray, np.ndarray, float, float]:
        orientation = np.asarray(observation["base-orientation"], dtype=np.float64)
        roll, pitch, tilt, _, _ = orientation_state(orientation)
        velocity = np.asarray(observation["base-velocity"], dtype=np.float64)
        contacts = np.asarray(observation["foot-contact-force"], dtype=np.float64)
        support_feet = int(
            np.count_nonzero(contacts >= self.config["contactThresholdNewton"])
        )

        if self.started_at is None:
            self.started_at = time_seconds
            self.fallen_pose = self.classify_pose(orientation)
        pose = self.fallen_pose
        elapsed = max(0.0, time_seconds - self.started_at)

        target_satisfied = self.recovery_target_satisfied(observation, tilt)
        qualified = target_satisfied and support_feet >= self.config["minimumSupportFeet"]
        self.target_streak = self.target_streak + 1 if qualified else 0

        if pose == "upright":
            self.phase = "stand"
            target = self.stand_target.copy()
            waist_target = np.zeros(2, dtype=np.float64)
        else:
            impulse, capture = self.targets_by_pose[pose]
            waist_impulse = np.asarray(
                self.config["waistImpulseTargetByPose"][pose], dtype=np.float64
            )
            waist_capture = np.asarray(
                self.config["waistCaptureTargetByPose"][pose], dtype=np.float64
            )
            if elapsed < self.config["impulseSeconds"]:
                self.phase = "impulse"
                target = impulse.copy()
                waist_target = waist_impulse
            elif elapsed < self.config["captureUntilSeconds"]:
                self.phase = "capture"
                target = capture.copy()
                waist_target = waist_capture
            else:
                rise_seconds = float(self.config["riseSecondsByPose"][pose])
                alpha = min(
                    1.0,
                    (elapsed - self.config["captureUntilSeconds"]) / rise_seconds,
                )
                self.phase = (
                    "stand"
                    if alpha >= 1.0
                    and support_feet >= self.config["minimumSupportFeet"]
                    else "rise"
                )
                target = (1.0 - alpha) * capture + alpha * self.stand_target
                target = self.stabilized_target(
                    target, roll, pitch, velocity[3:6], pose
                )
                waist_target = (1.0 - alpha) * waist_capture

        maximum_abduction = self.config[
            "maximumAbsoluteAbductionTargetRadByPose"
        ].get(pose, self.config["maximumAbsoluteAbductionTargetRad"])
        target[:, 0] = np.clip(target[:, 0], -maximum_abduction, maximum_abduction)
        target[:, 1] = np.clip(
            target[:, 1],
            -self.config["maximumAbsoluteHipTargetRad"],
            self.config["maximumAbsoluteHipTargetRad"],
        )
        target[:, 2] = np.clip(
            target[:, 2],
            self.config["minimumKneeTargetRad"],
            self.config["maximumKneeTargetRad"],
        )
        waist_target = np.clip(
            waist_target,
            -self.config["maximumWaistTargetRad"],
            self.config["maximumWaistTargetRad"],
        )
        self.last_telemetry = {
            "phase": self.phase,
            "fallenPose": pose,
            "supportFeet": support_feet,
            "recoveryTargetSatisfied": target_satisfied,
            "targetStreakSteps": self.target_streak,
            "waistTargetRad": waist_target.tolist(),
        }
        abduction_damping = self.config["kdAbductionByPose"].get(
            pose, self.config["kdAbduction"]
        )
        return target, waist_target, abduction_damping, self.config["kdSagittal"]

    def act(self, observation, time_seconds: float):
        raw_q = np.asarray(observation["joint-position"], dtype=np.float64)
        raw_qd = np.asarray(observation["joint-velocity"], dtype=np.float64)
        q = np.concatenate([raw_q[:6], raw_q[8:14]]).reshape(4, 3)
        qd = np.concatenate([raw_qd[:6], raw_qd[8:14]]).reshape(4, 3)
        waist_q = raw_q[6:8]
        waist_qd = raw_qd[6:8]
        target, waist_target, abduction_damping, sagittal_damping = self.targets(
            observation, time_seconds
        )
        leg_action = np.empty((4, 3), dtype=np.float64)
        leg_action[:, 0] = (
            self.config["kpAbduction"] * (target[:, 0] - q[:, 0])
            - abduction_damping * qd[:, 0]
        )
        leg_action[:, 1:] = (
            self.config["kpSagittal"] * (target[:, 1:] - q[:, 1:])
            - sagittal_damping * qd[:, 1:]
        )
        waist_action = (
            self.config["kpWaist"] * (waist_target - waist_q)
            - self.config["kdWaist"] * waist_qd
        )
        return np.clip(
            np.concatenate([leg_action.reshape(-1), waist_action]),
            -8.0,
            8.0,
        )

    def telemetry(self):
        return dict(self.last_telemetry)


def create_controller(config):
    return WaistSelfRightController(config)
