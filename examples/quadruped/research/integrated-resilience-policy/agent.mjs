import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const request = JSON.parse(await new Response(Bun.stdin.stream()).text());
if (request.lab?.id !== "integrated-resilience-policy") {
  throw new Error(
    "This bounded researcher only accepts the integrated-resilience-policy Lab",
  );
}

const path = resolve(
  request.workspace,
  "training/integrated-resilience-curriculum.training.json",
);
const training = JSON.parse(await readFile(path, "utf8"));
training.residualScale = 0.017;
training.residualPenalty = 6;
training.learningRate = 0.0001;
training.clipRatio = 0.1;
await writeFile(path, `${JSON.stringify(training, null, 2)}\n`);

process.stdout.write(
  JSON.stringify({
    strategy: "interpolated-safe-useful-micro-residual",
    hypothesis:
      "Residual 0.02 outperformed the new Controller but exceeded right-exact yaw by 0.021 rad/s; residual 0.01 preserved gates but fell below the Controller. Interpolating to 0.017 with proportional prior regularization should stay inside the measured yaw boundary while retaining enough downstream correction to beat the reference.",
    expectedEffect:
      "Keep right-exact yaw overshoot at or below 1.0 rad/s, preserve all reference gates, and score above Robot Revision quadruped-r-40206836cd00 on the same locked Mission Suite.",
  }),
);
