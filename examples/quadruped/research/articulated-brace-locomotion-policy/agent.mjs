import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const request = JSON.parse(await new Response(Bun.stdin.stream()).text());
if (request.lab?.id !== "articulated-brace-locomotion-policy") {
  throw new Error(
    "This bounded researcher only accepts the articulated-brace-locomotion-policy Lab",
  );
}

const triedStrategies = new Set(
  (Array.isArray(request.history) ? request.history : [])
    .map((entry) => entry?.proposal?.strategy)
    .filter((value) => typeof value === "string"),
);
const strategies = [
  "early-delay-locomotion-residual-with-signed-progress-credit",
  "post-recovery-durable-handoff-suffix-residual",
];
const strategy = strategies.find((candidate) => !triedStrategies.has(candidate));
if (!strategy) {
  process.stdout.write("null");
  process.exit(0);
}

const trainingPath = resolve(
  request.workspace,
  "training/articulated-brace-locomotion.training.json",
);
const trainerPath = resolve(
  request.workspace,
  "trainers/articulated-brace-locomotion-residual-ppo/trainer.py",
);
const training = JSON.parse(await readFile(trainingPath, "utf8"));
let trainer = await readFile(trainerPath, "utf8");

const scaleFrom =
  "            \"residualScaleByAction\": [\n" +
  "                0.3,\n".repeat(12) +
  "                0.1,\n" +
  "                0.1,\n" +
  "            ],\n";
if (!trainer.includes(scaleFrom)) {
  throw new Error("Accepted Trainer no longer contains the expected per-actuator residual authority");
}

if (strategy === "post-recovery-durable-handoff-suffix-residual") {
  training.totalSteps = 32768;
  training.progression[0].untilStep = 16384;
  training.progression[1].untilStep = 32768;
  training.learningRate = 0.00005;
  training.entropyCoefficient = 0.0005;
  training.residualPenalty = 0.2;
  training.missionReward = {
    commandProgress: 4,
    velocityTracking: 1,
    stopStability: 8,
    recoverySuccess: 150,
    phaseTimeoutPenalty: 250,
    timeoutFreeCompletion: 150,
  };
  const scaleTo =
    "            \"residualScaleByAction\": [\n" +
    "                0.20,\n".repeat(12) +
    "                0.50,\n" +
    "                0.50,\n" +
    "            ],\n";
  trainer = trainer.replace(scaleFrom, scaleTo);
  trainer = trainer.replace(
    '                "allowedModes": ["locomotion"],\n',
    '                "allowedModes": ["settling", "locomotion"],\n',
  );
  trainer = trainer.replace(
    '                    "modeDwellSeconds": 0.2,\n',
    '                    "transitionCount": 3,\n',
  );
  trainer = trainer.replace(
    '                    "bodyTiltRad": 0.8,\n',
    '                    "bodyTiltRad": 0.7,\n',
  );
  trainer = trainer.replace(
    '                "rampSeconds": 0.2,\n',
    '                "rampSeconds": 0.3,\n',
  );
} else {
  training.totalSteps = 16384;
  training.progression[0].untilStep = 8192;
  training.progression[1].untilStep = 16384;
  training.missionReward.commandProgress = 8;
  training.residualPenalty = 0.2;
  const scaleTo =
    "            \"residualScaleByAction\": [\n" +
    "                0.45,\n".repeat(12) +
    "                0.05,\n" +
    "                0.05,\n" +
    "            ],\n";
  trainer = trainer.replace(scaleFrom, scaleTo);
  trainer = trainer.replace(
    '                    "modeDwellSeconds": 0.2,\n',
    '                    "modeDwellSeconds": 0.1,\n',
  );
}

await writeFile(trainingPath, `${JSON.stringify(training, null, 2)}\n`);
await writeFile(trainerPath, trainer);

process.stdout.write(
  JSON.stringify({
    strategy,
    hypothesis:
      strategy === "post-recovery-durable-handoff-suffix-residual"
        ? "The complete-Mission trace localizes the new failure after a successful self-right: the fixed handoff reaches high locomotion authority, then the robot relapses during traverse or stop. A residual gated by observable Program transitionCount and limited to settling/locomotion can learn the causal post-recovery suffix while remaining exactly zero during approach, impact, recovery, and static exact Cases. Full stop-completion and recovery credit makes durable behavior—not first self-right—the optimized return."
        : "The first complete-Mission Policy had actor authority on 92% of exact approach steps but still accumulated negative commanded progress, while randomized approach authority fell to 80%. Doubling complete-Mission experience, increasing signed progress credit, shortening only the locomotion gate dwell, and shifting bounded authority from the waist to the legs should let PPO learn the left/right correction that a binary Program fallback could not express.",
    expectedEffect:
      strategy === "post-recovery-durable-handoff-suffix-residual"
        ? "Reduce recovery relapse and restore final height/tilt in both degraded complete Cases without changing exact approach, impact, self-righting, or Program recovery authority; the unchanged locked Mission and regression gates decide promotion."
        : "Improve delay-one approach and downstream signed Mission progress in both degraded directions while the Program remains sole owner of recovery and all self-righting, collision, joint-limit, and command gates remain passing relative to the reference Controller.",
  }),
);
