import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const request = JSON.parse(await new Response(Bun.stdin.stream()).text());
const child = Bun.spawn(
  ["bun", resolve(import.meta.dir, "complete-mission-elite-replay-agent.mjs")],
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
training.progressionSampling = "interleaved-step-share";
training.deterministicCheckpoint = {
  scope: "complete-mission",
  everySteps: 8192,
  minimumSteps: 8192,
};
await writeFile(trainingPath, `${JSON.stringify(training, null, 2)}\n`);

process.stdout.write(JSON.stringify({
  ...baseProposal,
  strategy: "interleaved-complete-mission-elite-collection",
  hypothesis:
    "Sequential progression observed 76 recovery-prefix episodes before any complete-Mission training and complete-only elite replay admitted only one successful tail. Preserve the exact 32,768/16,384/16,384 stage quotas and every physical, reward, authority, seed, and Judge input, but deficit-schedule prefix, exact complete Mission, and randomized complete Mission episodes throughout Training so transient useful Policies can create deployment-context evidence before later PPO updates erase them.",
  expectedEffect:
    "Admit multiple complete-Mission target-entry tails across both impact directions and physical profiles, produce a frozen checkpoint with nonzero worst-direction actor target-entry coverage, then improve the locked Mission violation tier without exchanging left/right failures or regressing exact and handoff gates.",
}));
