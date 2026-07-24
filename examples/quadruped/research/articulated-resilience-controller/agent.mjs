import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const request = JSON.parse(await new Response(Bun.stdin.stream()).text());
if (request.lab?.id !== "articulated-resilience-controller") {
  throw new Error(
    "This bounded researcher only accepts the articulated-resilience-controller Lab",
  );
}

const path = resolve(
  request.workspace,
  "controllers/articulated-behavior-supervisor/locomotion.py",
);
let source = await readFile(path, "utf8");

const resetFrom =
  "        self.traction_control_blend = 0.0\n" +
  "        self.command_restart_count = 0\n";
const resetTo =
  "        self.traction_control_blend = 0.0\n" +
  "        self.longitudinal_phase_direction = 1.0\n" +
  "        self.command_restart_count = 0\n";
const telemetryFrom =
  '            "tractionControlBlend": 0.0,\n' +
  '            "commandMode": None,\n';
const telemetryTo =
  '            "tractionControlBlend": 0.0,\n' +
  '            "longitudinalPhaseDirection": 1.0,\n' +
  '            "commandMode": None,\n';
const commandResetFrom =
  "            self.traction_recovery = False\n" +
  "            self.traction_recovery_severe = False\n";
const commandResetTo =
  "            self.traction_recovery = False\n" +
  "            self.traction_recovery_severe = False\n" +
  "            self.longitudinal_phase_direction = 1.0\n";
const classifierFrom =
  "            if delay == 0:\n" +
  "                deficit = self.traction_command_progress - self.traction_measured_progress\n" +
  "                if self.traction_elapsed <= self.config[\"tractionRecoveryAssessmentSeconds\"] and deficit > self.config[\"tractionRecoveryProgressDeficitM\"]:\n" +
  "                    if not self.traction_recovery:\n" +
  "                        self.traction_recovery_started_at = time_seconds\n" +
  "                    self.traction_recovery = True\n" +
  "            elif delay >= self.config[\"delayedTractionMinimumDelaySteps\"]";
const classifierTo =
  "            deficit = self.traction_command_progress - self.traction_measured_progress\n" +
  "            if delay == 0:\n" +
  "                if self.traction_elapsed <= self.config[\"tractionRecoveryAssessmentSeconds\"] and deficit > self.config[\"tractionRecoveryProgressDeficitM\"]:\n" +
  "                    if not self.traction_recovery:\n" +
  "                        self.traction_recovery_started_at = time_seconds\n" +
  "                    self.traction_recovery = True\n" +
  "            elif 0 < delay < self.config[\"delayedTractionMinimumDelaySteps\"]:\n" +
  "                if self.traction_elapsed <= self.config[\"tractionRecoveryAssessmentSeconds\"] and deficit > self.config[\"tractionRecoveryProgressDeficitM\"]:\n" +
  "                    self.longitudinal_phase_direction = -1.0\n" +
  "            elif delay >= self.config[\"delayedTractionMinimumDelaySteps\"]";
const legacyPhaseFrom =
  "        phase = 2.0 * np.pi * self.config[\"frequencyHz\"] * (time_seconds + phase_lead)\n";
const legacyPhaseTo =
  "        phase = self.longitudinal_phase_direction * 2.0 * np.pi * self.config[\"frequencyHz\"] * (time_seconds + phase_lead)\n";
const liveTelemetryFrom =
  '            "tractionControlBlend": self.traction_control_blend,\n' +
  '            "commandMode": self.motion_mode,\n';
const liveTelemetryTo =
  '            "tractionControlBlend": self.traction_control_blend,\n' +
  '            "longitudinalPhaseDirection": self.longitudinal_phase_direction,\n' +
  '            "commandMode": self.motion_mode,\n';

for (const [from, to, label] of [
  [resetFrom, resetTo, "reset state"],
  [telemetryFrom, telemetryTo, "initial telemetry"],
  [commandResetFrom, commandResetTo, "command boundary reset"],
  [classifierFrom, classifierTo, "low-delay progress classifier"],
  [legacyPhaseFrom, legacyPhaseTo, "legacy phase direction"],
]) {
  if (!source.includes(from)) {
    throw new Error(`Accepted Controller no longer contains the expected ${label} surface`);
  }
  source = source.replace(from, to);
}

const telemetryOccurrences = source.split(liveTelemetryFrom).length - 1;
if (telemetryOccurrences !== 2) {
  throw new Error(
    `Expected two live locomotion telemetry surfaces, found ${telemetryOccurrences}`,
  );
}
source = source.split(liveTelemetryFrom).join(liveTelemetryTo);

await writeFile(path, source);

process.stdout.write(
  JSON.stringify({
    strategy: "measured-low-delay-phase-direction-fallback",
    hypothesis:
      "The degraded Mission moves backward before impact because delay-one falls between the zero-delay progress classifier and the three-step contact-loss classifier. Latching a reversed longitudinal gait direction only after an observable early progress deficit should recover approach direction without applying the unsafe 1.8 sagittal traction scale or reading Scenario identity.",
    expectedEffect:
      "Improve signed approach and complete-Mission progress in both degraded impact Cases, preserve exact delay-zero Missions, and introduce no collision, joint-limit, command, or atomic recovery regression.",
  }),
);
