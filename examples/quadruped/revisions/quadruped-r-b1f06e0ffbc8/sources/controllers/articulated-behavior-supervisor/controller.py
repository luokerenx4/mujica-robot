from __future__ import annotations

from copy import deepcopy

import numpy as np

from .locomotion import BoundedTractionGaitController
from .recovery import WaistSelfRightController, orientation_state


class ArticulatedBehaviorSupervisorController:
    """Arbitrate locomotion and articulated recovery with observable hysteresis.

    The supervisor is deliberately deterministic. Recovery entry is debounced
    during ordinary motion; an episode that starts in a fallen pose enters
    recovery immediately. After a contact-qualified stand, a finite handoff
    window cross-fades recovery and locomotion Actions before locomotion gains
    sole authority. The leg Controller sees the same twelve-coordinate ABI as
    the rigid baseline while the wrapper owns the two waist coordinates.
    """

    def __init__(self, config):
        isolated = deepcopy(config)
        self.config = isolated["supervisor"]
        self.waist_config = isolated["waist"]
        self.locomotion = BoundedTractionGaitController(isolated["locomotion"])
        self.recovery = WaistSelfRightController(isolated["recovery"])
        self.base_locomotion_gait = {
            "hipAmplitude": self.locomotion.config["hipAmplitude"],
            "kneeAmplitude": self.locomotion.config["kneeAmplitude"],
        }
        self.reset(0)

    def reset(self, seed: int) -> None:
        self.seed = seed
        self.locomotion.config.update(self.base_locomotion_gait)
        self.locomotion.reset(seed)
        self.recovery.reset(seed)
        self.mode = "uninitialized"
        self.mode_started_at = 0.0
        self.fallen_streak = 0
        self.handoff_streak = 0
        self.transition_count = 0
        self.last_transition_reason = "reset"
        self.recovery_completed = False
        self.mission_command_started = False
        self.locomotion_time_origin = 0.0
        self.recovery_pose = None
        self.last_telemetry = {
            "mode": self.mode,
            "phase": self.mode,
            "transitionCount": 0,
            "transitionReason": self.last_transition_reason,
            "modeDwellSeconds": 0.0,
            "fallenStreakSteps": 0,
            "handoffStreakSteps": 0,
            "recoveryCompleted": False,
            "missionCommandStarted": False,
            "waistPositionRad": [0.0, 0.0],
            "waistTargetRad": [0.0, 0.0],
        }

    @staticmethod
    def leg_observation(observation):
        """Project the articulated plant onto the frozen twelve-leg ABI."""
        projected = dict(observation)
        joint_position = np.asarray(
            observation["joint-position"], dtype=np.float64
        )
        joint_velocity = np.asarray(
            observation["joint-velocity"], dtype=np.float64
        )
        projected["joint-position"] = np.concatenate(
            [joint_position[:6], joint_position[8:14]]
        )
        projected["joint-velocity"] = np.concatenate(
            [joint_velocity[:6], joint_velocity[8:14]]
        )
        return projected

    def locomotion_action(self, observation, time_seconds: float) -> np.ndarray:
        leg_action = self.locomotion.act(
            self.leg_observation(observation), time_seconds
        )
        joint_position = np.asarray(
            observation["joint-position"], dtype=np.float64
        )
        joint_velocity = np.asarray(
            observation["joint-velocity"], dtype=np.float64
        )
        waist_position = joint_position[6:8]
        waist_velocity = joint_velocity[6:8]
        waist_target = np.asarray(
            self.waist_config["neutralTargetRad"], dtype=np.float64
        )
        waist_action = (
            self.waist_config["kp"] * (waist_target - waist_position)
            - self.waist_config["kd"] * waist_velocity
        )
        waist_action = np.clip(
            waist_action,
            -self.waist_config["maximumAbsoluteAction"],
            self.waist_config["maximumAbsoluteAction"],
        )
        return np.concatenate([leg_action, waist_action])

    def fallen(self, observation) -> tuple[bool, float, float, str | None, int]:
        _, _, tilt, body_up_x, body_up_y = orientation_state(
            np.asarray(observation["base-orientation"], dtype=np.float64)
        )
        height = float(observation["base-height"][0])
        resting_fall = (
            tilt >= self.config["enterRecoveryTiltRad"]
            and height <= self.config["enterRecoveryLowHeightM"]
        )
        dynamic_side_fall = (
            tilt >= self.config["enterDynamicSideRecoveryMinimumTiltRad"]
            and height <= self.config["enterDynamicSideRecoveryMaximumHeightM"]
            and abs(body_up_y)
            >= self.config["enterDynamicSideRecoveryUpComponent"]
            and abs(body_up_y) >= abs(body_up_x)
        )
        dynamic_sagittal_fall = (
            tilt >= self.config["enterDynamicSagittalRecoveryMinimumTiltRad"]
            and height <= self.config["enterDynamicSagittalRecoveryMaximumHeightM"]
            and abs(body_up_x)
            >= self.config["enterDynamicSagittalRecoveryUpComponent"]
            and abs(body_up_x) > abs(body_up_y)
        )
        if dynamic_sagittal_fall:
            return (
                True,
                tilt,
                height,
                "dynamic-sagittal-fall",
                self.config["enterDynamicSagittalRecoveryStreakSteps"],
            )
        if dynamic_side_fall:
            return (
                True,
                tilt,
                height,
                "dynamic-side-fall",
                self.config["enterDynamicSideRecoveryStreakSteps"],
            )
        return (
            resting_fall,
            tilt,
            height,
            "resting-fall" if resting_fall else None,
            self.config["enterRecoveryStreakSteps"],
        )

    def switch(self, mode: str, time_seconds: float, reason: str) -> None:
        if mode == self.mode:
            return
        previous_mode = self.mode
        self.mode = mode
        self.mode_started_at = time_seconds
        self.transition_count += 1
        self.last_transition_reason = reason
        self.fallen_streak = 0
        if mode == "recovery":
            self.recovery.reset(self.seed + self.transition_count)
            self.handoff_streak = 0
        elif mode == "settling":
            self.handoff_streak = 0
            self.locomotion.reset(self.seed + self.transition_count)
            self.locomotion_time_origin = time_seconds
        elif mode == "locomotion":
            if previous_mode != "settling":
                self.locomotion.reset(self.seed + self.transition_count)
                self.locomotion_time_origin = time_seconds
            if previous_mode in ("recovery", "settling"):
                self.recovery_completed = True

    def act(self, observation, time_seconds: float):
        fallen, tilt, height, fall_detector, required_streak = self.fallen(observation)
        if self.mode == "uninitialized":
            self.switch(
                "recovery" if fallen else "locomotion",
                time_seconds,
                "initial-fallen-pose" if fallen else "initial-upright-pose",
            )
        elif self.mode in ("settling", "locomotion"):
            self.fallen_streak = self.fallen_streak + 1 if fallen else 0
            if self.fallen_streak >= required_streak:
                self.switch(
                    "recovery",
                    time_seconds,
                    f"{fall_detector or 'fallen-state'}-debounced",
                )

        if self.mode == "recovery":
            action = self.recovery.act(observation, time_seconds)
            child = self.recovery.telemetry()
            self.recovery_pose = child.get("fallenPose")
            required_target_steps = (
                self.config["minimumDynamicRecoveryTargetSteps"]
                if child.get("dynamicRecovery", False)
                else self.config["minimumRecoveryTargetSteps"]
            )
            if child["targetStreakSteps"] >= required_target_steps:
                gait = self.config["postRecoveryGaitByPose"][self.recovery_pose]
                self.locomotion.config["hipAmplitude"] = gait["hipAmplitude"]
                self.locomotion.config["kneeAmplitude"] = gait["kneeAmplitude"]
                self.switch("settling", time_seconds, "base-stand-qualified")
                child = {}
        elif self.mode == "settling":
            recovery_action = self.recovery.act(observation, time_seconds)
            locomotion_action = self.locomotion_action(
                observation,
                max(0.0, time_seconds - self.locomotion_time_origin),
            )
            elapsed = max(0.0, time_seconds - self.mode_started_at)
            blend = min(1.0, elapsed / self.config["handoffBlendSeconds"])
            action = (1.0 - blend) * recovery_action + blend * locomotion_action
            child = self.recovery.telemetry()
            if blend >= 1.0:
                self.switch("locomotion", time_seconds, "bounded-action-blend-complete")
                self.mission_command_started = (
                    float(
                        np.linalg.norm(
                            np.asarray(
                                observation["motion-command"], dtype=np.float64
                            )
                        )
                    )
                    > self.config["missionCommandDeadband"]
                )
                action = locomotion_action
                child = {}
        else:
            command_active = (
                float(
                    np.linalg.norm(
                        np.asarray(observation["motion-command"], dtype=np.float64)
                    )
                )
                > self.config["missionCommandDeadband"]
            )
            if (
                self.recovery_completed
                and command_active
                and not self.mission_command_started
            ):
                self.locomotion.reset(self.seed + self.transition_count + 1)
                self.locomotion_time_origin = time_seconds
                self.mission_command_started = True
                self.last_transition_reason = "post-recovery-command-started"
            action = self.locomotion_action(
                observation,
                max(0.0, time_seconds - self.locomotion_time_origin),
            )
            child = {}

        phase = (
            f"recovery.{child.get('phase', 'unknown')}"
            if self.mode == "recovery"
            else self.mode
        )
        locomotion_telemetry = self.locomotion.telemetry()
        self.last_telemetry = {
            "mode": self.mode,
            "phase": phase,
            "transitionCount": self.transition_count,
            "transitionReason": self.last_transition_reason,
            "modeDwellSeconds": max(0.0, time_seconds - self.mode_started_at),
            "fallenStreakSteps": self.fallen_streak,
            "handoffStreakSteps": self.handoff_streak,
            "recoveryCompleted": self.recovery_completed,
            "missionCommandStarted": self.mission_command_started,
            "recoveryPose": self.recovery_pose,
            "bodyTiltRad": tilt,
            "baseHeightM": height,
            "fallDetector": fall_detector,
            "fallenPose": child.get("fallenPose"),
            "supportFeet": child.get("supportFeet"),
            "recoveryTargetSatisfied": child.get(
                "recoveryTargetSatisfied", False
            ),
            "targetStreakSteps": child.get("targetStreakSteps", 0),
            "recoveryRetryCount": child.get("recoveryRetryCount", 0),
            "dynamicRecovery": child.get("dynamicRecovery", False),
            "locomotionStrategy": locomotion_telemetry.get("locomotionStrategy"),
            "measuredDelaySteps": locomotion_telemetry.get("measuredDelaySteps"),
            "startupRampScale": locomotion_telemetry.get("startupRampScale"),
            "startupRampActive": locomotion_telemetry.get("startupRampActive"),
            "tractionRecovery": locomotion_telemetry.get("tractionRecovery"),
            "tractionControlBlend": locomotion_telemetry.get(
                "tractionControlBlend"
            ),
            "commandMode": locomotion_telemetry.get("commandMode"),
            "commandProgressM": locomotion_telemetry.get("commandProgressM"),
            "measuredProgressM": locomotion_telemetry.get("measuredProgressM"),
            "waistPositionRad": np.asarray(
                observation["joint-position"], dtype=np.float64
            )[6:8].tolist(),
            "waistTargetRad": child.get("waistTargetRad", [0.0, 0.0]),
        }
        return action

    def telemetry(self):
        return dict(self.last_telemetry)


def create_controller(config):
    return ArticulatedBehaviorSupervisorController(config)
