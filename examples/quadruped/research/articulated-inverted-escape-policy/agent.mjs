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
];
const strategy = strategies.find((candidate) => !triedStrategies.has(candidate));
if (!strategy) {
  process.stdout.write("null");
  process.exit(0);
}
const firstRecoveryOnly =
  strategy === "first-recovery-only-delay-one-residual";

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
  stillnessMaximumTiltRad: 0.5,
};
delete training.residualScale;

await writeFile(trainerPath, trainer);
await writeFile(trainingPath, `${JSON.stringify(training, null, 2)}\n`);

process.stdout.write(
  JSON.stringify({
    strategy,
    hypothesis: firstRecoveryOnly
      ? "The first delay-one residual improved degraded-right progress, tilt, collisions, and joint margin, but the complete Mission exposed a second fall during traverse/stop. The residual reactivated for that later recovery and the Mission ended mid-rise. Requiring observable Program telemetry recoveryCompleted=false preserves learned authority for the initial impact recovery while returning all later falls to the deterministic Program."
      : "Controller experiments improved trigger timing and entry classification but proved that one fixed recovery trajectory cannot absorb the delay-one impact-state distribution. A residual restricted to observable delay-one dynamic recovery can adapt the initial recovery and first retry while static recovery and locomotion remain Program-only; complete exact and degraded Cases must still judge any state that causally enters the same gate.",
    expectedEffect: firstRecoveryOnly
      ? "Retain the degraded-right signed-progress, tilt, collision, and joint-margin gains while restoring the passing terminal base-height gate; exact Cases and every post-recovery Mission action remain Program-only."
      : "Reduce both degraded recovery timeouts and terminal posture severity without changing any exact Case, static self-righting, handoff, command-tracking, or command-transition gate.",
  }),
);
