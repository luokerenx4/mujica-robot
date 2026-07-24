# Continuous resilience mission

## Decision

Walking, disturbance response, self-righting, and resumed locomotion are not
independent release capabilities. Mujica keeps their atomic Benchmarks as
diagnostic slices, but promotion of a resilient robot must also pass one
causally continuous episode:

```text
approach → disturbance → recovery → resume
```

The robot does not reset between those stages. Controller state, joint state,
momentum, contact history, actuator delay, and any damage to the mission
trajectory therefore carry across the boundary. This catches failures that
isolated starting poses cannot represent.

## Executable contract

Task V6 combines:

- a scheduled mission command that remains active for the whole episode;
- a fixed `recoveryEvaluationStartSeconds`;
- a later `mobilityMeasurementStartSeconds`, so progress is measured after the
  recovery budget rather than credited from the approach;
- the same stable-stand target used by atomic self-righting.

Scenario V2 replaces the lateral-only disturbance with a positive force and an
explicit planar direction. The Runtime records the effective vector, including
training-only randomization, in reset and push events.

A recovery success is counted only after the robot first leaves the recovery
target and then re-enters it for the required dwell. Merely remaining upright
after the evaluation boundary cannot produce a false success.

Every trajectory row carries `missionStage`; stage transitions are also
first-class events. The stages are visible in Studio and in the JSON returned by
`mujica evidence inspect`:

- `approach`: commanded locomotion before the authored disturbance;
- `disturbance`: the complete force interval;
- `recovery`: the target has been lost and not yet reacquired;
- `resume`: stable recovery was achieved and the mission continues.

## Evaluation and diagnosis

`resilient-mission` freezes opposing left/right impacts as two gating cases.
Each case is a complete mission, not an atomic collision test. Its Objective
requires all of the following in the same Run:

- full episode survival;
- a real recovery trigger followed by stable self-righting;
- bounded recovery time and final pose;
- post-recovery signed forward progress;
- bounded drift, joint-limit margin, actuator authority, and self-contact.

Atomic command, traction, resting-pose self-righting, and recovery-handoff
Benchmarks remain useful. They answer *where* a failure lives. The continuous
mission answers whether the robot can complete the proposition.

The first integrated baseline is intentionally failing. The rigid controller
passes all four static resting-pose recovery cases, but fails both continuous
impact missions. On the left case it is already outside the recovery target at
2.50 s, the 100 N impact starts at 2.52 s, dynamic side-fall detection transfers
authority at 2.86 s, and the robot never regains a stable stand. This is not a
threshold problem: it demonstrates that the approach gait, impact basin, and
recovery controller must be optimized together.

## Training distribution

`quadruped-resilient-mission-v1` is a synthetic training-only Domain Profile.
Episodes alternate the two authored impact directions while continuously
sampling:

- impact-time offset;
- force scale;
- planar direction jitter;
- mass, damping, actuator strength, friction, observation noise, and delay.

`resilient-mission-residual` trains against the full fourteen-second Task.
The residual Policy has authority only while the prior supervisor reports
pre-recovery locomotion; deterministic code retains recovery and handoff
authority. This first bounded ML lane can improve the approach gait and contact
basin without being allowed to corrupt the proven recovery sequence.

The first 8,192-step run (`training-35a1e28c2b8dd34a`) sampled eleven complete
episodes plus one partial episode across the declared ranges. Its frozen Policy
(`resilient-mission-residual-d5d91d33ff3e6e62`) improved aggregate score only
from `-14.702985` to `-14.650032` and reduced violations from 16 to 14 by
improving joint-limit margin. It still recovered in neither locked case and
never reached `resume`, so it remains a failed candidate rather than a promoted
controller.

Training reward is never promotion evidence. The frozen Policy must pass the
locked continuous mission and its atomic regression Benchmarks. The Domain
Profile is synthetic and makes no hardware or real-world robustness claim.
