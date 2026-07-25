import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const request = JSON.parse(await new Response(Bun.stdin.stream()).text());
const child = Bun.spawn(
  ["bun", resolve(import.meta.dir, "delay-conditioned-interleaved-agent.mjs")],
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
const insertion = "        action_transform={\n";
const occurrences = trainer.split(insertion).length - 1;
if (occurrences !== 1) {
  throw new Error(
    `bilateral symmetry contract expected one Trainer insertion point, found ${occurrences}`,
  );
}
trainer = trainer.replace(
  insertion,
  `        bilateral_symmetry={
            "kind": "lateral-reflection-v1",
            "policyConsistencyCoefficient": 0.05,
            "augmentNormalizer": True,
            "mirrorEliteReplay": True,
            "identityObservationChannels": [
                "base-height",
                "actuator-delay-steps",
                "recovery-target-satisfied",
                "recovery-stable-progress",
                "recovery-stable-latched",
                "recovery-deadline-expired",
            ],
            "observationTransforms": {
                "joint-position": {
                    "permutation": [3, 4, 5, 0, 1, 2, 6, 7, 11, 12, 13, 8, 9, 10],
                    "signs": [-1, 1, 1, -1, 1, 1, -1, 1, -1, 1, 1, -1, 1, 1],
                },
                "joint-velocity": {
                    "permutation": [3, 4, 5, 0, 1, 2, 6, 7, 11, 12, 13, 8, 9, 10],
                    "signs": [-1, 1, 1, -1, 1, 1, -1, 1, -1, 1, 1, -1, 1, 1],
                },
                "base-orientation": {
                    "permutation": [0, 1, 2, 3],
                    "signs": [1, -1, 1, -1],
                },
                "base-velocity": {
                    "permutation": [0, 1, 2, 3, 4, 5],
                    "signs": [1, -1, 1, -1, 1, -1],
                },
                "imu-angular-velocity": {
                    "permutation": [0, 1, 2],
                    "signs": [-1, 1, -1],
                },
                "imu-linear-acceleration": {
                    "permutation": [0, 1, 2],
                    "signs": [1, -1, 1],
                },
                "command-action-history": {
                    "blockSize": 14,
                    "permutation": [3, 4, 5, 0, 1, 2, 9, 10, 11, 6, 7, 8, 12, 13],
                    "signs": [-1, 1, 1, -1, 1, 1, -1, 1, 1, -1, 1, 1, -1, 1],
                },
                "applied-action-history": {
                    "blockSize": 14,
                    "permutation": [3, 4, 5, 0, 1, 2, 9, 10, 11, 6, 7, 8, 12, 13],
                    "signs": [-1, 1, 1, -1, 1, 1, -1, 1, 1, -1, 1, 1, -1, 1],
                },
                "foot-contact-history": {
                    "blockSize": 4,
                    "permutation": [1, 0, 3, 2],
                    "signs": [1, 1, 1, 1],
                },
                "motion-command": {
                    "permutation": [0, 1, 2],
                    "signs": [1, -1, -1],
                },
                "foot-contact-force": {
                    "permutation": [1, 0, 3, 2],
                    "signs": [1, 1, 1, 1],
                },
            },
            "actionTransform": {
                "permutation": [3, 4, 5, 0, 1, 2, 9, 10, 11, 6, 7, 8, 12, 13],
                "signs": [-1, 1, 1, -1, 1, 1, -1, 1, 1, -1, 1, 1, -1, 1],
            },
        },
        action_transform={
`,
);
await writeFile(trainerPath, trainer);

process.stdout.write(JSON.stringify({
  ...baseProposal,
  strategy: "declared-bilateral-symmetry-recovery",
  hypothesis:
    "Delay-conditioned interleaving gave the two-step plant real actor authority but the frozen actor still reproduced a target entry only on the left and failed the right Mission. Keep the complete Mission, impact loads, delay envelope, stage quotas, reward, residual authority, checkpoint selector, seed, and Judge fixed. Declare the exact lateral reflection of every compiled Observation and Action coordinate, symmetrize normalizer statistics, penalize actor-mean equivariance error only where the actor has authority, and mirror any complete-Mission elite target-entry tail.",
  expectedEffect:
    "Turn a physically observed target-entry tail on either side into coordinate-consistent policy evidence for the other side, produce nonzero deterministic actor target-entry coverage in both impact directions, and improve the worst-direction complete-Mission rank without pretending that the 60 N and 49 N degraded impacts are physically identical.",
}));
