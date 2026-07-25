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
training.eliteReplay.scope = "complete-mission";
await writeFile(trainingPath, `${JSON.stringify(training, null, 2)}\n`);

process.stdout.write(JSON.stringify({
  ...baseProposal,
  strategy: "complete-mission-elite-replay-consolidation",
  hypothesis:
    "All-progression elite replay moved the frozen actor mean from zero to one target entry and improved the locked Mission violation tier, but six of its nine admitted episodes came from the short recovery prefix while the deterministic complete-Mission probes still entered the target zero times. Keep the replay algorithm and every physical/training input fixed, but admit target-entry tails only from progression stages that run through the final authored Mission phase.",
  expectedEffect:
    "Consolidate behavior that was demonstrated in the same uninterrupted impact→recover→resume→redirect→traverse→stop context used for deployment, improve deterministic complete-Mission target entry and terminal posture on both directions, and remove the final-height and recovery-handoff regressions without weakening any locked gate.",
}));
