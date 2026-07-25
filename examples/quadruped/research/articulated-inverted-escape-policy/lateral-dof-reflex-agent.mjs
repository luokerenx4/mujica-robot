import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const request = JSON.parse(await new Response(Bun.stdin.stream()).text());
const child = Bun.spawn(
  ["bun", resolve(import.meta.dir, "isolated-lateral-reflex-agent.mjs")],
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
const fullBodyScale =
  '            "residualScaleByAction": [\n' +
  "                0.30, 0.30, 0.30,\n" +
  "                0.30, 0.30, 0.30,\n" +
  "                0.30, 0.30, 0.30,\n" +
  "                0.30, 0.30, 0.30,\n" +
  "                1.50, 1.50,\n" +
  "            ],\n";
const occurrences = trainer.split(fullBodyScale).length - 1;
if (occurrences !== 1) {
  throw new Error(
    `lateral DOF reflex expected one full-body authority vector, found ${occurrences}`,
  );
}
trainer = trainer.replace(
  fullBodyScale,
  `            "residualScaleByAction": [
                0.30, 0.00, 0.00,
                0.30, 0.00, 0.00,
                0.30, 0.00, 0.00,
                0.30, 0.00, 0.00,
                1.00, 0.00,
            ],
`,
);
await writeFile(trainerPath, trainer);

process.stdout.write(JSON.stringify({
  ...baseProposal,
  strategy: "lateral-dof-causally-credited-reflex",
  hypothesis:
    "The isolated early-reflex checkpoint produced Task-target entries after actor intervention on both exact impact directions and improved degraded-left self-righting to 7.30 seconds, but only 12 actor steps made degraded-right unrecoverable. The 14-DOF residual was allowed to perturb sagittal hip/knee torques and waist pitch even though its trigger is a lateral momentum excursion. Preserve the same continuous Mission, timing gate, causal replay, bilateral contract, reward, and budget, but restrict learned authority to the four leg abduction motors and waist roll; the Program retains every sagittal and pitch action.",
  expectedEffect:
    "Keep the useful signed lateral brace while preventing the short Policy window from moving the robot into a sagittally unrecoverable basin, preserve degraded-right Program self-righting, and remove command-tracking and recovery-handoff regressions without changing the physical scenarios or Judge.",
}));
