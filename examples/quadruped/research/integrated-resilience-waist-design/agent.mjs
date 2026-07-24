import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const request = JSON.parse(await new Response(Bun.stdin.stream()).text());
if (request.lab?.id !== "integrated-resilience-waist-design") {
  throw new Error(
    "This bounded researcher only accepts the integrated-resilience-waist-design Lab",
  );
}

const strategy = "rollover-keel-with-geometry-conditioned-recovery-damping";
const triedStrategies = new Set(
  (Array.isArray(request.history) ? request.history : [])
    .map((entry) => entry?.proposal?.strategy)
    .filter((value) => typeof value === "string"),
);
if (triedStrategies.has(strategy)) {
  // Null is the Research Lab V2 exhaustion signal. The keel family has already
  // been judged; repeating it would create no new causal evidence.
  process.stdout.write("null");
  process.exit(0);
}

const modelPath = resolve(
  request.workspace,
  "robots/quadruped-waist-3dof/model.xml",
);
const robotPath = resolve(
  request.workspace,
  "robots/quadruped-waist-3dof/robot.json",
);
const controllerPath = resolve(
  request.workspace,
  "controllers/articulated-behavior-supervisor/controller.json",
);
let model = await readFile(modelPath, "utf8");
const robot = JSON.parse(await readFile(robotPath, "utf8"));
const controller = JSON.parse(await readFile(controllerPath, "utf8"));

if (model.includes('name="front-rollover-keel"')) {
  throw new Error("The segmented rollover keel is already present");
}

const frontTorso =
  '      <geom name="front-torso-geom" type="box" pos="0.13 0 0" size="0.12 0.15 0.06" mass="2" rgba="0.24 0.48 0.82 1"/>';
const rearTorso =
  '          <geom name="rear-torso-geom" type="box" pos="-0.13 0 0" size="0.12 0.15 0.06" mass="2.1" rgba="0.18 0.38 0.72 1"/>';
if (!model.includes(frontTorso) || !model.includes(rearTorso)) {
  throw new Error("The articulated torso geometry no longer matches the bounded design surface");
}

model = model.replace(
  frontTorso,
  `${frontTorso}
      <geom name="front-rollover-keel" type="capsule" fromto="0.08 0 0.095 0.245 0 0.095" size="0.035" mass="0.03" rgba="0.95 0.56 0.18 1"/>`,
);
model = model.replace(
  rearTorso,
  `${rearTorso}
          <geom name="rear-rollover-keel" type="capsule" fromto="-0.245 0 0.095 -0.08 0 0.095" size="0.035" mass="0.03" rgba="0.95 0.56 0.18 1"/>`,
);

robot.name = "Fourteen-actuator split-torso quadruped with segmented rollover keel";
robot.massKg = 6.18;
robot.attribution =
  "Original two-axis articulated quadruped and segmented dorsal rollover keel created for Mujica";

const recovery = controller.config.recovery;
recovery.kdSagittal = 3.0;
const dynamicWaistMagnitude = 0.14;
recovery.waistImpulseTargetByPose = {
  front: [0, dynamicWaistMagnitude],
  back: [0, -dynamicWaistMagnitude],
  left: [dynamicWaistMagnitude, 0],
  right: [-dynamicWaistMagnitude, 0],
  upright: [0, 0],
};
recovery.waistCaptureTargetByPose = {
  front: [0, -dynamicWaistMagnitude * 0.35],
  back: [0, dynamicWaistMagnitude * 0.35],
  left: [-dynamicWaistMagnitude * 0.35, 0],
  right: [dynamicWaistMagnitude * 0.35, 0],
  upright: [0, 0],
};

await writeFile(modelPath, model);
await writeFile(robotPath, `${JSON.stringify(robot, null, 2)}\n`);
await writeFile(controllerPath, `${JSON.stringify(controller, null, 2)}\n`);

process.stdout.write(
  JSON.stringify({
    strategy,
    hypothesis:
      "The useful 130 mm keel changes the recovery plant, so retaining the old recovery gains is not a fair complete-robot design. Raising only static sagittal recovery damping from 2.4 to 3.0 should contain the observed front-knee and back-hip overshoot, while reducing retry-only waist targets from 0.18 to 0.14 rad should preserve the keel's inverted-basin escape with less yaw and collision disturbance.",
    expectedEffect:
      "Preserve all previously passing Mission, self-righting, handoff, and command-tracking gates while retaining the clearance keel's lower violation severity and improved Mission score.",
  }),
);
