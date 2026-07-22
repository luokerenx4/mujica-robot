# Motion command contract

## Decision

Task version 2 replaces the ambiguous `targetVelocity: [x, y, z]` tuple with an explicit constant episode command:

```json
{
  "motionCommand": {
    "frame": "world",
    "linearVelocityMps": [0.25, 0],
    "yawRateRadPerSec": 0
  }
}
```

The executable Controller input is the `motion-command` channel with ordered values `[world-vx-m/s, world-vy-m/s, body-yaw-rate-rad/s]`. The mixed frame is intentional: MuJoCo free-joint linear velocities are global while rotational velocities are local to the body. The Runtime compares this channel to `qvel[0]`, `qvel[1]`, and `qvel[5]` respectively. See the [MuJoCo free-joint semantics](https://mujoco.readthedocs.io/en/3.3.0/overview.html#floating-objects).

Authored commands are bounded to `[-1, 1] m/s` on each planar axis and `[-2, 2] rad/s` in yaw. A command is constant from reset through the episode in Task v2. Command channels are exact Runtime intent: Scenario observation noise neither alters them nor consumes the sensor-noise RNG stream, so adding command input cannot perturb otherwise identical sensor samples.

`motion-command-input` is a zero-mass Runtime Component. Assemblies opt into the channel explicitly, so existing learned Policy observation hashes and fixed-command Program Controllers remain valid. A command-consuming Controller must declare the channel in its Program Controller interface and is rejected before Runtime execution on an Assembly that does not provide it.

## Evidence

Every new trajectory row records both `motionCommand` and `measuredMotion` in the same order. Run metrics record the command, mean measured motion, task-level planar/yaw error between those episode means, and mean instantaneous errors for gait diagnostics. Capability gates use the task-level errors: averaging instantaneous absolute error would incorrectly punish the deliberate within-stride velocity oscillation of a legged gait. This makes command tracking directly inspectable without reconstructing intent from a Task file or confusing vertical velocity with yaw.

## Compatibility

Task version 1 is rejected rather than silently reinterpreted. Its third tuple element was previously compared to vertical free-joint velocity, so treating it as yaw after the fact would change evaluator meaning without changing source syntax. Checked-in authored Tasks migrate to version 2; immutable historical artifacts retain their original Task snapshots.
