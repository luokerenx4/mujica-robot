# Articulated delay-resilience loop

Status: active

## Outcome

Remove the articulated quadruped's delayed-observation regressions without
trading left-impact recovery for right-impact recovery or optimizing an
isolated Skill at the expense of the complete Mission.

The iteration unit is one Candidate judged on the same causal sequence:
approach, impact, recover, resume, redirect, traverse, and stop. Controller and
RL work share that authority and may use atomic Skills only to diagnose a
failure witnessed by the Mission Suite.

## Current development branch

- Review subject:
  `resilient-command-conditioned-waist-3dof/articulated-behavior-supervisor`
- Current score under the durable-recovery Judge: `62.7223`
- Worst Case: `integrated-resilience-mission/impact-left-degraded`
- Work Order status: `READY`
- Routed lanes:
  `integrated-resilience-waist-design`,
  `articulated-resilience-controller`,
  `articulated-brace-locomotion-policy`, and
  `articulated-inverted-escape-policy`

The Development Lab matcher accepts either side of a Review's Candidate
comparison as its subject. This is required because useful non-promoted
mechanisms must remain iteratable even when the selected release Robot stays
unchanged.

## Completed bounded probes

### Measured low-delay Controller fallback

Session `session-2fec8f26286bad66` tested a delay-one/two phase-direction
fallback driven by early signed-progress deficit.

- aggregate score: `72.7223 → 73.3788`;
- violations: `42 → 41`;
- left-degraded self-righting changed from failure to success;
- right-degraded self-righting changed from success to failure;
- normalized severity regressed from `85.786` to `96.930`;
- verdict: `REVERT`.

The experiment found a measured signal, but a global direction latch merely
moved the failure between impact sides.

### Early-delay RL locomotion residual

Session `session-7428b37374db2e79` doubled training exposure, increased
signed-progress credit, and gave the learned residual more leg authority with
less waist authority.

- Policy score: `34.435 → 34.939`;
- primary violations: `48 → 40`;
- right-degraded signed progress became positive (`0.0754`);
- exact-right timed out and degraded recovery remained unsafe;
- the Policy remained far below the Program reference (`72.7223`);
- verdict: `REVERT`.

More samples and more authority produced a useful directional signal but did
not produce a promotable robot.

## Findings and decisions

The left/right replay pair showed that the impact is already distinguishable
from declared state at the end of the push: lateral velocity and roll rate have
opposite signs, while the existing Supervisor waits until roughly `0.8 rad`
tilt before entering recovery. Five bounded Controller strategies used only
continuous measured state—phase retardation, smooth reversal, support-side
brace, early command-stop entry, and momentum-directed entry. None passed all
four complete Mission Cases. Early entry reduced violations `42 → 39`, but
lost the currently passing degraded-right self-righting gate. Fixed phase
tuning is not the remaining root cause.

The Policy Lab initially exposed a harness defect: its selected frozen Policy
was built against an older Assembly, yet its Work Order lane was labelled
ready. Policy Labs now preflight execution, Observation, and Action identity.
This Lab records `reference-controller-retrain` and trains from
`articulated-behavior-supervisor`; it cannot crash later in Python or compare
against an incompatible Policy head.

Session `session-dcf9f2536745c351` trained a `65,536`-step residual restricted
to delay-one dynamic recovery, with `0.30 Nm` per leg actuator and `1.50 Nm`
per waist actuator. Exact Cases remained behaviorally unchanged. On
degraded-right, signed progress improved `-0.345 → +0.226 m`, terminal tilt
fell `0.237 → 0.063 rad`, collisions fell `23 → 9`, and joint margin
improved `-0.060 → -0.031 rad`. The complete Mission nevertheless caught a
later fall during traverse/stop; the Policy reactivated and the episode ended
mid-rise at `0.227 m`, regressing the terminal-height gate. Verdict: `REVERT`.

That comparison exposed a Judge defect rather than merely a Policy defect:
terminal posture depended on when the second fall happened relative to the
fixed horizon. The accepted Program also fell again after self-righting; it
fell earlier and happened to be upright at the end. Task v8 now declares a
physical post-recovery failure envelope (`height < 0.24 m` or yaw-invariant
tilt `> 0.7 rad` for `0.1 s`). Runtime emits
`robot.recovery-relapsed`, the Objective locks zero relapses, diagnostics route
the complete recovery-to-locomotion suffix, and Studio exposes the event.

Rejudging preserved the useful distinction without rewarding horizon luck:

- accepted Program: degraded-right `2` relapse episodes;
- first narrow recovery Policy: degraded-right `3` relapse episodes;
- exact left/right Cases: `0` relapses;
- Program aggregate: `72.7223 → 62.7223` under the strengthened Judge;
- Policy aggregate: `72.6571 → 57.6571`.

The first Program relapse occurs in `traverse`, `2.4 s` after stable
self-righting, as body tilt remains above the failure envelope. The Supervisor
re-enters recovery immediately afterward. This makes the next bounded problem
explicit: preserve recovery through the settling-to-locomotion handoff and the
subsequent command transition, not merely reach standing once.

Session `session-c48393802da86aed` then restricted authority to the first
recovery using causal Program telemetry `recoveryCompleted=false`. Its newly
trained Policy lost degraded-right self-righting and increased violations
`42 → 45`. Verdict: `REVERT`.

### Closed-loop handoff and learned Mission suffix

The strengthened relapse gate localized a concrete handoff edge in immutable
Run `run-ff7d8750aaeae444`. On degraded-right:

- the Supervisor entered `settling` at `11.70 s`;
- locomotion authority reached roughly `75%` near `13.20 s`, when angular
  speed and saturated action began to grow;
- the wall-clock blend completed at the same redirect-to-traverse boundary;
- the first relapse was emitted at `14.80 s`.

Session `session-f4a4c740cf4ffb50` replaced the wall-clock-only cross-fade with
a stability-conditioned authority integrator. Height, yaw-invariant tilt,
angular speed, and support contacts advanced or backed off locomotion
authority, with no Scenario or Mission-phase input.

- score improved `62.7223 → 68.1143`;
- violations improved `43 → 41`;
- normalized severity improved `87.786 → 79.425`;
- the first degraded-right relapse moved from `14.80 s` to `17.72 s`;
- the robot crossed traverse but entered a late oscillatory handoff and failed
  the previously passing final tilt/height gates;
- verdict: `REVERT`.

Session `session-62b5a1eab9d3d22e` then trained a `32,768`-step residual on
complete Missions. Learned authority was zero in approach, impact, and
recovery; it activated only in `settling`/`locomotion` after at least three
observable Program transitions. Completion, stop stability, recovery, and
timeout credit made the whole post-recovery suffix part of the return.

- previous Policy score improved `34.4350 → 57.4422`;
- violations improved `48 → 43`;
- normalized severity improved `114.371 → 89.306`;
- degraded-right ended upright at `0.366 m`, but accumulated three relapse
  episodes and regressed backward-progress and terminal-yaw gates;
- exact-left also regressed its backward-displacement gate;
- the Candidate did not lexicographically beat the Program reference;
- verdict: `REVERT`.

These experiments prove both intervention surfaces carry useful signal but
neither is promotable. The Program rule delayed failure without stabilizing
the authority loop; PPO improved its predecessor while exploiting trajectories
that still crossed the physical relapse envelope. The Program remains the
release subject. The next experiment must change the learned state/credit
contract—most likely recurrent contact/action history plus direct relapse
credit—not merely widen torque authority or repeat scalar stability thresholds.

## Acceptance

- no new passing-gate regression;
- no left/right failure exchange;
- both degraded Cases exit recovery without timeout;
- zero post-recovery relapse events through resume, redirect, traverse, and
  stop;
- downstream signed progress and stop stability remain observable in the same
  episode;
- only the locked Mission Suite may promote the Candidate.

## Work

- [x] Route the articulated Review subject into executable design, Controller,
  and RL Labs.
- [x] Run and preserve one bounded Controller experiment.
- [x] Run and preserve one bounded RL experiment.
- [x] Reject both regressions while retaining immutable evidence.
- [x] Test continuous side-aware Controller priors on all four Mission Cases.
- [x] Train and judge phase-/actuator-conditioned residuals.
- [x] Keep the Program release subject because no Candidate passed the complete
  Mission Suite.
- [x] Replace terminal-frame recovery luck with a causal post-recovery relapse
  event, score term, hard gate, diagnostics, and Studio evidence.
- [x] Test one closed-loop Program handoff and one bounded learned post-recovery
  suffix against the strengthened complete-Mission Judge; preserve both as
  immutable `REVERT` evidence.
- [ ] Add causal relapse credit and recurrent contact/action history to the
  learned suffix without expanding its Program-telemetry authority boundary.
