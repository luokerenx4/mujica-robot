import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const request = JSON.parse(await new Response(Bun.stdin.stream()).text());
if (request.lab?.id !== "robust-transfer-controller") {
  throw new Error("This bounded researcher only accepts the robust-transfer-controller Lab");
}

const path = resolve(request.workspace, "controllers/bounded-traction-gait/controller.json");
const controller = JSON.parse(await readFile(path, "utf8"));
controller.config.tractionRecoveryProgressDeficitM = 0.08;
controller.config.tractionRecoveryHipScale = 1.55;
controller.config.tractionRecoverySevereBackwardPitchRad = 0.1;
controller.config.tractionRecoverySevereHipScale = 1.35;
await writeFile(path, `${JSON.stringify(controller, null, 2)}\n`);

process.stdout.write(JSON.stringify({
  strategy: "early-gentle-recovery",
  hypothesis: "The heavy weak plant needs traction-loss detection before backward momentum grows, but lower ordinary and severe hip authority should avoid the pitch and saturation divergence caused by the existing late aggressive recovery.",
  expectedEffect: "Reduce heavy-weak backward displacement, pitch, tilt, saturation, and fall risk without regressing light-strong, upright locomotion, or motion quality.",
}));
