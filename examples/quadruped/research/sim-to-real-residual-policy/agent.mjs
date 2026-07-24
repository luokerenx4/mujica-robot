import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const request = JSON.parse(await new Response(Bun.stdin.stream()).text());
if (request.lab?.id !== "sim-to-real-residual-policy") {
  throw new Error("This bounded researcher only accepts the sim-to-real-residual-policy Lab");
}

const path = resolve(request.workspace, "training/sim-to-real-residual-locomotion.training.json");
const training = JSON.parse(await readFile(path, "utf8"));
training.residualScale = 0.0005;
training.residualPenalty = 100;
await writeFile(path, `${JSON.stringify(training, null, 2)}\n`);

process.stdout.write(JSON.stringify({
  strategy: "reference-anchored-residual",
  hypothesis: "A much smaller residual around the reviewed bounded Controller should retain its held-out plant behavior while PPO learns only corrections that survive the strong residual penalty.",
  expectedEffect: "Move the learned Policy toward the bounded Controller on heavy-weak and light-strong, improve over the current frozen Policy, and avoid upright-locomotion or motion-quality gate regressions.",
}));
