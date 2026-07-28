import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const request = JSON.parse(await new Response(Bun.stdin.stream()).text());
if (request.lab?.id !== "solo12-disturbance-controller") {
  throw new Error(
    "This bounded researcher only accepts the solo12-disturbance-controller Lab",
  );
}

const tried = new Set(
  (Array.isArray(request.history) ? request.history : [])
    .map((entry) => entry?.proposal?.strategy)
    .filter((value) => typeof value === "string"),
);

const candidates = [
  {
    strategy: "raise-joint-damping",
    kp: 5,
    kd: 0.18,
    hypothesis:
      "The baseline has ample torque headroom but the delayed/noisy diagonal case has the worst score, so additional joint damping should reduce post-impact velocity, jerk, and settling time without changing static support.",
    expectedEffect:
      "Improve delayed/noisy and lateral-push recovery quality while retaining nominal stance, zero saturation, and every gate.",
  },
  {
    strategy: "moderate-stiffness-damping",
    kp: 6,
    kd: 0.2,
    hypothesis:
      "If damping alone is insufficient, a small stiffness increase paired with damping should reject peak deflection while staying far below the 2.5 Nm actuator limit.",
    expectedEffect:
      "Reduce maximum tilt and time to stable stand across the four push directions without a material energy or action-slew regression.",
  },
  {
    strategy: "soft-high-damping",
    kp: 4.5,
    kd: 0.22,
    hypothesis:
      "If high stiffness is not rewarded, a slightly softer but more damped stance may dissipate the impulse with lower jerk and similar final stability.",
    expectedEffect:
      "Improve motion-quality costs while preserving recovery dwell, final height, and full survival.",
  },
];

const candidate = candidates.find((item) => !tried.has(item.strategy));
if (!candidate) {
  throw new Error("The bounded Solo12 gain hypotheses are exhausted");
}

const definitionPath = resolve(
  request.workspace,
  "controllers/solo12-balance-stand/controller.json",
);
const definition = JSON.parse(await readFile(definitionPath, "utf8"));
definition.config.kp = candidate.kp;
definition.config.kd = candidate.kd;
await writeFile(definitionPath, `${JSON.stringify(definition, null, 2)}\n`);

process.stdout.write(
  JSON.stringify({
    strategy: candidate.strategy,
    hypothesis: candidate.hypothesis,
    expectedEffect: candidate.expectedEffect,
  }),
);
