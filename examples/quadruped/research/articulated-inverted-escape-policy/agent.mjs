import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const request = JSON.parse(await new Response(Bun.stdin.stream()).text());
if (request.lab?.id !== "articulated-inverted-escape-policy") {
  throw new Error(
    "This bounded researcher only accepts the articulated-inverted-escape-policy Lab",
  );
}

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
  if (!trainer.includes(from)) {
    throw new Error(`Trainer no longer contains the expected ${label}`);
  }
  trainer = trainer.replace(from, to);
}

replaceOnce(
  "        initial_log_std=-1.5,\n",
  "        initial_log_std=-1.2,\n",
  "waist exploration scale",
);
replaceOnce(
  '            "residualScale": 1.0,\n',
  '            "residualScaleByAction": [\n' +
    "                0.15, 0.15, 0.15,\n" +
    "                0.15, 0.15, 0.15,\n" +
    "                0.15, 0.15, 0.15,\n" +
    "                0.15, 0.15, 0.15,\n" +
    "                2.0, 2.0,\n" +
    "            ],\n",
  "per-actuator residual authority",
);
replaceOnce(
  '                    "supportFeet": 0,\n',
  '                    "supportFeet": 0,\n' +
    '                    "modeDwellSeconds": 6.0,\n',
  "bounded attempt duration",
);

training.totalSteps = 65536;
training.progression[0].untilStep = 32768;
training.progression[1].untilStep = 49152;
training.progression[2].untilStep = 65536;
training.learningRate = 0.00005;
training.entropyCoefficient = 0.0005;
delete training.residualScale;

await writeFile(trainerPath, trainer);
await writeFile(trainingPath, `${JSON.stringify(training, null, 2)}\n`);

process.stdout.write(
  JSON.stringify({
    strategy: "waist-focused-finite-residual-authority",
    hypothesis:
      "Scalar authority spent most learned capacity perturbing twelve saturated leg actuators while the new morphology's two waist joints received the same small budget. A per-actuator envelope with 0.15 Nm leg micro-corrections, 2 Nm waist authority, and a finite recovery dwell should test the waist mechanism directly without allowing an unsuccessful Policy to act through the rest of the Mission.",
    expectedEffect:
      "Preserve every passing Mission and regression gate while producing measurable inverted escape, contact, final-tilt, or stable-stand improvement before the residual attempt times out.",
  }),
);
