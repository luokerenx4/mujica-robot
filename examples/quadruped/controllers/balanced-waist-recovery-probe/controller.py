from __future__ import annotations

import numpy as np


SIDE = np.asarray([1.0, -1.0, 1.0, -1.0])
FRONT = np.asarray([1.0, 1.0, -1.0, -1.0])


def orientation_state(
    quaternion: np.ndarray,
) -> tuple[float, float, float, float, float]:
    w, x, y, z = np.asarray(quaternion, dtype=np.float64)
    roll = np.arctan2(
        2.0 * (w * x + y * z),
        1.0 - 2.0 * (x * x + y * y),
    )
    pitch = np.arcsin(np.clip(2.0 * (w * y - z * x), -1.0, 1.0))
    tilt = np.arccos(np.clip(1.0 - 2.0 * (x * x + y * y), -1.0, 1.0))
    body_up_x = 2.0 * (x * z + w * y)
    body_up_y = 2.0 * (y * z - w * x)
    return (
        float(roll),
        float(pitch),
        float(tilt),
        float(body_up_x),
        float(body_up_y),
    )


def front_rear(values: list[float]) -> np.ndarray:
    front_abduction, front_hip, front_knee, rear_abduction, rear_hip, rear_knee = values
    target = np.zeros((4, 3), dtype=np.float64)
    target[:, 0] = SIDE * np.asarray(
        [front_abduction, front_abduction, rear_abduction, rear_abduction]
    )
    target[:2, 1:] = [front_hip, front_knee]
    target[2:, 1:] = [rear_hip, rear_knee]
    return target


def left_right(values: list[float]) -> np.ndarray:
    left_abduction, left_hip, left_knee, right_abduction, right_hip, right_knee = values
    target = np.zeros((4, 3), dtype=np.float64)
    target[[0, 2]] = [left_abduction, left_hip, left_knee]
    target[[1, 3]] = [right_abduction, right_hip, right_knee]
    return target


def mirrored_right(target: np.ndarray) -> np.ndarray:
    result = target[[1, 0, 3, 2]].copy()
    result[:, 0] *= -1.0
    return result


class BalancedWaistRecoveryProbe:
    """Small deterministic probe: brace, optionally plant, then rise."""

    def __init__(self, config):
        self.config = config
        left_impulse = left_right(config["leftImpulseTarget"])
        left_capture = left_right(config["leftCaptureTarget"])
        self.impulse = {
            "front": front_rear(config["frontImpulseTarget"]),
            "back": front_rear(config["backImpulseTarget"]),
            "left": left_impulse,
            "right": mirrored_right(left_impulse),
        }
        self.capture = {
            "front": front_rear(config["frontCaptureTarget"]),
            "back": front_rear(config["backCaptureTarget"]),
            "left": left_capture,
            "right": mirrored_right(left_capture),
        }
        self.plant = {
            pose: (
                front_rear(values)
                if pose in ("front", "back")
                else left_right(values)
            )
            for pose, values in config["plantTargetByPose"].items()
        }
        self.tip = {
            pose: (
                front_rear(values)
                if pose in ("front", "back")
                else left_right(values)
            )
            for pose, values in config.get("tipTargetByPose", {}).items()
        }
        self.stand = front_rear(config["standTarget"])
        self.reset(0)

    def reset(self, seed: int) -> None:
        self.seed = seed
        self.started_at = None
        self.pose = None
        self.plant_started_at = None
        self.tip_started_at = None
        self.rise_started_at = None
        self.phase = "uninitialized"
        self.last_telemetry = {
            "phase": self.phase,
            "fallenPose": None,
            "supportFeet": 0,
            "plantTriggered": False,
            "tipTriggered": False,
            "recoveryTargetSatisfied": False,
        }

    def classify(self, orientation: np.ndarray) -> str:
        _, _, tilt, body_up_x, body_up_y = orientation_state(orientation)
        if tilt <= self.config["uprightTiltRad"]:
            return "upright"
        if abs(body_up_x) >= abs(body_up_y):
            return "front" if body_up_x >= 0.0 else "back"
        return "right" if body_up_y >= 0.0 else "left"

    def recovery_target_satisfied(self, observation, tilt: float) -> bool:
        velocity = np.asarray(observation["base-velocity"], dtype=np.float64)
        return (
            float(observation["base-height"][0])
            >= self.config["minimumRecoveryHeightM"]
            and tilt <= self.config["maximumRecoveryTiltRad"]
            and float(np.linalg.norm(velocity[:3]))
            <= self.config["maximumRecoveryLinearSpeedMps"]
            and float(np.linalg.norm(velocity[3:6]))
            <= self.config["maximumRecoveryAngularSpeedRadPerSec"]
        )

    def targets(
        self,
        observation,
        time_seconds: float,
    ) -> tuple[np.ndarray, np.ndarray]:
        orientation = np.asarray(observation["base-orientation"], dtype=np.float64)
        roll, pitch, tilt, _, _ = orientation_state(orientation)
        velocity = np.asarray(observation["base-velocity"], dtype=np.float64)
        contacts = np.asarray(observation["foot-contact-force"], dtype=np.float64)
        support_feet = int(np.count_nonzero(
            contacts >= self.config["contactThresholdNewton"]
        ))
        if self.started_at is None:
            self.started_at = time_seconds
            self.pose = self.classify(orientation)
        pose = self.pose
        elapsed = max(0.0, time_seconds - self.started_at)

        if pose == "upright":
            self.phase = "stand"
            target = self.stand
            waist = np.zeros(2)
        elif elapsed < self.config["impulseSecondsByPose"][pose]:
            self.phase = "impulse"
            target = self.impulse[pose]
            waist = np.asarray(
                self.config["waistImpulseTargetByPose"][pose],
                dtype=np.float64,
            )
        elif elapsed < self.config["captureUntilSecondsByPose"][pose]:
            self.phase = "capture"
            target = self.capture[pose]
            waist = np.asarray(
                self.config["waistCaptureTargetByPose"][pose],
                dtype=np.float64,
            )
        else:
            trigger = self.config["plantTriggerTiltRadByPose"][pose]
            if (
                trigger > 0
                and self.plant_started_at is None
                and tilt <= trigger
            ):
                self.plant_started_at = time_seconds
            if self.plant_started_at is not None and self.rise_started_at is None:
                planted_for = time_seconds - self.plant_started_at
                minimum_plant_seconds = self.config.get(
                    "plantMinimumSecondsByPose",
                    {},
                ).get(pose, self.config["plantMinimumSeconds"])
                maximum_plant_seconds = self.config.get(
                    "plantMaximumSecondsByPose",
                    {},
                ).get(pose, self.config["plantMaximumSeconds"])
                ready = (
                    planted_for >= minimum_plant_seconds
                    and support_feet >= self.config["plantMinimumSupportFeet"]
                )
                timed_out = planted_for >= maximum_plant_seconds
                if ready or timed_out:
                    if pose in self.tip and self.tip_started_at is None:
                        self.tip_started_at = time_seconds
                    elif pose not in self.tip:
                        self.rise_started_at = time_seconds
                else:
                    self.phase = "plant"
                    target = self.plant[pose]
                    waist = np.asarray(
                        self.config["plantWaistTargetByPose"][pose],
                        dtype=np.float64,
                    )
            if self.plant_started_at is None:
                self.rise_started_at = (
                    self.rise_started_at
                    if self.rise_started_at is not None
                    else self.started_at
                    + self.config["captureUntilSecondsByPose"][pose]
                )
            if self.tip_started_at is not None and self.rise_started_at is None:
                tip_for = time_seconds - self.tip_started_at
                tip_complete = (
                    tilt <= self.config["tipExitTiltRadByPose"][pose]
                    or tip_for >= self.config["tipMaximumSecondsByPose"][pose]
                )
                if tip_complete:
                    self.rise_started_at = time_seconds
                else:
                    self.phase = "tip"
                    target = self.tip[pose]
                    waist = np.asarray(
                        self.config["tipWaistTargetByPose"][pose],
                        dtype=np.float64,
                    )
            if self.rise_started_at is not None:
                alpha = min(
                    1.0,
                    max(0.0, time_seconds - self.rise_started_at)
                    / self.config["riseSecondsByPose"][pose],
                )
                self.phase = "stand" if alpha >= 1.0 else "rise"
                origin = (
                    self.tip[pose]
                    if self.tip_started_at is not None
                    else self.plant[pose]
                    if self.plant_started_at is not None
                    else self.capture[pose]
                )
                target = (1.0 - alpha) * origin + alpha * self.stand
                feedback = self.config["feedbackByPose"][pose]
                feedback_scale = 1.0 - alpha
                target[:, 0] -= feedback_scale * (
                    feedback["rollGain"] * roll
                    + feedback["rollRateGain"] * velocity[3]
                )
                target[:, 1] += feedback_scale * FRONT * (
                    feedback["pitchGain"] * pitch
                    + feedback["pitchRateGain"] * velocity[4]
                )
                waist = (
                    1.0 - alpha
                ) * np.asarray(
                    self.config["plantWaistTargetByPose"][pose]
                    if self.plant_started_at is not None
                    else self.config["waistCaptureTargetByPose"][pose],
                    dtype=np.float64,
                )

        target = np.asarray(target, dtype=np.float64).copy()
        maximum_abduction = self.config[
            "maximumAbsoluteAbductionTargetRadByPose"
        ].get(pose, self.config["maximumAbsoluteAbductionTargetRad"])
        target[:, 0] = np.clip(
            target[:, 0],
            -maximum_abduction,
            maximum_abduction,
        )
        target[:, 1] = np.clip(
            target[:, 1],
            -self.config["maximumAbsoluteHipTargetRad"],
            self.config["maximumAbsoluteHipTargetRad"],
        )
        maximum_knee = self.config["maximumKneeTargetRadByPose"].get(
            pose,
            self.config["maximumKneeTargetRad"],
        )
        target[:, 2] = np.clip(
            target[:, 2],
            self.config["minimumKneeTargetRad"],
            maximum_knee,
        )
        waist = np.clip(
            waist,
            -self.config["maximumWaistTargetRad"],
            self.config["maximumWaistTargetRad"],
        )
        self.last_telemetry = {
            "phase": self.phase,
            "fallenPose": pose,
            "supportFeet": support_feet,
            "plantTriggered": self.plant_started_at is not None,
            "tipTriggered": self.tip_started_at is not None,
            "recoveryTargetSatisfied": self.recovery_target_satisfied(
                observation,
                tilt,
            ),
        }
        return target, waist

    def act(self, observation, time_seconds: float):
        raw_q = np.asarray(observation["joint-position"], dtype=np.float64)
        raw_qd = np.asarray(observation["joint-velocity"], dtype=np.float64)
        q = np.concatenate([raw_q[:6], raw_q[8:14]]).reshape(4, 3)
        qd = np.concatenate([raw_qd[:6], raw_qd[8:14]]).reshape(4, 3)
        target, waist_target = self.targets(observation, time_seconds)
        action = np.empty((4, 3), dtype=np.float64)
        action[:, 0] = (
            self.config["kpAbduction"] * (target[:, 0] - q[:, 0])
            - self.config["kdAbductionByPose"].get(
                self.pose,
                self.config["kdAbduction"],
            ) * qd[:, 0]
        )
        action[:, 1:] = (
            self.config["kpSagittal"] * (target[:, 1:] - q[:, 1:])
            - self.config["kdSagittal"] * qd[:, 1:]
        )
        waist_action = (
            self.config["kpWaist"] * (waist_target - raw_q[6:8])
            - self.config["kdWaist"] * raw_qd[6:8]
        )
        return np.clip(
            np.concatenate([action.reshape(-1), waist_action]),
            -8.0,
            8.0,
        )

    def telemetry(self):
        return dict(self.last_telemetry)


def create_controller(config):
    return BalancedWaistRecoveryProbe(config)
