# Motion command contract

## Constant command decision

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

## Scheduled command decision

Task version 3 adds a bounded intra-episode `motionCommandSchedule` without changing Task v2:

```json
{
  "version": 3,
  "durationSeconds": 4,
  "controlHz": 50,
  "motionCommandSchedule": [
    { "atSeconds": 0, "command": { "frame": "world", "linearVelocityMps": [0.25, 0], "yawRateRadPerSec": 0 } },
    { "atSeconds": 2, "command": { "frame": "world", "linearVelocityMps": [0, 0], "yawRateRadPerSec": 0 } }
  ]
}
```

A schedule has 1–16 segments. Its first segment starts at exactly `0`, later `atSeconds` values are strictly increasing and earlier than `durationSeconds`, and every boundary plus the episode duration must align to the Task control grid (`seconds * controlHz` is an integer). These constraints turn an authored time into one unambiguous control-step boundary.

At control step `n`, the pre-action Observation exposes the command active for the half-open interval `[n / controlHz, (n + 1) / controlHz)`. The Action is computed from that Observation, and the resulting trajectory row records the same command beside the motion measured at the end of the interval. At a transition boundary the Controller therefore sees the new command before selecting the first Action governed by it. Only the active three-value command crosses the Observation ABI; later schedule entries are Runtime-owned Task intent and are never previewed by the Controller.

Task v2 remains the canonical constant-command form and is behaviorally unchanged. Runtime consumers resolve both versions through the same active-command operation; a one-segment v3 schedule is intentionally equivalent in control behavior but remains distinct authored source.

## Evidence

Every new trajectory row records both `motionCommand` and `measuredMotion` in the same order. Constant-command Run metrics record the command, mean measured motion, task-level planar/yaw error between those episode means, and mean instantaneous errors for gait diagnostics. Capability gates use the task-level errors: averaging instantaneous absolute error would incorrectly punish the deliberate within-stride velocity oscillation of a legged gait. Scheduled Tasks additionally record resolved segment boundaries and per-transition response metrics so stopping and settling cannot be hidden by an episode average. Terminal response is the mean of the final configured hold window. Settling is the earliest completed hold window whose windowed tracking error is within tolerance and for which every later complete window in that segment remains within tolerance; a temporary threshold crossing followed by divergence is not settlement.

Planar braking is classified separately when a non-zero planar command transitions to zero. `maximumPlanarSettlingTimeSeconds` covers every planar transition, including establishment from rest; `maximumPlanarBrakingSettlingTimeSeconds` covers only those braking transitions. This prevents an honest cold-start allowance from silently weakening the stop requirement. Count gates use one failed transition as one severity unit even when their allowed count is zero. This makes command tracking directly inspectable without reconstructing intent from a Task file or confusing vertical velocity with yaw.

The locked transition suite treats nominal stop, reversal, lateral redirection, yaw redirection, three-step delayed braking, and payload redirection as release gates. A stronger 35 N push combined with delay remains a scored but explicitly non-gating stress case; its unresolved response is visible evidence, not a claim of solved robustness.

## Compatibility

Task version 1 is rejected rather than silently reinterpreted. Its third tuple element was previously compared to vertical free-joint velocity, so treating it as yaw after the fact would change evaluator meaning without changing source syntax. Checked-in authored Tasks migrate to version 2; immutable historical artifacts retain their original Task snapshots.
