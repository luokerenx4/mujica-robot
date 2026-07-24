import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const request = JSON.parse(await new Response(Bun.stdin.stream()).text());
if (request.lab?.id !== "integrated-resilience-waist-design") {
  throw new Error(
    "This bounded researcher only accepts the integrated-resilience-waist-design Lab",
  );
}

const triedStrategies = new Set(
  (Array.isArray(request.history) ? request.history : [])
    .map((entry) => entry?.proposal?.strategy)
    .filter((value) => typeof value === "string"),
);

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
const recoveryPath = resolve(
  request.workspace,
  "controllers/articulated-behavior-supervisor/recovery.py",
);
let model = await readFile(modelPath, "utf8");
const robot = JSON.parse(await readFile(robotPath, "utf8"));
const controller = JSON.parse(await readFile(controllerPath, "utf8"));
let recoverySource = await readFile(recoveryPath, "utf8");

if (model.includes("rollover-keel")) {
  throw new Error("The exhausted rollover-keel family must remain reverted");
}

function replaceExact(source, before, after, label) {
  const occurrences = source.split(before).length - 1;
  if (occurrences !== 1) {
    throw new Error(`${label} expected one source match, found ${occurrences}`);
  }
  return source.replace(before, after);
}

function applyLateralGeometry({
  shoulderY,
  abductionRange,
  footRadius,
  footMass,
}) {
  const shoulderPairs = [
    ["leg-fl-abductor", "0.20 0.14 0", `0.20 ${shoulderY} 0`],
    ["leg-fr-abductor", "0.20 -0.14 0", `0.20 -${shoulderY} 0`],
    ["leg-rl-abductor", "-0.20 0.14 0", `-0.20 ${shoulderY} 0`],
    ["leg-rr-abductor", "-0.20 -0.14 0", `-0.20 -${shoulderY} 0`],
  ];
  for (const [name, beforePosition, afterPosition] of shoulderPairs) {
    model = replaceExact(
      model,
      `<body name="${name}" pos="${beforePosition}">`,
      `<body name="${name}" pos="${afterPosition}">`,
      `${name} shoulder mount`,
    );
  }
  for (const joint of ["abd-fl", "abd-fr", "abd-rl", "abd-rr"]) {
    model = replaceExact(
      model,
      `<joint name="${joint}" axis="1 0 0" range="-0.65 0.65"/>`,
      `<joint name="${joint}" axis="1 0 0" range="-${abductionRange} ${abductionRange}"/>`,
      `${joint} range`,
    );
  }
  for (const foot of ["fl", "fr", "rl", "rr"]) {
    const x = foot.startsWith("f") ? "-0.04" : "0.04";
    model = replaceExact(
      model,
      `<geom name="foot-${foot}" type="sphere" pos="${x} 0 -0.21" size="0.035" mass="0.06" rgba="0.9 0.35 0.2 1"/>`,
      `<geom name="foot-${foot}" type="sphere" pos="${x} 0 -0.21" size="${footRadius}" mass="${footMass}" rgba="0.9 0.35 0.2 1"/>`,
      `foot-${foot} geometry`,
    );
  }
}

function configureAbductionLimit(limit) {
  const recovery = controller.config.recovery;
  recovery.maximumAbsoluteAbductionTargetRad = limit;
  recovery.maximumAbsoluteAbductionTargetRadByPose = {
    front: limit,
    back: limit,
    left: limit,
    right: limit,
    upright: Math.min(limit, 0.6),
  };
}

function addInvertedBrace({
  tiltRad,
  abductionRad,
  hipRad,
  kneeRad,
  minimumSupportFeet,
  waistAssistRad = 0,
}) {
  const recovery = controller.config.recovery;
  Object.assign(recovery, {
    invertedBraceTiltRad: tiltRad,
    invertedBraceAbductionRad: abductionRad,
    invertedBraceHipRad: hipRad,
    invertedBraceKneeRad: kneeRad,
    invertedBraceMinimumSupportFeet: minimumSupportFeet,
    invertedBraceWaistAssistRad: waistAssistRad,
  });
  const insertion =
    `                waist_target = (1.0 - alpha) * waist_capture\n`;
  const replacement =
    `                if (\n` +
    `                    self.dynamic_entry\n` +
    `                    and tilt >= self.config["invertedBraceTiltRad"]\n` +
    `                    and support_feet < self.config["invertedBraceMinimumSupportFeet"]\n` +
    `                ):\n` +
    `                    self.phase = "inverted-brace"\n` +
    `                    target[:, 0] = SIDE * self.config["invertedBraceAbductionRad"]\n` +
    `                    target[:, 1] = FRONT * self.config["invertedBraceHipRad"]\n` +
    `                    target[:, 2] = self.config["invertedBraceKneeRad"]\n` +
    `                    waist_assist = self.config["invertedBraceWaistAssistRad"]\n` +
    `                    if pose == "front":\n` +
    `                        waist_target = np.asarray([0.0, waist_assist])\n` +
    `                    elif pose == "back":\n` +
    `                        waist_target = np.asarray([0.0, -waist_assist])\n` +
    `                    elif pose == "left":\n` +
    `                        waist_target = np.asarray([waist_assist, 0.0])\n` +
    `                    else:\n` +
    `                        waist_target = np.asarray([-waist_assist, 0.0])\n` +
    `                else:\n` +
    `                    waist_target = (1.0 - alpha) * waist_capture\n`;
  recoverySource = replaceExact(
    recoverySource,
    insertion,
    replacement,
    "inverted brace insertion",
  );
}

const strategies = [
  {
    strategy: "lateral-reach-expanded-abduction-workspace",
    hypothesis:
      "The inverted Mission failure is a foot-workspace failure rather than a need for another torso contact. Moving each hip mount 40 mm outward and expanding abduction travel from 0.65 to 1.0 rad gives the existing recovery sequence a wider four-foot support envelope without adding contacts, actions, sensors, or mass.",
    expectedEffect:
      "Create at least one additional foot-support opportunity after target loss while preserving ordinary command tracking and all four declared foot contacts.",
    apply() {
      applyLateralGeometry({
        shoulderY: "0.18",
        abductionRange: "1.0",
        footRadius: "0.035",
        footMass: "0.06",
      });
      configureAbductionLimit(0.9);
      robot.name =
        "Fourteen-actuator split-torso quadruped with expanded lateral hip workspace";
      robot.attribution =
        "Original two-axis articulated quadruped with laterally relocated hip mounts created for Mujica";
    },
  },
  {
    strategy: "lateral-reach-contact-seeking-inverted-brace",
    hypothesis:
      "Expanded joint range cannot help if the rise phase interpolates back to an upright stance while the torso is inverted. A contact-seeking brace should use the same four feet, 1.2 rad abduction travel, and a bounded inverted-only target until two feet regain support.",
    expectedEffect:
      "Turn the observed zero-support inverted plateau into a two-foot support event, then allow the existing waist and phased recovery to continue without changing locomotion commands.",
    apply() {
      applyLateralGeometry({
        shoulderY: "0.18",
        abductionRange: "1.2",
        footRadius: "0.04",
        footMass: "0.07",
      });
      configureAbductionLimit(1.12);
      addInvertedBrace({
        tiltRad: 2.2,
        abductionRad: 1.05,
        hipRad: 0.16,
        kneeRad: -0.35,
        minimumSupportFeet: 2,
      });
      robot.name =
        "Fourteen-actuator split-torso quadruped with contact-seeking lateral brace";
      robot.massKg = 6.16;
      robot.attribution =
        "Original two-axis articulated quadruped with enlarged four-foot recovery workspace created for Mujica";
    },
  },
  {
    strategy: "lateral-reach-low-clearance-inverted-brace",
    hypothesis:
      "If the first brace still leaves the feet above the floor, a straighter knee and 70 mm additional abduction should lower the existing foot contacts without adding passive supports. A smaller 30 mm shoulder offset limits the ordinary-gait moment-arm penalty.",
    expectedEffect:
      "Lower at least two foot sites to the floor during the inverted plateau while retaining positive joint-limit margin and the complete Mission command phases.",
    apply() {
      applyLateralGeometry({
        shoulderY: "0.17",
        abductionRange: "1.25",
        footRadius: "0.04",
        footMass: "0.07",
      });
      configureAbductionLimit(1.2);
      addInvertedBrace({
        tiltRad: 2.1,
        abductionRad: 1.12,
        hipRad: 0.1,
        kneeRad: -0.18,
        minimumSupportFeet: 2,
      });
      robot.name =
        "Fourteen-actuator split-torso quadruped with low-clearance inverted brace";
      robot.massKg = 6.16;
      robot.attribution =
        "Original two-axis articulated quadruped with low-clearance four-foot recovery workspace created for Mujica";
    },
  },
  {
    strategy: "lateral-reach-contact-conditioned-waist-assist",
    hypothesis:
      "Foot contact alone may create a symmetric inverted support deadlock. Reusing the bounded waist only while the contact-seeking brace is active should bias the torso off that support line; the assist ends as soon as two feet support the robot.",
    expectedEffect:
      "Convert inverted brace contact into decreasing body tilt and stable recovery without paying for a permanent torso keel or weakening any collision gate.",
    apply() {
      applyLateralGeometry({
        shoulderY: "0.18",
        abductionRange: "1.2",
        footRadius: "0.04",
        footMass: "0.07",
      });
      configureAbductionLimit(1.12);
      addInvertedBrace({
        tiltRad: 2.2,
        abductionRad: 1.05,
        hipRad: 0.16,
        kneeRad: -0.35,
        minimumSupportFeet: 2,
        waistAssistRad: 0.22,
      });
      robot.name =
        "Fourteen-actuator split-torso quadruped with contact-conditioned waist-assisted brace";
      robot.massKg = 6.16;
      robot.attribution =
        "Original two-axis articulated quadruped with waist-assisted four-foot recovery workspace created for Mujica";
    },
  },
];

const selected = strategies.find(
  (candidate) => !triedStrategies.has(candidate.strategy),
);
if (!selected) {
  // Null is the Research Lab V2 exhaustion signal. Every bounded point in this
  // lateral-reach family already has immutable Judge evidence.
  process.stdout.write("null");
  process.exit(0);
}

selected.apply();
await writeFile(modelPath, model);
await writeFile(robotPath, `${JSON.stringify(robot, null, 2)}\n`);
await writeFile(controllerPath, `${JSON.stringify(controller, null, 2)}\n`);
await writeFile(recoveryPath, recoverySource);

process.stdout.write(
  JSON.stringify({
    strategy: selected.strategy,
    hypothesis: selected.hypothesis,
    expectedEffect: selected.expectedEffect,
  }),
);
