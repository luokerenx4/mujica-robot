import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const request = JSON.parse(await new Response(Bun.stdin.stream()).text());
const child = Bun.spawn(
  ["bun", resolve(import.meta.dir, "lateral-dof-reflex-agent.mjs")],
  { stdin: "pipe", stdout: "pipe", stderr: "inherit" },
);
child.stdin.write(JSON.stringify(request));
child.stdin.end();
const baseProposalText = await new Response(child.stdout).text();
const exitCode = await child.exited;
if (exitCode !== 0) process.exit(exitCode);
const baseProposal = JSON.parse(baseProposalText);

const trainingPath = resolve(
  request.workspace,
  "training/articulated-inverted-escape.training.json",
);
const training = JSON.parse(await readFile(trainingPath, "utf8"));
training.reflexDistillation = {
  search: "reflex-search-7e950b1350b261dd",
  minibatchSize: 62,
  coefficient: 0.01,
  untilStep: 8192,
};
await writeFile(trainingPath, `${JSON.stringify(training, null, 2)}\n`);

process.stdout.write(JSON.stringify({
  ...baseProposal,
  strategy: "continuous-mission-counterfactual-reflex-distillation",
  hypothesis:
    "A frozen-policy short-horizon search on four Training-only seeds found no safe improvement for the 60 N positive-y impact, but found one negative-y intervention that improved terminal recovery-target progress on both independent 49 N cases while reducing disallowed self-contact steps from two to zero. The first always-on 24-frame distillation overfit this local basin and failed the continuous Judge. Use 24 counterfactual teacher frames plus 38 frozen-policy anchors from the no-improvement side, lower the coefficient to 0.01, and linearly retire supervision by step 8192 while preserving the complete no-reset Mission progression, Program prior, lateral-only authority, bilateral consistency regularizer, seed, budget, and locked Judge.",
  expectedEffect:
    "Use the physical proxy only to initialize a state-local brace, explicitly preserve the opposite-side actor, and let the remaining 57,344 continuous-Mission steps overwrite any locally useful but globally harmful teacher bias. Promotion still requires the unchanged walk→impact→recover→resume→redirect→traverse→stop Mission Suite to improve without regressions.",
}));
