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
- Current score: `72.7223`
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

Session `session-c48393802da86aed` then restricted authority to the first
recovery using causal Program telemetry `recoveryCompleted=false`. Its newly
trained Policy lost degraded-right self-righting and increased violations
`42 → 45`. Verdict: `REVERT`.

These experiments prove a useful learned correction exists, but not yet a
promotable Policy. The Program remains the release subject. Future work should
improve recovery-to-locomotion stability or train a recurrent/contact-aware
residual; it must not raise sample budget or widen authority without a new
measured hypothesis.

## Acceptance

- no new passing-gate regression;
- no left/right failure exchange;
- both degraded Cases exit recovery without timeout;
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
