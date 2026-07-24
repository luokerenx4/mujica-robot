import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const request = JSON.parse(await new Response(Bun.stdin.stream()).text());
if (request.lab?.id !== "integrated-resilience-controller") {
  throw new Error(
    "This bounded researcher only accepts the integrated-resilience-controller Lab",
  );
}

const path = resolve(
  request.workspace,
  "controllers/behavior-supervisor/controller.py",
);
let source = await readFile(path, "utf8");

const initFrom =
  "        self.base_locomotion_gait = {\n" +
  "            \"hipAmplitude\": self.locomotion.config[\"hipAmplitude\"],\n" +
  "            \"kneeAmplitude\": self.locomotion.config[\"kneeAmplitude\"],\n" +
  "        }\n";
const initTo =
  initFrom +
  "        self.base_force_world_frame_tracking = bool(\n" +
  "            self.locomotion.config.get(\"forceWorldFrameTracking\", False)\n" +
  "        )\n" +
  "        self.base_post_recovery_yaw_gains = {\n" +
  "            key: float(self.locomotion.config[key])\n" +
  "            for key in (\n" +
  "                \"yawHipDifferential\",\n" +
  "                \"negativeYawHipDifferential\",\n" +
  "                \"yawAbductionDifferential\",\n" +
  "                \"negativeYawAbductionDifferential\",\n" +
  "            )\n" +
  "        }\n";
const resetFrom =
  "        self.locomotion.config.update(self.base_locomotion_gait)\n" +
  "        self.locomotion.reset(seed)\n";
const resetTo =
  "        self.locomotion.config.update(self.base_locomotion_gait)\n" +
  "        self.locomotion.config[\"forceWorldFrameTracking\"] = (\n" +
  "            self.base_force_world_frame_tracking\n" +
  "        )\n" +
  "        self.locomotion.config.update(self.base_post_recovery_yaw_gains)\n" +
  "        self.post_recovery_yaw_authority_scale = 1.0\n" +
  "        self.locomotion.reset(seed)\n";
const settlingFrom =
  "        elif mode == \"settling\":\n" +
  "            self.handoff_streak = 0\n" +
  "            self.locomotion.reset(self.seed + self.transition_count)\n";
const settlingTo =
  "        elif mode == \"settling\":\n" +
  "            self.handoff_streak = 0\n" +
  "            self.locomotion.config[\"forceWorldFrameTracking\"] = True\n" +
  "            for key, value in self.base_post_recovery_yaw_gains.items():\n" +
  "                self.locomotion.config[key] = (\n" +
  "                    self.post_recovery_yaw_authority_scale * value\n" +
  "                )\n" +
  "            self.locomotion.reset(self.seed + self.transition_count)\n";
const qualifiedFrom =
  "            if child[\"targetStreakSteps\"] >= required_target_steps:\n" +
  "                gait = self.config[\"postRecoveryGaitByPose\"][self.recovery_pose]\n";
const qualifiedTo =
  "            if child[\"targetStreakSteps\"] >= required_target_steps:\n" +
  "                quaternion = np.asarray(\n" +
  "                    observation[\"base-orientation\"], dtype=np.float64\n" +
  "                )\n" +
  "                w, x, y, z = quaternion\n" +
  "                handoff_yaw = float(\n" +
  "                    np.arctan2(\n" +
  "                        2.0 * (w * z + x * y),\n" +
  "                        1.0 - 2.0 * (y * y + z * z),\n" +
  "                    )\n" +
  "                )\n" +
  "                self.post_recovery_yaw_authority_scale = (\n" +
  "                    0.75 if handoff_yaw >= 0.0 else 1.0\n" +
  "                )\n" +
  "                gait = self.config[\"postRecoveryGaitByPose\"][self.recovery_pose]\n";
for (const [from, to, label] of [
  [initFrom, initTo, "initial locomotion identity"],
  [resetFrom, resetTo, "episode reset"],
  [settlingFrom, settlingTo, "post-recovery settling"],
  [qualifiedFrom, qualifiedTo, "qualified recovery heading"],
]) {
  if (!source.includes(from)) {
    throw new Error(`Accepted controller no longer contains expected ${label} surface`);
  }
  source = source.replace(from, to);
}
await writeFile(path, source);

process.stdout.write(
  JSON.stringify({
    strategy: "measured-heading-conditioned-yaw-authority",
    hypothesis:
      "The two exact recoveries reach the same pose state with opposite measured yaw signs. Full yaw authority keeps the negative-heading case settled, while 75 percent authority keeps the positive-heading case below the overshoot gate. Selecting that bounded authority from measured handoff yaw should combine both safe responses without Scenario knowledge.",
    expectedEffect:
      "Keep both exact Missions below yaw overshoot and settling gates while retaining the world-frame score/severity improvement and preserving pre-impact, recovery, and no-fall regressions.",
  }),
);
