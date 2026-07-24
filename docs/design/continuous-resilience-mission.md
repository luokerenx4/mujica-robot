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
- an authored `recoveryEvaluationStartSeconds` after the disturbance interval;
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

The first integrated baseline failed despite passing all four static resting-pose
recovery cases. A no-impact fourteen-second replay then exposed an earlier root
cause: the open-loop forward gait accumulated sagittal momentum and fell after
roughly 2.2 seconds, while the side-only dynamic detector left locomotion in
control. Small pitch and pitch-rate feedback made the approach gait bounded, and
the supervisor now detects both sagittal and lateral dynamic falls.

The original 100 N for 160 ms authoring produced a 16 N·s impulse. It launched
the roughly 6 kg robot with all feet airborne and roll rates above 6 rad/s, so
joint actuation could not remove whole-body angular momentum before landing.
That experiment is useful as an extreme failure probe, but it is outside the
release controller's controllable impact basin. The gating scenarios use a
mirrored 51 N impact: strong enough to leave the recovery target and force a
real fall, but still physically recoverable.

Dynamic recovery is not treated as a static pose lookup. It uses the measured
entry angular speed, waits for a bounded momentum basin, reclassifies the pose
after tumbling, runs a shortened retry sequence, and low-pass filters the
standing action before a two-second locomotion handoff. The recovery clock
starts at 2.70 seconds, after the authored impact ends at 2.66 seconds. The
release mission uses an explicit `quadruped-resilient-3dof` Base variant with
about 1.1 degrees more abduction and hip-pitch travel. Existing
`quadruped-3dof` policies and evidence remain byte-compatible; the safety gate
remains a 0.02 rad margin from the resilience variant's hard stops.

The locked deterministic result now passes both complete missions with no gate
violations:

- aggregate score: `103.154322`;
- recovery success: `2/2`;
- time to stable stand: `5.48 s` in both directions;
- maximum stable dwell: `1.98 s`;
- post-recovery signed progress: `0.2011`;
- final tilt: `0.0952 rad`;
- minimum joint-limit margin: `0.0284 rad`;
- disallowed self-contact: `0` steps.

The atomic four-pose self-righting and four-pose recovery-handoff Benchmarks
also pass. Command tracking still has pre-existing failures in the
three-step-actuator-delay slices for both the embedded and standalone bounded
traction controllers; this remains a separate latency-control work item rather
than being hidden by the continuous mission result.

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
