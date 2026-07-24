import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const request = JSON.parse(await new Response(Bun.stdin.stream()).text());
if (request.lab?.id !== "integrated-resilience-waist-design") {
  throw new Error(
    "This bounded researcher only accepts the integrated-resilience-waist-design Lab",
  );
}

const recoveryPath = resolve(
  request.workspace,
  "controllers/articulated-behavior-supervisor/recovery.py",
);
const configPath = resolve(
  request.workspace,
  "controllers/articulated-behavior-supervisor/controller.json",
);
let source = await readFile(recoveryPath, "utf8");
const controller = JSON.parse(await readFile(configPath, "utf8"));

function replaceOnce(from, to, label) {
  if (!source.includes(from)) {
    throw new Error(
      `Articulated recovery Controller no longer contains the expected ${label} surface`,
    );
  }
  source = source.replace(from, to);
}

const parityAlreadyApplied = source.includes("        self.retry_count = 0\n");
if (!parityAlreadyApplied) {
replaceOnce(
  "        self.target_streak = 0\n" +
    "        self.last_telemetry = {\n",
  "        self.target_streak = 0\n" +
    "        self.retry_count = 0\n" +
    "        self.dynamic_entry = False\n" +
    "        self.feedback_hold = False\n" +
    "        self.previous_action = None\n" +
    "        self.last_telemetry = {\n",
  "reset state",
);
replaceOnce(
  '            "targetStreakSteps": 0,\n' +
    '            "waistTargetRad": [0.0, 0.0],\n',
  '            "targetStreakSteps": 0,\n' +
    '            "recoveryRetryCount": 0,\n' +
    '            "dynamicRecovery": False,\n' +
    '            "waistTargetRad": [0.0, 0.0],\n',
  "reset telemetry",
);
replaceOnce(
  "        if self.started_at is None:\n" +
    "            self.started_at = time_seconds\n" +
    "            self.fallen_pose = self.classify_pose(orientation)\n" +
    "        pose = self.fallen_pose\n" +
    "        elapsed = max(0.0, time_seconds - self.started_at)\n\n",
  "        if self.started_at is None:\n" +
    "            self.started_at = time_seconds\n" +
    "            self.fallen_pose = self.classify_pose(orientation)\n" +
    "            self.dynamic_entry = (\n" +
    '                float(np.linalg.norm(velocity[3:6]))\n' +
    '                >= self.config["dynamicEntryAngularSpeedThresholdRadPerSec"]\n' +
    "            )\n" +
    "        pose = self.fallen_pose\n" +
    "        elapsed = max(0.0, time_seconds - self.started_at)\n" +
    "        current_pose = self.classify_pose(orientation)\n" +
    "        if (\n" +
    "            self.dynamic_entry\n" +
    '            and pose != "upright"\n' +
    '            and current_pose not in ("upright", pose)\n' +
    '            and elapsed >= self.config["retryAfterSeconds"]\n' +
    '            and self.retry_count < self.config["maximumRecoveryRetries"]\n' +
    "            and float(np.linalg.norm(velocity[3:6]))\n" +
    '            <= self.config["maximumRetryAngularSpeedRadPerSec"]\n' +
    "        ):\n" +
    "            self.fallen_pose = current_pose\n" +
    "            pose = current_pose\n" +
    "            self.started_at = time_seconds\n" +
    "            elapsed = 0.0\n" +
    "            self.target_streak = 0\n" +
    "            self.retry_count += 1\n\n",
  "dynamic recovery entry",
);
replaceOnce(
  "        self.target_streak = self.target_streak + 1 if qualified else 0\n\n",
  "        self.target_streak = self.target_streak + 1 if qualified else 0\n" +
    "        if qualified and self.dynamic_entry and self.retry_count > 0:\n" +
    "            self.feedback_hold = True\n\n",
  "qualified retry hold",
);
replaceOnce(
  "            impulse, capture = self.targets_by_pose[pose]\n" +
    "            waist_impulse = np.asarray(\n" +
    '                self.config["waistImpulseTargetByPose"][pose], dtype=np.float64\n' +
    "            )\n" +
    "            waist_capture = np.asarray(\n" +
    '                self.config["waistCaptureTargetByPose"][pose], dtype=np.float64\n' +
    "            )\n" +
    '            if elapsed < self.config["impulseSeconds"]:\n' +
    '                self.phase = "impulse"\n' +
    "                target = impulse.copy()\n" +
    "                waist_target = waist_impulse\n" +
    '            elif elapsed < self.config["captureUntilSeconds"]:\n' +
    '                self.phase = "capture"\n' +
    "                target = capture.copy()\n" +
    "                waist_target = waist_capture\n" +
    "            else:\n" +
    '                rise_seconds = float(self.config["riseSecondsByPose"][pose])\n' +
    "                alpha = min(\n" +
    "                    1.0,\n" +
    '                    (elapsed - self.config["captureUntilSeconds"]) / rise_seconds,\n' +
    "                )\n" +
    "                self.phase = (\n" +
    '                    "stand"\n' +
    "                    if alpha >= 1.0\n" +
    '                    and support_feet >= self.config["minimumSupportFeet"]\n' +
    '                    else "rise"\n' +
    "                )\n" +
    "                target = (1.0 - alpha) * capture + alpha * self.stand_target\n" +
    "                target = self.stabilized_target(\n" +
    "                    target, roll, pitch, velocity[3:6], pose\n" +
    "                )\n" +
  "                waist_target = (1.0 - alpha) * waist_capture\n",
  "            impulse, capture = self.targets_by_pose[pose]\n" +
    "            dynamic_retry = self.dynamic_entry and self.retry_count > 0\n" +
    "            waist_impulse = (\n" +
    "                np.asarray(\n" +
    '                    self.config["waistImpulseTargetByPose"][pose],\n' +
    "                    dtype=np.float64,\n" +
    "                )\n" +
    "                if dynamic_retry\n" +
    "                else np.zeros(2, dtype=np.float64)\n" +
    "            )\n" +
    "            waist_capture = (\n" +
    "                np.asarray(\n" +
    '                    self.config["waistCaptureTargetByPose"][pose],\n' +
    "                    dtype=np.float64,\n" +
    "                )\n" +
    "                if dynamic_retry\n" +
    "                else np.zeros(2, dtype=np.float64)\n" +
    "            )\n" +
    "            impulse_seconds = (\n" +
    '                self.config["dynamicRetryImpulseSeconds"]\n' +
    "                if dynamic_retry\n" +
    '                else self.config["impulseSeconds"]\n' +
    "            )\n" +
    "            capture_until_seconds = (\n" +
    '                self.config["dynamicRetryCaptureUntilSeconds"]\n' +
    "                if dynamic_retry\n" +
    '                else self.config["captureUntilSeconds"]\n' +
    "            )\n" +
    "            if elapsed < impulse_seconds:\n" +
    '                self.phase = "impulse"\n' +
    "                target = impulse.copy()\n" +
    "                waist_target = waist_impulse\n" +
    "            elif elapsed < capture_until_seconds:\n" +
    '                self.phase = "capture"\n' +
    "                target = capture.copy()\n" +
    "                waist_target = waist_capture\n" +
    "            else:\n" +
    "                rise_seconds = float(\n" +
    '                    self.config["dynamicRetryRiseSecondsByPose"][pose]\n' +
    "                    if dynamic_retry\n" +
    '                    else self.config["riseSecondsByPose"][pose]\n' +
    "                )\n" +
    "                alpha = min(\n" +
    "                    1.0,\n" +
    "                    (elapsed - capture_until_seconds) / rise_seconds,\n" +
    "                )\n" +
    "                self.phase = (\n" +
    '                    "stand"\n' +
    "                    if alpha >= 1.0\n" +
    '                    and support_feet >= self.config["minimumSupportFeet"]\n' +
    '                    else "rise"\n' +
    "                )\n" +
    '                if dynamic_retry and self.phase == "stand":\n' +
    "                    self.feedback_hold = True\n" +
    "                target = (1.0 - alpha) * capture + alpha * self.stand_target\n" +
    "                target = self.stabilized_target(\n" +
    "                    target, roll, pitch, velocity[3:6], pose\n" +
    "                )\n" +
    "                waist_target = (1.0 - alpha) * waist_capture\n",
  "retry timing",
);
replaceOnce(
  '            "targetStreakSteps": self.target_streak,\n' +
    '            "waistTargetRad": waist_target.tolist(),\n',
  '            "targetStreakSteps": self.target_streak,\n' +
    '            "recoveryRetryCount": self.retry_count,\n' +
    '            "dynamicRecovery": self.dynamic_entry,\n' +
    '            "waistTargetRad": waist_target.tolist(),\n',
  "runtime telemetry",
);
replaceOnce(
  "        return target, waist_target, abduction_damping, self.config[\"kdSagittal\"]\n",
  "        sagittal_damping = (\n" +
    '            self.config["dynamicRiseKdSagittal"]\n' +
    "            if self.dynamic_entry and self.retry_count > 0\n" +
    '            else self.config["kdSagittal"]\n' +
    "        )\n" +
    "        return target, waist_target, abduction_damping, sagittal_damping\n",
  "dynamic damping",
);
replaceOnce(
  "        return np.clip(\n" +
    "            np.concatenate([leg_action.reshape(-1), waist_action]),\n" +
    "            -8.0,\n" +
    "            8.0,\n" +
    "        )\n",
  "        action = np.clip(\n" +
    "            np.concatenate([leg_action.reshape(-1), waist_action]),\n" +
    "            -8.0,\n" +
    "            8.0,\n" +
    "        )\n" +
    "        if self.feedback_hold and self.previous_action is not None:\n" +
    '            blend = self.config["dynamicHoldActionBlend"]\n' +
    "            action = (1.0 - blend) * self.previous_action + blend * action\n" +
    "        self.previous_action = action.copy()\n" +
    "        return action\n",
  "post-retry hold",
);
}

// The 0.18 rad retry moment was kept in session-640f3078b9349ed0.
// Test whether a smaller moment retains its three recovered Mission gates with
// less downstream tracking cost.
const activeWaistRetry = true;
if (activeWaistRetry) {
  const magnitude = parityAlreadyApplied ? 0.1 : 0.18;
  controller.config.recovery.waistImpulseTargetByPose = {
    front: [0, magnitude],
    back: [0, -magnitude],
    left: [magnitude, 0],
    right: [-magnitude, 0],
    upright: [0, 0],
  };
  controller.config.recovery.waistCaptureTargetByPose = {
    front: [0, -magnitude * 0.35],
    back: [0, magnitude * 0.35],
    left: [-magnitude * 0.35, 0],
    right: [magnitude * 0.35, 0],
    upright: [0, 0],
  };
}

await writeFile(recoveryPath, source);
await writeFile(configPath, `${JSON.stringify(controller, null, 2)}\n`);

process.stdout.write(
  JSON.stringify({
    strategy: activeWaistRetry
      ? parityAlreadyApplied
        ? "reduce-kept-dynamic-waist-moment"
        : "dynamic-retry-parity-with-bounded-waist-moment"
      : "dynamic-retry-parity-with-neutral-waist",
    hypothesis: activeWaistRetry
      ? parityAlreadyApplied
        ? "The kept 0.18 rad retry moment recovered three Mission gates but paid a downstream tracking penalty. A 0.10 rad moment may retain the basin change while reducing that disturbance."
        : "After restoring causal parity, a small pose-directed waist moment only inside the dynamic recovery path may enlarge the retry basin without changing static self-righting or locomotion."
      : "The first parity experiment improved severity but introduced self-collision during the initial dynamic impulse because articulated damping was changed before a pose retry existed. Keep the accepted initial dynamics, then enable reclassification, retry timing, and retry-only damping with a neutral waist.",
    expectedEffect: activeWaistRetry
      ? parityAlreadyApplied
        ? "Preserve the 41-violation feasibility tier and improve aggregate Mission score without regressing static self-righting, handoff, or command tracking."
        : "Improve the remaining degraded dynamic recovery cases while preserving exact Mission, static self-righting, handoff, and command regressions."
      : "Preserve zero disallowed collision steps before the retry while improving dynamic recovery severity, without changing static targets, waist moments, geometry, or locked inputs.",
  }),
);
