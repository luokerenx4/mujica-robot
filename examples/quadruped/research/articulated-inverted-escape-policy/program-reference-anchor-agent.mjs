import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const request = JSON.parse(await new Response(Bun.stdin.stream()).text());
const child = Bun.spawn(
  [
    "bun",
    resolve(
      import.meta.dir,
      "program-safe-initial-checkpoint-agent.mjs",
    ),
  ],
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
training.programReference = {
  scope: "complete-mission-active-states",
  maximumSamples: 512,
  coefficient: 0.1,
  maximumAppliedResidualRms: 0.05,
};
await writeFile(trainingPath, `${JSON.stringify(training, null, 2)}\n`);

process.stdout.write(JSON.stringify({
  ...baseProposal,
  strategy: "program-reference-anchored-complete-mission-rl",
  hypothesis:
    "The zero-residual step-0 Policy exactly reproduces the current-Assembly Program, but unconstrained PPO erases that behavior as soon as a local reflex reward moves the actor mean. Freeze the physical observations where step-0 receives residual authority during both exact and randomized complete Missions, train against zero applied residual on that fixed Program distribution, and roll back any optimizer step whose mean applied residual RMS exceeds 0.05 while preserving the same local counterfactual course, exploration, Mission rewards, step-0 selector, and locked Judge.",
  expectedEffect:
    "Keep learned changes inside a measured torque-space trust region on the Program's complete-Mission state distribution, retain the exact Program as the executable fallback, and determine whether RL can improve a bilateral recovery basin without destroying walking, downstream Mission resumption, redirection, traversal, or stop.",
}));
