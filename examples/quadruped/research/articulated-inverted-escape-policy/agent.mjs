import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const request = JSON.parse(await new Response(Bun.stdin.stream()).text());
if (request.lab?.id !== "articulated-inverted-escape-policy") {
  throw new Error(
    "This bounded researcher only accepts the articulated-inverted-escape-policy Lab",
  );
}

const triedStrategies = new Set(
  (Array.isArray(request.history) ? request.history : [])
    .map((entry) => entry?.proposal?.strategy)
    .filter((value) => typeof value === "string"),
);
const strategies = [
  "delay-one-dynamic-recovery-windowed-residual",
  "first-recovery-only-delay-one-residual",
  "task-target-closed-loop-history-recovery",
  "phase-bounded-ramped-history-recovery",
  "deadline-closed-phase-bounded-history-recovery",
  "predeadline-target-seeking-rise-recovery",
];
const strategy = strategies.find((candidate) => !triedStrategies.has(candidate));
if (!strategy) {
  process.stdout.write("null");
  process.exit(0);
}
const firstRecoveryOnly =
  strategy === "first-recovery-only-delay-one-residual";
const deadlineClosed =
  strategy === "deadline-closed-phase-bounded-history-recovery";
const targetSeekingRise =
  strategy === "predeadline-target-seeking-rise-recovery";
const phaseBoundedRamp =
  strategy === "phase-bounded-ramped-history-recovery" ||
  deadlineClosed ||
  targetSeekingRise;
const taskTargetClosedLoop =
  strategy === "task-target-closed-loop-history-recovery" ||
  phaseBoundedRamp;

const trainerPath = resolve(
  request.workspace,
  "trainers/articulated-inverted-escape-residual-ppo/trainer.py",
);
const trainingPath = resolve(
  request.workspace,
  "training/articulated-inverted-escape.training.json",
);
let trainer = await readFile(trainerPath, "utf8");
const training = JSON.parse(await readFile(trainingPath, "utf8"));

function replaceOnce(from, to, label) {
  const occurrences = trainer.split(from).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `${label} expected one Trainer source match, found ${occurrences}`,
    );
  }
  trainer = trainer.replace(from, to);
}

replaceOnce(
  "        initial_log_std=-1.5,\n",
  "        initial_log_std=-1.1,\n",
  "dynamic recovery exploration scale",
);
replaceOnce(
  '            "residualScale": 1.0,\n',
  '            "residualScaleByAction": [\n' +
    "                0.30, 0.30, 0.30,\n" +
    "                0.30, 0.30, 0.30,\n" +
    "                0.30, 0.30, 0.30,\n" +
    "                0.30, 0.30, 0.30,\n" +
    "                1.50, 1.50,\n" +
    "            ],\n",
  "per-actuator residual authority",
);
replaceOnce(
  '                "minimumTelemetry": {\n' +
    '                    "recoveryRetryCount": 1,\n' +
    '                    "bodyTiltRad": 2.6,\n' +
    "                },\n" +
    '                "maximumTelemetry": {\n' +
    '                    "recoveryRetryCount": 2,\n' +
    '                    "baseHeightM": 0.16,\n' +
    '                    "supportFeet": 0,\n' +
    "                },\n",
  '                "minimumTelemetry": {\n' +
    '                    "measuredDelaySteps": 1,\n' +
    '                    "bodyTiltRad": 0.3,\n' +
    "                },\n" +
    '                "maximumTelemetry": {\n' +
    '                    "measuredDelaySteps": 1,\n' +
    '                    "recoveryRetryCount": 1,\n' +
    '                    "baseHeightM": 0.45,\n' +
    '                    "supportFeet": 3,\n' +
    '                    "modeDwellSeconds": 4.5,\n' +
    "                },\n",
  "delay-one dynamic recovery authority window",
);
if (firstRecoveryOnly) {
  replaceOnce(
    '                "requiredTelemetry": {\n' +
      '                    "dynamicRecovery": True,\n' +
      "                },\n",
    '                "requiredTelemetry": {\n' +
      '                    "dynamicRecovery": True,\n' +
      '                    "recoveryCompleted": False,\n' +
      "                },\n",
    "first completed-recovery authority boundary",
  );
}
if (taskTargetClosedLoop) {
  replaceOnce(
    '                "allowedModes": ["recovery"],\n',
    '                "allowedModes": ["recovery"],\n' +
      '                "requiredObservation": {\n' +
      '                    "recovery-target-satisfied": 0.0,\n' +
      '                    "recovery-stable-latched": 0.0,\n' +
      "                },\n",
    "Task-authoritative recovery authority boundary",
  );
  replaceOnce(
    "        initial_log_std=-1.1,\n",
    "        initial_log_std=-1.1,\n" +
      "        history_encoder={\n" +
      '            "channels": [\n' +
      '                {"channel": "command-action-history", "steps": 4, "size": 14},\n' +
      '                {"channel": "applied-action-history", "steps": 4, "size": 14},\n' +
      '                {"channel": "foot-contact-history", "steps": 4, "size": 4},\n' +
      "            ],\n" +
      '            "recurrentSize": 32,\n' +
      "        },\n",
    "bounded recovery history encoder",
  );
  training.assembly =
    "resilient-command-conditioned-waist-history-3dof";
}
if (phaseBoundedRamp) {
  replaceOnce(
    '                "requiredObservation": {\n' +
      '                    "recovery-target-satisfied": 0.0,\n' +
      '                    "recovery-stable-latched": 0.0,\n' +
      "                },\n",
    '                "requiredObservation": {\n' +
      '                    "recovery-target-satisfied": 0.0,\n' +
      '                    "recovery-stable-latched": 0.0,\n' +
      "                },\n" +
      '                "allowedTelemetry": {\n' +
      `                    "phase": ["recovery.impulse", "recovery.capture"${targetSeekingRise ? ', "recovery.rise"' : ""}],\n` +
      "                },\n",
    "phase-bounded recovery authority",
  );
  replaceOnce(
    '                "rampSeconds": 0,\n',
    '                "rampSeconds": 0,\n' +
      '                "entryRampSeconds": 0.4,\n',
    "stateful recovery gate entry ramp",
  );
}
if (deadlineClosed) {
  replaceOnce(
    '                    "recovery-stable-latched": 0.0,\n',
    '                    "recovery-stable-latched": 0.0,\n' +
      '                    "recovery-deadline-expired": 0.0,\n',
    "Task recovery deadline authority boundary",
  );
}
if (targetSeekingRise) {
  replaceOnce(
    '                    "bodyTiltRad": 0.3,\n',
    '                    "bodyTiltRad": 0.0,\n',
    "target-seeking rise authority tilt floor",
  );
  replaceOnce(
    '                "requiredObservation": {\n' +
      '                    "recovery-target-satisfied": 0.0,\n' +
      '                    "recovery-stable-latched": 0.0,\n' +
      "                },\n",
    '                "requiredObservation": {\n' +
      '                    "recovery-target-satisfied": 0.0,\n' +
      '                    "recovery-stable-latched": 0.0,\n' +
      "                },\n" +
      '                "requiredRuntimeState": {\n' +
      '                    "recoveryDeadlineExpired": 0.0,\n' +
      "                },\n",
    "Runtime-owned recovery deadline authority boundary",
  );
}

training.totalSteps = 65536;
training.progression[0].untilStep = 32768;
training.progression[1].untilStep = 49152;
training.progression[2].untilStep = 65536;
training.learningRate = 0.00005;
training.entropyCoefficient = 0.0005;
training.residualPenalty = 0.05;
training.recoveryReward = {
  upright: 12,
  height: 6,
  stillness: 1,
  support: 5,
  tiltEscape: 8,
  ...(targetSeekingRise ? { taskTargetEntry: 80 } : {}),
  stillnessMaximumTiltRad: 0.5,
};
if (taskTargetClosedLoop) {
  training.missionReward = {
    commandProgress: 3,
    velocityTracking: 0.5,
    stopStability: 2,
    recoverySuccess: 200,
    recoveryRelapsePenalty: 300,
    phaseTimeoutPenalty: 300,
    timeoutFreeCompletion: 150,
  };
}
delete training.residualScale;

await writeFile(trainerPath, trainer);
await writeFile(trainingPath, `${JSON.stringify(training, null, 2)}\n`);

process.stdout.write(
  JSON.stringify({
    strategy,
    hypothesis: targetSeekingRise
      ? "A frozen-weight authority counterfactual proved that extending the bounded residual through Program rise can turn degraded-left from terminal inversion into a stable target entry, but the untrained rise actions also caused two relapses and degraded transition tracking. Train that exact pre-deadline rise envelope inside the continuous no-reset Mission, credit only actor-authorized entry into the Task-authored recovery target, and retain sparse relapse, timeout, and Mission-completion terms so local self-righting cannot win by breaking the later traverse and stop phases."
      : deadlineClosed
      ? "The phase-bounded ramped Policy restored degraded-right self-righting and improved the Mission violation tier, but the Task recovery phase had already timed out before self-righting. Because no success latch can exist after that failed transition, the Policy reactivated on later falls and ended below the final-height gate. Preserve the learned initial impulse/capture correction, and additionally require the Task-derived recovery-deadline-expired latch to remain false. This closes authority permanently at the six-second recovery timeout even when the Program later enters recovery again."
      : phaseBoundedRamp
      ? "The prior closed-loop Policy did not fail at the Task dwell boundary; it re-entered with full authority during Program rise/stand as tilt oscillated around the 0.3 rad gate, then drove the degraded-right robot from 0.34 metres and moderate tilt into inversion. Preserve the same Task-state boundary, history, reward, and torque envelope, but restrict learned authority to the Program's observable impulse/capture phases and ramp every gate entry over 0.4 seconds. Unsafe exits remain immediate, so the deterministic Program exclusively owns rise, stand, and stable dwell."
      : taskTargetClosedLoop
      ? "The first-recovery Program flag is an early private threshold and cannot distinguish a transient upright sample from the Task's physical recovery dwell. Give the delay-one recovery residual bounded commanded/applied/contact history, but remove its authority whenever the Task target is currently satisfied and permanently after the Runtime stable latch. This creates a closed loop: PPO can correct delayed recovery while outside the target, the Program alone owns every dwell sample, and later post-latch falls cannot reactivate the recovery Policy."
      : firstRecoveryOnly
      ? "The first delay-one residual improved degraded-right progress, tilt, collisions, and joint margin, but the complete Mission exposed a second fall during traverse/stop. The residual reactivated for that later recovery and the Mission ended mid-rise. Requiring observable Program telemetry recoveryCompleted=false preserves learned authority for the initial impact recovery while returning all later falls to the deterministic Program."
      : "Controller experiments improved trigger timing and entry classification but proved that one fixed recovery trajectory cannot absorb the delay-one impact-state distribution. A residual restricted to observable delay-one dynamic recovery can adapt the initial recovery and first retry while static recovery and locomotion remain Program-only; complete exact and degraded Cases must still judge any state that causally enters the same gate.",
    expectedEffect: targetSeekingRise
      ? "Complete stable recovery before the six-second deadline in both degraded directions, then traverse and stop without relapse; preserve all exact-plant gates and keep Policy authority at zero after target entry, stable latch, or recovery timeout."
      : deadlineClosed
      ? "Keep the first recovery correction unchanged until the Task deadline, guarantee zero learned authority afterward, retain degraded-right self-righting, and restore terminal height by leaving every post-timeout recovery to the Program."
      : phaseBoundedRamp
      ? "Retain any learned impact-momentum correction before recovery.rise, eliminate gate flapping and all learned action during rise/stand, and restore the Program's degraded-right self-righting result without changing exact Cases."
      : taskTargetClosedLoop
      ? "Complete the Task's 0.5 second stable-recovery dwell before its six-second timeout in both degraded directions, preserve exact and static recovery, and keep Policy authority at zero during every stable-dwell sample and all post-latch Mission phases."
      : firstRecoveryOnly
      ? "Retain the degraded-right signed-progress, tilt, collision, and joint-margin gains while restoring the passing terminal base-height gate; exact Cases and every post-recovery Mission action remain Program-only."
      : "Reduce both degraded recovery timeouts and terminal posture severity without changing any exact Case, static self-righting, handoff, command-tracking, or command-transition gate.",
  }),
);
