import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const request = JSON.parse(await new Response(Bun.stdin.stream()).text());
if (request.lab?.id !== "self-righting-rigid-controller") {
  throw new Error("This bounded researcher only accepts the self-righting-rigid-controller Lab");
}

const path = resolve(request.workspace, "controllers/rigid-self-right/controller.py");
let source = await readFile(path, "utf8");
const from = "            self.recovery_direction = 1.0 if (roll if abs(roll) >= abs(pitch) else pitch) >= 0.0 else -1.0\n";
const to = "            self.recovery_direction = -1.0 if (roll if abs(roll) >= abs(pitch) else pitch) >= 0.0 else 1.0\n";
if (!source.includes(from)) {
  throw new Error("The accepted latched-direction controller is not the current Lab head");
}
source = source.replace(from, to);
await writeFile(path, source);

process.stdout.write(JSON.stringify({
  strategy: "upright-directed-roll",
  hypothesis: "The accepted latch preserves direction through the singularity, but the four traces still end inverted because its sign drives away from world-up. Inverting only the latched sign should send the same bounded maneuver toward upright instead.",
  expectedEffect: "Lower minimum and final body tilt, avoid crossing into the inverted basin, and enter the stable-standing target in at least one fixed fallen-pose case.",
}));
