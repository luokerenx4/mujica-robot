import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const request = JSON.parse(await new Response(Bun.stdin.stream()).text());
if (request.lab?.id !== "integrated-resilience-controller") {
  throw new Error(
    "This bounded researcher only accepts the integrated-resilience-controller Lab",
  );
}

const recoveryPath = resolve(
  request.workspace,
  "controllers/behavior-supervisor/recovery.py",
);
const configPath = resolve(
  request.workspace,
  "controllers/behavior-supervisor/controller.json",
);
let source = await readFile(recoveryPath, "utf8");
const config = JSON.parse(await readFile(configPath, "utf8"));

const phaseFrom =
  "            if elapsed < impulse_seconds:\n" +
  "                self.phase = \"impulse\"\n" +
  "                target = impulse.copy()\n" +
  "            elif elapsed < capture_until_seconds:\n";
const phaseTo =
  "            dynamic_side_capture = (\n" +
  "                self.dynamic_entry\n" +
  "                and self.retry_count == 0\n" +
  "                and pose in (\"left\", \"right\")\n" +
  "                and tilt <= self.config[\"dynamicSideCaptureTiltRad\"]\n" +
  "            )\n" +
  "            if elapsed < impulse_seconds and not dynamic_side_capture:\n" +
  "                self.phase = \"impulse\"\n" +
  "                target = impulse.copy()\n" +
  "            elif elapsed < capture_until_seconds:\n";
const feedbackFrom =
  "                target = (1.0 - alpha) * capture + alpha * self.stand_target\n" +
  "                target = self.stabilized_target(\n" +
  "                    target,\n" +
  "                    roll,\n" +
  "                    pitch,\n" +
  "                    velocity[3:6],\n" +
  "                    pose,\n" +
  "                )\n";
const feedbackTo =
  "                target = (1.0 - alpha) * capture + alpha * self.stand_target\n" +
  "                dynamic_side_stand = (\n" +
  "                    self.dynamic_entry\n" +
  "                    and self.retry_count == 0\n" +
  "                    and pose in (\"left\", \"right\")\n" +
  "                    and alpha >= 1.0\n" +
  "                )\n" +
  "                if dynamic_side_stand:\n" +
  "                    self.phase = \"settle\"\n" +
  "                else:\n" +
  "                    target = self.stabilized_target(\n" +
  "                        target,\n" +
  "                        roll,\n" +
  "                        pitch,\n" +
  "                        velocity[3:6],\n" +
  "                        pose,\n" +
  "                    )\n";
for (const [from, to, label] of [
  [phaseFrom, phaseTo, "timed side impulse"],
  [feedbackFrom, feedbackTo, "late recovery pose feedback"],
]) {
  if (!source.includes(from)) {
    throw new Error(
      `Accepted recovery Controller no longer contains the expected ${label} surface`,
    );
  }
  source = source.replace(from, to);
}
config.config.recovery.dynamicSideCaptureTiltRad = 0.6;

await writeFile(recoveryPath, source);
await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

process.stdout.write(
  JSON.stringify({
    strategy: "initial-side-capture-with-feedback-free-final-stand",
    hypothesis:
      "Early capture moves the initial degraded side fall out of the inverted basin. The near-feasible candidate lost posture because it replaced the gradual rise too early, while the first candidate reached full height but kept injecting roll/pitch feedback after alpha reached one. Preserving the complete rise and disabling only that feedback at the final stand should keep support while removing the limit cycle.",
    expectedEffect:
      "Qualify or materially stabilize impact-left-degraded, preserve the baseline right-degraded retry and every exact/static path, and remove the remaining recovery-induced transition regression.",
  }),
);
