import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const request = JSON.parse(await new Response(Bun.stdin.stream()).text());
const child = Bun.spawn(
  ["bun", resolve(import.meta.dir, "bilateral-symmetry-agent.mjs")],
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
    `lateral momentum reflex expected one residual gate insertion point, found ${occurrences}`,
  );
}
trainer = trainer.replace(
  insertion,
  `                "additionalRoutes": [
                    {
                        "allowedModes": ["locomotion"],
                        "requiredObservation": {
                            "recovery-target-satisfied": 0.0,
                            "recovery-stable-latched": 0.0,
                        },
                        "requiredRuntimeState": {
                            "recoveryDeadlineExpired": 0.0,
                        },
                        "allowedTelemetry": {
                            "measuredDelaySteps": [1, 2],
                        },
                        "minimumTelemetry": {
                            "modeDwellSeconds": 1.0,
                            "absoluteLateralVelocityMps": 0.4,
                        },
                        "maximumTelemetry": {
                            "bodyTiltRad": 0.8,
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
  strategy: "physical-lateral-momentum-reflex",
  hypothesis:
    "The rejected bilateral run exposed a causal authority mismatch: the continuous Mission impact ends at 2.68 seconds, but the Program does not enter recovery until 6.06 seconds, leaving only 2.62 seconds of the Task's six-second recovery budget. Keep the complete Mission, physical impact loads, delay envelope, bilateral ABI, reward, seed, training budget, and Judge fixed. Add a second fail-closed authority route while the Program is still in locomotion, triggered only by measured one/two-step delay, at least one second of startup dwell, absolute lateral base speed at or above 0.4 m/s, body tilt below the Program's 0.8 rad fall threshold, and open Task recovery latches.",
  expectedEffect:
    "Let PPO learn a signed, bilaterally consistent brace during the physically observed momentum excursion before full fall, record actor-before-Program episodes and recovered budget explicitly, then reduce recovery timeouts in both impact directions without weakening any Scenario, Task target, Mission phase, or locked promotion gate.",
}));
