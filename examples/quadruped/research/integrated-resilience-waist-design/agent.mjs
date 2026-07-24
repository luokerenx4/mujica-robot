import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const request = JSON.parse(await new Response(Bun.stdin.stream()).text());
if (request.lab?.id !== "integrated-resilience-waist-design") {
  throw new Error("This bounded researcher only accepts the integrated-resilience-waist-design Lab");
}

const path = resolve(
  request.workspace,
  "controllers/articulated-behavior-supervisor/controller.json",
);
const controller = JSON.parse(await readFile(path, "utf8"));
const direction = request.history.length % 2 === 0 ? 1 : -1;
const magnitude = request.history.length < 2 ? 0.5 : 0.32;

controller.config.recovery.waistImpulseTargetByPose = {
  front: [0, direction * magnitude],
  back: [0, -direction * magnitude],
  left: [direction * magnitude, 0],
  right: [-direction * magnitude, 0],
  upright: [0, 0],
};
controller.config.recovery.waistCaptureTargetByPose = {
  front: [0, -direction * magnitude * 0.4],
  back: [0, direction * magnitude * 0.4],
  left: [-direction * magnitude * 0.4, 0],
  right: [direction * magnitude * 0.4, 0],
  upright: [0, 0],
};
await writeFile(path, `${JSON.stringify(controller, null, 2)}\n`);

process.stdout.write(JSON.stringify({
  strategy: direction > 0 ? "pose-directed-waist-impulse" : "sign-reversed-waist-impulse",
  hypothesis: direction > 0
    ? "The neutral waist behaves as added passive complexity. A pose-directed roll or pitch impulse followed by a smaller counter-bend should move the split torso out of the inverted contact basin before the leg rise phase."
    : "The first waist moment may have driven the rear torso into the support surface. Reversing only the pose-conditioned waist moment tests the mechanical sign while preserving leg sequencing and all locked inputs.",
  expectedEffect: "Increase recovery-target occupancy and stable-standing dwell while reducing final tilt, joint-limit use, and self-contact on the same continuous Mission.",
}));
