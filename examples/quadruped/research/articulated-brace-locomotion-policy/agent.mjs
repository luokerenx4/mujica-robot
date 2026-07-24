import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const request = JSON.parse(await new Response(Bun.stdin.stream()).text());
if (request.lab?.id !== "articulated-brace-locomotion-policy") {
  throw new Error(
    "This bounded researcher only accepts the articulated-brace-locomotion-policy Lab",
  );
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

training.totalSteps = 16384;
training.progression[0].untilStep = 8192;
training.progression[1].untilStep = 16384;
training.missionReward.commandProgress = 8;
training.residualPenalty = 0.2;

const scaleFrom =
  "            \"residualScaleByAction\": [\n" +
  "                0.3,\n".repeat(12) +
  "                0.1,\n" +
  "                0.1,\n" +
  "            ],\n";
const scaleTo =
  "            \"residualScaleByAction\": [\n" +
  "                0.45,\n".repeat(12) +
  "                0.05,\n" +
  "                0.05,\n" +
  "            ],\n";
if (!trainer.includes(scaleFrom)) {
  throw new Error("Accepted Trainer no longer contains the expected per-actuator residual authority");
}
trainer = trainer.replace(scaleFrom, scaleTo);
trainer = trainer.replace(
  '                    "modeDwellSeconds": 0.2,\n',
  '                    "modeDwellSeconds": 0.1,\n',
);

await writeFile(trainingPath, `${JSON.stringify(training, null, 2)}\n`);
await writeFile(trainerPath, trainer);

process.stdout.write(
  JSON.stringify({
    strategy: "early-delay-locomotion-residual-with-signed-progress-credit",
    hypothesis:
      "The first complete-Mission Policy had actor authority on 92% of exact approach steps but still accumulated negative commanded progress, while randomized approach authority fell to 80%. Doubling complete-Mission experience, increasing signed progress credit, shortening only the locomotion gate dwell, and shifting bounded authority from the waist to the legs should let PPO learn the left/right correction that a binary Program fallback could not express.",
    expectedEffect:
      "Improve delay-one approach and downstream signed Mission progress in both degraded directions while the Program remains sole owner of recovery and all self-righting, collision, joint-limit, and command gates remain passing relative to the reference Controller.",
  }),
);
