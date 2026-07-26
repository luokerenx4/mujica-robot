import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const request = JSON.parse(await new Response(Bun.stdin.stream()).text());
const child = Bun.spawn(
  [
    "bun",
    resolve(
      import.meta.dir,
      "program-reference-anchor-agent.mjs",
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

const trainerPath = resolve(
  request.workspace,
  "trainers/articulated-inverted-escape-residual-ppo/trainer.py",
);
let trainer = await readFile(trainerPath, "utf8");
const insertion =
  '                "rampSeconds": 0,\n' +
  '                "entryRampSeconds": 0.4,\n';
const occurrences = trainer.split(insertion).length - 1;
if (occurrences !== 1) {
  throw new Error(
    `recovery continuation expected one gate insertion point, found ${occurrences}`,
  );
}
trainer = trainer.replace(
  insertion,
  `                "additionalRoutes": [
                    {
                        "allowedModes": ["recovery"],
                        "requiredObservation": {
                            "recovery-target-satisfied": 0.0,
                            "recovery-stable-latched": 0.0,
                        },
                        "requiredRuntimeState": {
                            "recoveryDeadlineExpired": 0.0,
                        },
                        "allowedTelemetry": {
                            "phase": [
                                "recovery.impulse",
                                "recovery.capture",
                                "recovery.rise",
                            ],
                            "measuredDelaySteps": [1, 2],
                        },
                        "maximumTelemetry": {
                            "modeDwellSeconds": 2.5,
                            "baseHeightM": 0.40,
                            "supportFeet": 3,
                        },
                    },
                ],
                "rampSeconds": 0,
                "entryRampSeconds": 0.4,
`,
);
await writeFile(trainerPath, trainer);

process.stdout.write(JSON.stringify({
  ...baseProposal,
  strategy: "program-anchored-reflex-to-recovery-continuation",
  hypothesis:
    "The Program-reference run produced bilateral actor-contributed target entry at step 32,768 while remaining below 0.0153 applied-residual RMS, but the early reflex gate closed as soon as the Program entered recovery, so no learned checkpoint produced stable recovery or a timeout-free Mission. Preserve the exact reference distribution, 0.05 RMS bound, lateral-only Action authority, local course, seed, budget, and Judge; add one causal recovery continuation route limited to Program impulse/capture/rise, the trained one/two-step delay set, open Task recovery latches, at most 2.5 seconds of recovery dwell, base height below 0.40 m, and no more than three support feet.",
  expectedEffect:
    "Let the same bounded lateral residual carry an improved post-impact basin through Program recovery long enough to satisfy stable recovery on both directions, while the Program reference prevents the continuation from erasing known complete-Mission behavior and the step-0 candidate remains the fallback.",
}));
