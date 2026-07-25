import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const request = JSON.parse(await new Response(Bun.stdin.stream()).text());
const child = Bun.spawn(
  ["bun", resolve(import.meta.dir, "lateral-momentum-reflex-agent.mjs")],
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
const gateStart = '            "residualGate": {\n';
const gateEnd = '            },\n        },\n    )\n';
if (
  trainer.split(gateStart).length - 1 !== 1 ||
  trainer.split(gateEnd).length - 1 !== 1
) {
  throw new Error("isolated lateral reflex could not locate one residual gate");
}
const start = trainer.indexOf(gateStart);
const end = trainer.indexOf(gateEnd, start);
trainer =
  trainer.slice(0, start) +
  `            "residualGate": {
                "kind": "prior-telemetry-mode",
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
                "rampSeconds": 0,
                "entryRampSeconds": 0.4,
` +
  trainer.slice(end);
await writeFile(trainerPath, trainer);

const trainingPath = resolve(
  request.workspace,
  "training/articulated-inverted-escape.training.json",
);
const training = JSON.parse(await readFile(trainingPath, "utf8"));
training.eliteReplay.trigger = "actor-contributed-recovery-target-entry";
await writeFile(trainingPath, `${JSON.stringify(training, null, 2)}\n`);

process.stdout.write(JSON.stringify({
  ...baseProposal,
  strategy: "isolated-causally-credited-lateral-reflex",
  hypothesis:
    "The first physical-reflex experiment opened the intended pre-fall route in every complete-Mission probe and advanced Program recovery on degraded-right from 6.06 to 5.00 seconds, but the old recovery route then retained learned authority for 3.70 seconds and the robot ended inverted. Isolate the causal variable by removing all learned authority after the Program enters recovery. Credit a later Task-target entry to the bounded actor interventions that preceded it in the same uninterrupted episode, so elite replay and checkpoint selection can consolidate a useful brace even though the fail-closed gate is correctly shut at the target crossing.",
  expectedEffect:
    "Preserve the Program's known self-righting trajectory after an ML-only momentum brace, eliminate residual gate activity during recovery and unrelated command-tracking regressions, admit complete-Mission early-reflex tails that causally precede a target entry, and improve both impact directions under the unchanged continuous Mission Judge.",
}));
