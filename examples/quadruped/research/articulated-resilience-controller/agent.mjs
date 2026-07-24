import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const request = JSON.parse(await new Response(Bun.stdin.stream()).text());
if (request.lab?.id !== "articulated-resilience-controller") {
  throw new Error(
    "This bounded researcher only accepts the articulated-resilience-controller Lab",
  );
}

const triedStrategies = new Set(
  (Array.isArray(request.history) ? request.history : [])
    .map((entry) => entry?.proposal?.strategy)
    .filter((value) => typeof value === "string"),
);

const locomotionPath = resolve(
  request.workspace,
  "controllers/articulated-behavior-supervisor/locomotion.py",
);
const supervisorPath = resolve(
  request.workspace,
  "controllers/articulated-behavior-supervisor/controller.py",
);
const recoveryPath = resolve(
  request.workspace,
  "controllers/articulated-behavior-supervisor/recovery.py",
);
const definitionPath = resolve(
  request.workspace,
  "controllers/articulated-behavior-supervisor/controller.json",
);
let locomotion = await readFile(locomotionPath, "utf8");
let supervisor = await readFile(supervisorPath, "utf8");
let recovery = await readFile(recoveryPath, "utf8");
const definition = JSON.parse(await readFile(definitionPath, "utf8"));

function replaceExact(source, before, after, label, expected = 1) {
  const occurrences = source.split(before).length - 1;
  if (occurrences !== expected) {
    throw new Error(
      `${label} expected ${expected} source match(es), found ${occurrences}`,
    );
  }
  return source.split(before).join(after);
}

function installMeasuredPhaseAndSupportFeedback(config) {
  Object.assign(definition.config.locomotion, config);

  locomotion = replaceExact(
    locomotion,
    `        self.traction_control_blend = 0.0
        self.command_restart_count = 0
`,
    `        self.traction_control_blend = 0.0
        self.progress_phase = None
        self.progress_phase_last_time = None
        self.progress_phase_rate_scale = 1.0
        self.progress_phase_deficit_m = 0.0
        self.impact_brace_blend = 0.0
        self.support_phase_shift_rad = 0.0
        self.command_restart_count = 0
`,
    "adaptive phase reset state",
  );
  locomotion = replaceExact(
    locomotion,
    `            "tractionControlBlend": 0.0,
            "commandMode": None,
`,
    `            "tractionControlBlend": 0.0,
            "progressPhaseRateScale": 1.0,
            "progressPhaseDeficitM": 0.0,
            "impactBraceBlend": 0.0,
            "supportPhaseShiftRad": 0.0,
            "commandMode": None,
`,
    "initial adaptive phase telemetry",
  );
  locomotion = replaceExact(
    locomotion,
    `            self.traction_recovery_severe = False
            self.traction_recovery_started_at = None
            if np.linalg.norm(raw) > self.config["commandDeadband"]`,
    `            self.traction_recovery_severe = False
            self.traction_recovery_started_at = None
            self.progress_phase = None
            self.progress_phase_last_time = None
            self.progress_phase_rate_scale = 1.0
            self.progress_phase_deficit_m = 0.0
            self.impact_brace_blend = 0.0
            self.support_phase_shift_rad = 0.0
            if np.linalg.norm(raw) > self.config["commandDeadband"]`,
    "observable command-boundary reset",
  );
  locomotion = replaceExact(
    locomotion,
    `        phase_lead = self.config["phaseLeadByDelaySteps"][delay]
        if delay > 0 and abs(roll_rate) > self.config["disturbanceRollRateThreshold"]: phase_lead = self.config["disturbancePhaseLeadSeconds"]
        phase = 2.0 * np.pi * self.config["frequencyHz"] * (time_seconds + phase_lead)
        ramp_seconds = float(self.config["startupRampSecondsByDelaySteps"][delay])
`,
    `        phase_lead = self.config["phaseLeadByDelaySteps"][delay]
        if delay > 0 and abs(roll_rate) > self.config["disturbanceRollRateThreshold"]: phase_lead = self.config["disturbancePhaseLeadSeconds"]
        base_frequency = 2.0 * np.pi * self.config["frequencyHz"]
        self.progress_phase_deficit_m = max(
            0.0,
            self.traction_command_progress - self.traction_measured_progress,
        )
        low_delay = 0 < delay < self.config["delayedTractionMinimumDelaySteps"]
        deficit_span = max(
            1e-9,
            self.config["progressPhaseDeficitFullM"]
            - self.config["progressPhaseDeficitStartM"],
        )
        progress_blend = (
            float(
                np.clip(
                    (
                        self.progress_phase_deficit_m
                        - self.config["progressPhaseDeficitStartM"]
                    )
                    / deficit_span,
                    0.0,
                    1.0,
                )
            )
            if low_delay
            else 0.0
        )
        target_rate_scale = 1.0 + progress_blend * (
            self.config["progressPhaseMinimumRateScale"] - 1.0
        )
        if self.progress_phase_last_time is None:
            phase_dt = 0.0
            self.progress_phase = base_frequency * time_seconds
        else:
            phase_dt = max(0.0, time_seconds - self.progress_phase_last_time)
        response_seconds = max(
            1e-6, self.config["progressPhaseResponseSeconds"]
        )
        response = 1.0 - np.exp(-phase_dt / response_seconds)
        self.progress_phase_rate_scale += response * (
            target_rate_scale - self.progress_phase_rate_scale
        )
        self.progress_phase += (
            base_frequency * self.progress_phase_rate_scale * phase_dt
        )
        self.progress_phase_last_time = time_seconds
        phase = self.progress_phase + base_frequency * phase_lead
        raw_contacts = np.asarray(
            observation["foot-contact-force"], dtype=np.float64
        )
        left_contact = 0.5 * float(raw_contacts[0] + raw_contacts[2])
        right_contact = 0.5 * float(raw_contacts[1] + raw_contacts[3])
        contact_bias = np.tanh(
            (left_contact - right_contact)
            / max(1e-6, self.config["impactBraceContactScaleN"])
        )
        roll_bias = np.tanh(
            roll_rate / max(1e-6, self.config["impactBraceRollRateScale"])
        )
        roll_excess = max(
            0.0,
            abs(roll_rate) - self.config["impactBraceRollRateThreshold"],
        )
        self.impact_brace_blend = (
            float(
                np.clip(
                    roll_excess
                    / max(1e-6, self.config["impactBraceRollRateRange"]),
                    0.0,
                    1.0,
                )
            )
            if low_delay
            else 0.0
        )
        support_direction = float(
            np.clip(0.65 * roll_bias + 0.35 * contact_bias, -1.0, 1.0)
        )
        self.support_phase_shift_rad = (
            self.impact_brace_blend
            * self.config["impactBraceMaximumPhaseShiftRad"]
            * support_direction
        )
        ramp_seconds = float(self.config["startupRampSecondsByDelaySteps"][delay])
`,
    "continuous measured phase controller",
  );
  locomotion = replaceExact(
    locomotion,
    `        offsets = np.array([0.0, 0.0, self.config["frontRearPhase"], self.config["frontRearPhase"]]); side = np.array([1.0, -1.0, 1.0, -1.0])
`,
    `        side = np.array([1.0, -1.0, 1.0, -1.0])
        offsets = (
            np.array(
                [0.0, 0.0, self.config["frontRearPhase"], self.config["frontRearPhase"]]
            )
            + self.support_phase_shift_rad * side
        )
        gait_scale *= (
            1.0
            - self.impact_brace_blend
            * self.config["impactBraceHipAttenuation"]
        )
`,
    "support-side phase and gait blend",
  );
  locomotion = replaceExact(
    locomotion,
    `            target[leg, 0] = side[leg] * self.config["neutralAbduction"] - correction
`,
    `            target[leg, 0] = side[leg] * (
                self.config["neutralAbduction"]
                + self.impact_brace_blend
                * self.config["impactBraceAbductionWidthRad"]
            ) - correction
`,
    "continuous support-width brace",
  );
  locomotion = replaceExact(
    locomotion,
    `            "tractionControlBlend": self.traction_control_blend,
            "commandMode": self.motion_mode,
`,
    `            "tractionControlBlend": self.traction_control_blend,
            "progressPhaseRateScale": self.progress_phase_rate_scale,
            "progressPhaseDeficitM": self.progress_phase_deficit_m,
            "impactBraceBlend": self.impact_brace_blend,
            "supportPhaseShiftRad": self.support_phase_shift_rad,
            "commandMode": self.motion_mode,
`,
    "live adaptive phase telemetry",
    2,
  );

  supervisor = replaceExact(
    supervisor,
    `            "tractionControlBlend": locomotion_telemetry.get(
                "tractionControlBlend"
            ),
            "commandMode": locomotion_telemetry.get("commandMode"),
`,
    `            "tractionControlBlend": locomotion_telemetry.get(
                "tractionControlBlend"
            ),
            "progressPhaseRateScale": locomotion_telemetry.get(
                "progressPhaseRateScale"
            ),
            "progressPhaseDeficitM": locomotion_telemetry.get(
                "progressPhaseDeficitM"
            ),
            "impactBraceBlend": locomotion_telemetry.get("impactBraceBlend"),
            "supportPhaseShiftRad": locomotion_telemetry.get(
                "supportPhaseShiftRad"
            ),
            "commandMode": locomotion_telemetry.get("commandMode"),
`,
    "supervisor adaptive phase telemetry",
  );
}

function installDisturbanceConditionedRecoveryEntry(config) {
  Object.assign(definition.config.supervisor, config);

  supervisor = replaceExact(
    supervisor,
    `        self.mission_command_started = False
        self.locomotion_time_origin = 0.0
`,
    `        self.mission_command_started = False
        self.previous_command_active = False
        self.disturbance_stop_count = 0
        self.locomotion_time_origin = 0.0
`,
    "disturbance entry reset state",
  );
  supervisor = replaceExact(
    supervisor,
    `            "missionCommandStarted": False,
            "waistPositionRad": [0.0, 0.0],
`,
    `            "missionCommandStarted": False,
            "disturbanceStopDetected": False,
            "disturbanceStopCount": 0,
            "waistPositionRad": [0.0, 0.0],
`,
    "initial disturbance entry telemetry",
  );
  supervisor = replaceExact(
    supervisor,
    `    def act(self, observation, time_seconds: float):
        fallen, tilt, height, fall_detector, required_streak = self.fallen(observation)
        if self.mode == "uninitialized":
`,
    `    def act(self, observation, time_seconds: float):
        fallen, tilt, height, fall_detector, required_streak = self.fallen(observation)
        command_active = (
            float(
                np.linalg.norm(
                    np.asarray(observation["motion-command"], dtype=np.float64)
                )
            )
            > self.config["disturbanceRecoveryCommandDeadband"]
        )
        angular_speed = float(
            np.linalg.norm(
                np.asarray(
                    observation["imu-angular-velocity"], dtype=np.float64
                )
            )
        )
        disturbance_stop = (
            self.previous_command_active
            and not command_active
            and height <= self.config["disturbanceRecoveryMaximumHeightM"]
            and tilt >= self.config["disturbanceRecoveryMinimumTiltRad"]
            and angular_speed
            >= self.config["disturbanceRecoveryMinimumAngularSpeedRadPerSec"]
        )
        self.previous_command_active = command_active
        if disturbance_stop:
            self.disturbance_stop_count += 1
        if self.mode == "uninitialized":
`,
    "measured disturbance-stop classifier",
  );
  supervisor = replaceExact(
    supervisor,
    `        elif self.mode in ("settling", "locomotion"):
            self.fallen_streak = self.fallen_streak + 1 if fallen else 0
            if self.fallen_streak >= required_streak:
                self.switch(
                    "recovery",
                    time_seconds,
                    f"{fall_detector or 'fallen-state'}-debounced",
                )
`,
    `        elif self.mode in ("settling", "locomotion"):
            if disturbance_stop:
                self.switch(
                    "recovery",
                    time_seconds,
                    "disturbance-conditioned-command-stop",
                )
            else:
                self.fallen_streak = self.fallen_streak + 1 if fallen else 0
                if self.fallen_streak >= required_streak:
                    self.switch(
                        "recovery",
                        time_seconds,
                        f"{fall_detector or 'fallen-state'}-debounced",
                    )
`,
    "early recovery arbitration",
  );
  supervisor = replaceExact(
    supervisor,
    `            "missionCommandStarted": self.mission_command_started,
            "recoveryPose": self.recovery_pose,
`,
    `            "missionCommandStarted": self.mission_command_started,
            "disturbanceStopDetected": disturbance_stop,
            "disturbanceStopCount": self.disturbance_stop_count,
            "recoveryPose": self.recovery_pose,
`,
    "live disturbance entry telemetry",
  );
}

function installMomentumDirectedRecoveryEntry(supervisorConfig, recoveryConfig) {
  installDisturbanceConditionedRecoveryEntry(supervisorConfig);
  Object.assign(definition.config.recovery, recoveryConfig);

  recovery = replaceExact(
    recovery,
    `        self.dynamic_entry = False
        self.feedback_hold = False
`,
    `        self.dynamic_entry = False
        self.entry_pose_source = "uninitialized"
        self.feedback_hold = False
`,
    "dynamic entry pose-source reset",
  );
  recovery = replaceExact(
    recovery,
    `            "dynamicRecovery": False,
            "waistTargetRad": [0.0, 0.0],
`,
    `            "dynamicRecovery": False,
            "entryPoseSource": self.entry_pose_source,
            "waistTargetRad": [0.0, 0.0],
`,
    "initial dynamic entry pose telemetry",
  );
  recovery = replaceExact(
    recovery,
    `        if self.started_at is None:
            self.started_at = time_seconds
            self.fallen_pose = self.classify_pose(orientation)
            self.dynamic_entry = (
                float(np.linalg.norm(velocity[3:6]))
                >= self.config["dynamicEntryAngularSpeedThresholdRadPerSec"]
            )
`,
    `        if self.started_at is None:
            self.started_at = time_seconds
            orientation_pose = self.classify_pose(orientation)
            self.dynamic_entry = (
                float(np.linalg.norm(velocity[3:6]))
                >= self.config["dynamicEntryAngularSpeedThresholdRadPerSec"]
            )
            roll_rate = float(velocity[3])
            pitch_rate = float(velocity[4])
            lateral_momentum_dominant = (
                self.dynamic_entry
                and abs(roll_rate)
                >= self.config[
                    "dynamicEntryLateralAngularSpeedThresholdRadPerSec"
                ]
                and abs(roll_rate)
                >= self.config["dynamicEntryLateralDominanceRatio"]
                * abs(pitch_rate)
            )
            if lateral_momentum_dominant:
                self.fallen_pose = "left" if roll_rate < 0.0 else "right"
                self.entry_pose_source = "roll-rate"
            else:
                self.fallen_pose = orientation_pose
                self.entry_pose_source = "orientation"
`,
    "momentum-directed recovery pose classification",
  );
  recovery = replaceExact(
    recovery,
    `            "dynamicRecovery": self.dynamic_entry,
            "waistTargetRad": waist_target.tolist(),
`,
    `            "dynamicRecovery": self.dynamic_entry,
            "entryPoseSource": self.entry_pose_source,
            "waistTargetRad": waist_target.tolist(),
`,
    "live dynamic entry pose telemetry",
  );
  supervisor = replaceExact(
    supervisor,
    `            "dynamicRecovery": child.get("dynamicRecovery", False),
            "locomotionStrategy": locomotion_telemetry.get("locomotionStrategy"),
`,
    `            "dynamicRecovery": child.get("dynamicRecovery", False),
            "entryPoseSource": child.get("entryPoseSource"),
            "locomotionStrategy": locomotion_telemetry.get("locomotionStrategy"),
`,
    "supervisor dynamic entry pose telemetry",
  );
}

const common = {
  progressPhaseDeficitStartM: 0.08,
  progressPhaseDeficitFullM: 0.42,
  progressPhaseResponseSeconds: 0.18,
  impactBraceRollRateThreshold: 1.6,
  impactBraceRollRateRange: 1.6,
  impactBraceContactScaleN: 30,
  impactBraceRollRateScale: 2,
};

const strategies = [
  {
    strategy: "continuous-progress-phase-retardation",
    hypothesis:
      "Both delayed degraded Missions move backward before impact. Integrating gait phase from the observable signed progress deficit, and continuously slowing it toward 0.35 rate instead of latching a direction, should reduce that backward entry state without selecting an impact side or discontinuously jumping phase.",
    expectedEffect:
      "Improve pre-impact signed progress in both degraded Cases while preserving exact Cases and introducing no collision, joint-limit, command, or recovery regression.",
    kind: "phase",
    config: {
      ...common,
      progressPhaseMinimumRateScale: 0.35,
      impactBraceMaximumPhaseShiftRad: 0,
      impactBraceHipAttenuation: 0,
      impactBraceAbductionWidthRad: 0,
    },
  },
  {
    strategy: "continuous-progress-phase-reversal",
    hypothesis:
      "The prior hard reversal found useful forward authority but exchanged left and right recovery. A filtered phase-rate state that crosses zero only as measured progress deficit accumulates should retain that authority without the one-step phase discontinuity that made impact timing side-sensitive.",
    expectedEffect:
      "Recover positive delayed approach progress and avoid exchanging the degraded left and right self-righting outcomes.",
    kind: "phase",
    config: {
      ...common,
      progressPhaseMinimumRateScale: -0.35,
      impactBraceMaximumPhaseShiftRad: 0,
      impactBraceHipAttenuation: 0,
      impactBraceAbductionWidthRad: 0,
    },
  },
  {
    strategy: "continuous-progress-support-side-impact-brace",
    hypothesis:
      "Progress adaptation alone cannot account for which feet carry the observed lateral impulse. Combining a mild continuous phase reversal with a bounded roll/contact-driven left-right phase differential, temporary stride attenuation, and symmetric abduction widening should preserve support on either impact side without reading Scenario identity.",
    expectedEffect:
      "Make both degraded Cases enter recovery from a less severe state, eliminate the left/right failure exchange, and preserve downstream resume, redirect, traverse, and stop gates.",
    kind: "phase",
    config: {
      ...common,
      progressPhaseMinimumRateScale: -0.15,
      impactBraceMaximumPhaseShiftRad: 0.32,
      impactBraceHipAttenuation: 0.45,
      impactBraceAbductionWidthRad: 0.045,
    },
  },
  {
    strategy: "disturbance-conditioned-zero-command-recovery-entry",
    hypothesis:
      "All delayed candidates reach the authored zero-command recovery edge while the body is already low and rotating rapidly, yet the Supervisor waits until a much larger tilt threshold 1–4 seconds later. The observable active-to-zero command edge, combined with measured height, tilt, and angular speed, should hand authority to articulated recovery before impact momentum becomes a resting fall.",
    expectedEffect:
      "Enter dynamic recovery immediately after both degraded impacts, satisfy recovery before its timeout, and leave ordinary stop transitions unchanged because they lack the low-height high-angular-speed conjunction.",
    kind: "early-recovery",
    config: {
      disturbanceRecoveryCommandDeadband: 0.02,
      disturbanceRecoveryMaximumHeightM: 0.38,
      disturbanceRecoveryMinimumTiltRad: 0.25,
      disturbanceRecoveryMinimumAngularSpeedRadPerSec: 2.2,
    },
  },
  {
    strategy: "momentum-directed-side-recovery-entry",
    hypothesis:
      "Early recovery reduced aggregate violation count, but both lateral impacts entered the recovery program as a static back fall and discovered their true side only on a late retry. At a dynamic entry, measured roll-rate direction and dominance should select the mirrored left/right recovery target before the torso orientation has finished rotating.",
    expectedEffect:
      "Preserve the early-entry feasibility gain, reach side support before the six-second recovery timeout in both degraded Cases, and retain orientation-based classification for static self-righting regressions.",
    kind: "momentum-recovery",
    supervisorConfig: {
      disturbanceRecoveryCommandDeadband: 0.02,
      disturbanceRecoveryMaximumHeightM: 0.38,
      disturbanceRecoveryMinimumTiltRad: 0.25,
      disturbanceRecoveryMinimumAngularSpeedRadPerSec: 2.2,
    },
    recoveryConfig: {
      dynamicEntryLateralAngularSpeedThresholdRadPerSec: 1.2,
      dynamicEntryLateralDominanceRatio: 0.9,
    },
  },
];

const selected = strategies.find(
  (candidate) => !triedStrategies.has(candidate.strategy),
);
if (!selected) {
  process.stdout.write("null");
  process.exit(0);
}

if (selected.kind === "momentum-recovery") {
  installMomentumDirectedRecoveryEntry(
    selected.supervisorConfig,
    selected.recoveryConfig,
  );
} else if (selected.kind === "early-recovery") {
  installDisturbanceConditionedRecoveryEntry(selected.config);
} else {
  installMeasuredPhaseAndSupportFeedback(selected.config);
}
await writeFile(locomotionPath, locomotion);
await writeFile(supervisorPath, supervisor);
await writeFile(recoveryPath, recovery);
await writeFile(definitionPath, `${JSON.stringify(definition, null, 2)}\n`);

process.stdout.write(
  JSON.stringify({
    strategy: selected.strategy,
    hypothesis: selected.hypothesis,
    expectedEffect: selected.expectedEffect,
  }),
);
