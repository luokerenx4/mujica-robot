# State-gated hybrid recovery

## Decision

Mujica treats a complete Mission trajectory as the unit of robot learning and
promotion. A curriculum may focus on a failing condition or stop after a
Mission phase, but every episode starts at the beginning of the Mission. It
must not reset between approach, disturbance, recovery, and mission
resumption.

Program code and learned control have different authority:

- the Program Controller owns discrete supervision, fall classification,
  impulse, capture, rise, retry, handoff, and ordinary locomotion;
- a Policy may add a bounded residual only inside a declared observable state
  envelope;
- the envelope is evaluated from Program telemetry on every control step and
  fails closed when a field is missing, mistyped, non-finite, or out of bounds;
- a locked full-Mission Suite and its regressions are the only promotion
  authority.

`prior-telemetry-mode` residual gates therefore support four independent
constraints:

```json
{
  "allowedModes": ["recovery"],
  "requiredTelemetry": {
    "dynamicRecovery": true,
    "recoveryRetryCount": 0,
    "recoveryPose": "right"
  },
  "minimumTelemetry": {
    "baseHeightM": 0.25,
    "supportFeet": 2
  },
  "maximumTelemetry": {
    "bodyTiltRad": 0.8
  }
}
```

This is state conditioning, not Scenario identity. A deployment can reproduce
the decision from observations and controller state without knowing which
authored test case is running.

Residual authority may be one scalar `residualScale` or an explicit
`residualScaleByAction` vector. The vector is frozen into the Policy
architecture and lets a robot-development Lab assign different budgets to
different actuators—for example, micro-corrections on the legs and a larger
bounded authority on a newly introduced waist. The Runtime rejects wrong-width,
non-finite, boolean, or negative authority before training or actuation.

## Recovery reward

Training can declare a `recoveryReward` with `upright`, `height`, `stillness`,
`support`, and optional `tiltEscape` weights. `tiltEscape` is a linear dense
signal from fully inverted to upright, so a Policy beginning near
`bodyTiltRad = π` does not have to discover the narrow tail of the upright
exponential before receiving useful credit. The terms are recorded separately
from the base environment reward and Mission command reward. They are emitted
only while the Policy has non-zero recovery authority. Stable-standing
training reward is diagnostic evidence; it cannot promote a Policy.

Stillness uses a smooth reciprocal of measured base linear and angular speed
instead of an exponentially saturated term, so high-speed recovery states
retain a useful gradient. `stillnessMaximumTiltRad` can restrict that reward to
a near-upright envelope, preventing a motionless inverted torso from becoming
a learned optimum.

## First locked experiments

The first four joint code-and-RL experiments were all rejected:

1. A phase-labelled stand envelope produced only 172 active Policy steps. The
   source change reached an upright left-degraded final pose, but the robot
   continued moving and failed stable-standing qualification.
2. A wider state envelope produced 1,092 active steps but also granted
   authority to exact front/back recoveries. Both previously successful
   Missions regressed.
3. Adding observed recovery pose and retry count preserved both exact Missions
   and the opposing degraded retry, but only 186 target steps were active and
   the target Mission still failed.
4. Failure-focused full-Mission training increased target exposure to 2,798
   active steps across 131,072 training steps. It reduced normalized violation
   severity but still lost signed task progress, so the locked Judge rejected
   it.

No learned Policy was promoted. The negative results establish that the
current reachable recovery basin and sparse on-policy exposure are the next
technical bottlenecks; increasing residual authority is not justified.

## Articulated inverted-escape experiments

The articulated-waist branch made the next bottleneck observable. At retry
entry the torso was almost fully inverted (`bodyTiltRad ≈ π`), all four feet
were `0.3–0.5 m` above the floor, and `supportFeet` remained zero. The former
upright exponential therefore supplied almost no learning signal. Training now
has an optional linear `tiltEscape` term and can withhold stillness reward
outside a near-upright envelope.

A 32,768-step, fourteen-action residual Policy reduced full-Mission violations
from `41 → 40` and changed score from `-14.7882 → -14.7010`, but increased
normalized severity from `177.7813 → 178.6764`. It recovered one degraded
impact gate without producing a successful self-right.

Two governed follow-ups were reverted:

1. Widening the contact envelope and doubling training did not produce a
   single one-foot contact and regressed exact-left forward progress.
2. Giving the twelve leg actuators only `0.15 Nm`, both waist actuators
   `2.0 Nm`, and six seconds of retry authority improved severity slightly
   (`178.6764 → 178.4305`) and removed one degraded-impact collision, but added
   an exact-left terminal-yaw violation. Actual waist excursion remained about
   `0.08 rad`, and support stayed at zero.

The falsified hypothesis is now “more recovery PPO on the same centered split
waist will discover a contact sequence.” The next intervention belongs in the
complete-design lane: change rollover/contact geometry—such as a protective
shell, offset spine, or reachable bracing surface—then let the tightly bounded
Policy optimize the resulting local recovery motion.

## Regression-score boundary

Policy Labs still pay the configured training-step complexity term in their
primary objective. Regression Suites, however, compare behavior after removing
only the `trainingSteps` score term. Otherwise a state-gated Policy that emits
identical Actions outside its envelope can fail a locomotion regression solely
because it took more than `maximumRegression / trainingStepsWeight` steps to
train.

The raw score and its complexity terms remain in every immutable Evaluation.
Only the regression pass/fail comparison uses the behavior-only total; primary
selection still sees the full complexity cost.
