# Solo12 disturbance-standing capability

## Purpose

This is the first Assembly-qualified dynamic capability for Mujica's
source-grounded `solo12-informed` robot. It exercises the complete Harness loop
before locomotion or RL: authored physical scope, locked scenarios and gates,
readable Controller, isolated Agent edits, immutable evidence, lexicographic
Judge, and synchronized human review.

## Physical contract

The suite uses one three-second, 1 kHz standing Task. The push begins at 0.8 s
and ends at the 0.9 s recovery-evaluation boundary. Four cardinal cases apply
20 N for 0.1 s. For the 2.501 kg MuJoCo model this is a 2 N·s impulse and a force
of roughly 0.82 model body weights. Lower-friction and delayed/noisy cases use
16 N to combine disturbances without silently increasing every dimension at
once. A 300 g payload case retains the 20 N push.

The thresholds were authored before the 20 N baseline evaluation:

- full Episode survival;
- at most 0.45 rad transient body tilt;
- at most 0.08 m transient planar displacement from the Episode start;
- at least 0.5 s stable-target dwell;
- at most 1.5 s to stable stand;
- final height at least 0.16 m and final tilt at most 0.1 rad;
- at least 0.1 rad joint-limit margin;
- no disallowed self-contact and no command beyond 2.5 Nm.

These define one bounded laboratory disturbance suite, not an arbitrary-impact
claim and not hardware evidence.

## Autonomous research result

Benchmark `solo12-disturbance-standing` compares against the original readable
`solo12-home-stand` Controller (`kp=5`, `kd=0.1`). Research Lab
`solo12-disturbance-controller` owns only
`controllers/solo12-balance-stand/**`.

Session `session-c1975017e06b685e` ran three isolated hypotheses:

1. `raise-joint-damping`: KEEP.
2. `moderate-stiffness-damping`: KEEP.
3. `soft-high-damping`: REVERT.

The kept Controller uses `kp=6`, `kd=0.2`. Under the current instrumented
Benchmark it has zero enforced violations and improves aggregate score by
0.1525. The synchronized left-push witness records:

| Metric | Original PD | Kept Controller |
| --- | ---: | ---: |
| Maximum planar displacement | 0.06334 m | 0.05252 m |
| Maximum body tilt | 0.06515 rad | 0.05382 rad |
| Time to stable stand | 0.615 s | 0.313 s |
| Stable standing dwell | 1.486 s | 1.788 s |
| Peak actuator | 1.0738 Nm | 1.0935 Nm |

This result does not justify adding a whole-body Controller or a learned Policy
yet. The simple joint-space mechanism still improves inside ample torque and
joint-margin headroom.

## Harness findings

Three previously conflated concepts are now explicit:

- a stable robot accumulates standing dwell without first failing;
- a push recovery is not presented as fallen-pose self-righting;
- final net drift cannot hide a large transient excursion.

Runtime emits `stabilityEvaluationKind`, `stabilityTargetAchieved`,
`maximumPlanarDisplacementM`, and `maximumPlanarSpeedMps`. The Judge has a
`maximumPlanarDisplacementM` gate. Studio selects stability-specific headings,
statuses, and A/B summary metrics. Runtime reserves `robot.self-righted` and
`selfRightingSuccess` for a fallen-pose task; a push recovery emits
`robot.stability-restored`.

Benchmark applicability is also Assembly-qualified. A Development Review for
Solo12 evaluates this suite and reports demo-family stages as `NOT_EVALUATED`;
it does not execute a physically unrelated Task and call the result a failure.
The reciprocal rule prevents the demo robot from inheriting or failing the
Solo12 capability.
