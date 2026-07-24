import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const request = JSON.parse(await new Response(Bun.stdin.stream()).text());
if (request.lab?.id !== "integrated-recovery-hybrid-policy") {
  throw new Error(
    "This bounded researcher only accepts the integrated-recovery-hybrid-policy Lab",
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
let recovery = await readFile(recoveryPath, "utf8");
let config = await readFile(configPath, "utf8");

const phaseFrom =
  "            if elapsed < impulse_seconds:\n" +
  "                self.phase = \"impulse\"\n" +
  "                target = impulse.copy()\n" +
  "            elif elapsed < capture_until_seconds:\n";
const phaseTo =
  "            initial_dynamic_side_capture = (\n" +
  "                self.dynamic_entry\n" +
  "                and self.retry_count == 0\n" +
  "                and pose in (\"left\", \"right\")\n" +
  "                and tilt <= self.config[\"dynamicSideCaptureTiltRad\"]\n" +
  "            )\n" +
  "            if elapsed < impulse_seconds and not initial_dynamic_side_capture:\n" +
  "                self.phase = \"impulse\"\n" +
  "                target = impulse.copy()\n" +
  "            elif elapsed < capture_until_seconds:\n";
if (!recovery.includes(phaseFrom)) {
  throw new Error(
    "Accepted recovery Controller no longer contains the expected timed impulse surface",
  );
}
recovery = recovery.replace(phaseFrom, phaseTo);

const configFrom = '      "minimumSupportFeet": 2\n';
const configTo =
  '      "minimumSupportFeet": 2,\n' +
  '      "dynamicSideCaptureTiltRad": 0.6\n';
if (!config.includes(configFrom)) {
  throw new Error(
    "Accepted recovery Controller no longer contains the expected support configuration",
  );
}
config = config.replace(configFrom, configTo);

await writeFile(recoveryPath, recovery);
await writeFile(configPath, config);

process.stdout.write(
  JSON.stringify({
    strategy: "initial-side-capture-plus-state-gated-settle-policy",
    hypothesis:
      "Restricting early capture to retry-zero dynamic side falls should make the degraded-left near-upright basin reachable without changing the degraded-right retry. A small residual with authority only in the observable stand envelope can damp the remaining program recovery limit cycle while leaving impact, impulse, capture, rise, retry, handoff, and locomotion program-only.",
    expectedEffect:
      "Recover impact-left-degraded or materially reduce its locked recovery violations while preserving both exact Missions, the degraded-right retry path, and every static and locomotion regression.",
  }),
);
