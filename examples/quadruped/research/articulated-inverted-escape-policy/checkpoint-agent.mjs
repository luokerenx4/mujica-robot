import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const request = JSON.parse(await new Response(Bun.stdin.stream()).text());
const child = Bun.spawn(
  ["bun", resolve(import.meta.dir, "elite-replay-agent.mjs")],
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
training.deterministicCheckpoint = {
  scope: "complete-mission",
  everySteps: 8192,
  minimumSteps: 8192,
};
await writeFile(trainingPath, `${JSON.stringify(training, null, 2)}\n`);

process.stdout.write(JSON.stringify({
  ...baseProposal,
  strategy: "deterministic-complete-mission-checkpoint-selection",
  hypothesis:
    "All-progression elite replay improved the locked violation tier and produced the first frozen actor-mean target entry, but PPO still published only its final update. Keep the same 65,536 Training steps, replay data, architecture, rewards, seed, Program prior, authority envelope, Task, Scenarios, and Judge; every 8,192 steps freeze the network plus normalizer and compare actor-mean behavior only on the complete Mission stages using side-balanced Task events.",
  expectedEffect:
    "Publish the checkpoint with the best worst-direction complete-Mission completion, stable recovery, target entry, relapse/timeout avoidance, and target progress; restore earlier weights only when that zero-budget evidence is stronger, then let the unchanged locked Mission Judge accept or reject the selected Policy.",
}));
