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

## Recovery reward

Training can declare a `recoveryReward` with `upright`, `height`, `stillness`,
and `support` weights. The terms are recorded separately from the base
environment reward and Mission command reward. They are emitted only while the
Policy has non-zero recovery authority. Stable-standing training reward is
diagnostic evidence; it cannot promote a Policy.

Stillness uses a smooth reciprocal of measured base linear and angular speed
instead of an exponentially saturated term, so high-speed recovery states
retain a useful gradient.

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
