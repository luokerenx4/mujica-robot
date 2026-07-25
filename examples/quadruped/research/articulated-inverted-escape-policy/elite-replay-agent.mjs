import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const request = JSON.parse(await new Response(Bun.stdin.stream()).text());
const strategiesBeforeConjunctive = [
  "delay-one-dynamic-recovery-windowed-residual",
  "first-recovery-only-delay-one-residual",
  "task-target-closed-loop-history-recovery",
  "phase-bounded-ramped-history-recovery",
  "deadline-closed-phase-bounded-history-recovery",
  "predeadline-target-seeking-rise-recovery",
];
request.history = strategiesBeforeConjunctive.map((strategy) => ({
  proposal: { strategy },
}));

const child = Bun.spawn(
  ["bun", resolve(import.meta.dir, "agent.mjs")],
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
training.eliteReplay = {
  trigger: "actor-recovery-target-entry",
  tailSteps: 64,
  capacity: 4096,
  minibatchSize: 64,
  coefficient: 0.05,
};
await writeFile(trainingPath, `${JSON.stringify(training, null, 2)}\n`);

process.stdout.write(JSON.stringify({
  ...baseProposal,
  strategy: "elite-target-entry-replay-consolidation",
  hypothesis:
    "The reproducible 65,536-step continuous-Mission run produced six actor-caused recovery-target entries under sampled PPO actions, but the frozen actor mean produced zero entries, zero stable progress, and a timeout in every deterministic probe. Preserve the exact architecture, authority envelope, curriculum, reward, seed, and training budget; when an actor-authorized action first enters the Task-authored recovery target, retain only the preceding 64 actor-authorized observation/action pairs and distill that bounded successful tail into the actor mean during later PPO updates.",
  expectedEffect:
    "Convert exploration-only target entries into deterministic actor-mean target entries in both impact directions without increasing Training steps or changing the locked Task, Scenario, Program prior, authority envelope, or Mission Judge; any failure to improve the frozen probe or complete-Mission gate tier must remain REVERT.",
}));
