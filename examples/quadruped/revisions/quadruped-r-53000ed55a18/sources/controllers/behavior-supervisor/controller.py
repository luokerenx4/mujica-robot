from __future__ import annotations

import numpy as np

from .locomotion import BoundedTractionGaitController
from .recovery import PhasedSelfRightController, orientation_state


class BehaviorSupervisorController:
    """Arbitrate locomotion and recovery with observable hysteresis.

    The supervisor is deliberately deterministic. Recovery entry is debounced
    during ordinary motion; an episode that starts in a fallen pose enters
    recovery immediately. After a contact-qualified stand, a finite handoff
    window cross-fades recovery and locomotion Actions before locomotion gains
    sole authority.
    """

    def __init__(self, config):
        self.config = config["supervisor"]
        self.locomotion = BoundedTractionGaitController(config["locomotion"])
        self.recovery = PhasedSelfRightController(config["recovery"])
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
        }

    def fallen(self, observation) -> tuple[bool, float, float]:
        _, _, tilt, _, _ = orientation_state(
            np.asarray(observation["base-orientation"], dtype=np.float64)
        )
        height = float(observation["base-height"][0])
        return (
            tilt >= self.config["enterRecoveryTiltRad"]
            and height <= self.config["enterRecoveryLowHeightM"],
            tilt,
            height,
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
        fallen, tilt, height = self.fallen(observation)
        if self.mode == "uninitialized":
            self.switch(
                "recovery" if fallen else "locomotion",
                time_seconds,
                "initial-fallen-pose" if fallen else "initial-upright-pose",
            )
        elif self.mode in ("settling", "locomotion"):
            self.fallen_streak = self.fallen_streak + 1 if fallen else 0
            if self.fallen_streak >= self.config["enterRecoveryStreakSteps"]:
                self.switch("recovery", time_seconds, "fallen-state-debounced")

        if self.mode == "recovery":
            action = self.recovery.act(observation, time_seconds)
            child = self.recovery.telemetry()
            self.recovery_pose = child.get("fallenPose")
            if child["targetStreakSteps"] >= self.config["minimumRecoveryTargetSteps"]:
                gait = self.config["postRecoveryGaitByPose"][self.recovery_pose]
                self.locomotion.config["hipAmplitude"] = gait["hipAmplitude"]
                self.locomotion.config["kneeAmplitude"] = gait["kneeAmplitude"]
                self.switch("settling", time_seconds, "base-stand-qualified")
                child = {}
        elif self.mode == "settling":
            recovery_action = self.recovery.act(observation, time_seconds)
            locomotion_action = self.locomotion.act(
                observation, max(0.0, time_seconds - self.locomotion_time_origin)
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
            action = self.locomotion.act(
                observation, max(0.0, time_seconds - self.locomotion_time_origin)
            )
            child = {}

        phase = (
            f"recovery.{child.get('phase', 'unknown')}"
            if self.mode == "recovery"
            else self.mode
        )
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
            "fallenPose": child.get("fallenPose"),
            "supportFeet": child.get("supportFeet"),
            "recoveryTargetSatisfied": child.get(
                "recoveryTargetSatisfied", False
            ),
            "targetStreakSteps": child.get("targetStreakSteps", 0),
        }
        return action

    def telemetry(self):
        return dict(self.last_telemetry)


def create_controller(config):
    return BehaviorSupervisorController(config)
