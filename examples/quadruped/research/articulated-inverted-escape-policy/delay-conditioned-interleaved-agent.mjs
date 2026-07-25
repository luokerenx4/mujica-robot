import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const request = JSON.parse(await new Response(Bun.stdin.stream()).text());
const child = Bun.spawn(
  ["bun", resolve(import.meta.dir, "interleaved-complete-mission-agent.mjs")],
  { stdin: "pipe", stdout: "pipe", stderr: "inherit" },
);
child.stdin.write(JSON.stringify(request));
child.stdin.end();
const baseProposalText = await new Response(child.stdout).text();
const exitCode = await child.exited;
if (exitCode !== 0) process.exit(exitCode);
const baseProposal = JSON.parse(baseProposalText);

const trainerPath = resolve(
  request.workspace,
  "trainers/articulated-inverted-escape-residual-ppo/trainer.py",
);
let trainer = await readFile(trainerPath, "utf8");

function replaceOnce(from, to, label) {
  const occurrences = trainer.split(from).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `${label} expected one Trainer source match, found ${occurrences}`,
    );
  }
  trainer = trainer.replace(from, to);
}

replaceOnce(
  '                "allowedTelemetry": {\n' +
    '                    "phase": ["recovery.impulse", "recovery.capture", "recovery.rise"],\n' +
    "                },\n",
  '                "allowedTelemetry": {\n' +
    '                    "phase": ["recovery.impulse", "recovery.capture", "recovery.rise"],\n' +
    '                    "measuredDelaySteps": [1, 2],\n' +
    "                },\n",
  "bounded measured-delay authority",
);
replaceOnce(
  '                "minimumTelemetry": {\n' +
    '                    "measuredDelaySteps": 1,\n',
  '                "minimumTelemetry": {\n',
  "remove exact-delay lower bound",
);
replaceOnce(
  '                "maximumTelemetry": {\n' +
    '                    "measuredDelaySteps": 1,\n',
  '                "maximumTelemetry": {\n',
  "remove exact-delay upper bound",
);
await writeFile(trainerPath, trainer);

process.stdout.write(JSON.stringify({
  ...baseProposal,
  strategy: "delay-conditioned-interleaved-complete-mission-recovery",
  hypothesis:
    "The interleaved run proved that Mission scheduling was no longer the blind spot, but its randomized complete-Mission ledger exposed a second contract mismatch: every episode with one sampled delay-jitter step had zero actor-authorized actions because the residual gate required measuredDelaySteps to equal exactly one, even though the Policy observes the effective delay and the declared Domain Profile intentionally produces one- or two-step plants. Preserve the complete Mission, quotas, replay, checkpoint selector, torque envelope, reward, seed, and Judge while authorizing the same ramped recovery residual at the two explicitly trained delay values.",
  expectedEffect:
    "Give both one- and two-step randomized plants nonzero recovery actor coverage, collect actor-caused target entries across both delay buckets and impact directions, and improve the worst-direction deterministic Mission rank without changing zero-delay exact Cases or any locked promotion gate.",
}));
