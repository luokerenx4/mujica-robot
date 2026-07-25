import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const request = JSON.parse(await new Response(Bun.stdin.stream()).text());
const child = Bun.spawn(
  ["bun", resolve(import.meta.dir, "counterfactual-reflex-distillation-agent.mjs")],
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
training.deterministicCheckpoint.includeInitialProgramPolicy = true;
await writeFile(trainingPath, `${JSON.stringify(training, null, 2)}\n`);

process.stdout.write(JSON.stringify({
  ...baseProposal,
  strategy: "program-safe-complete-mission-policy-selection",
  hypothesis:
    "Skill-focused rewards and stochastic exploration may improve a recovery slice while damaging walking, impact response, Mission resumption, redirection, traversal, or stop. Include the exactly zero residual actor at Training step 0 as a frozen Program-equivalent Policy candidate, then compare it with every learned checkpoint only on deterministic, complete no-reset Mission evidence across both authored impact directions and plant profiles.",
  expectedEffect:
    "Publish learned weights only if they improve the integrated Mission ranking. Otherwise restore the step-0 Policy, proving that the ML artifact remains executable and behavior-equivalent to the Program baseline while preserving all learned checkpoints as negative research evidence for diagnosis.",
}));
