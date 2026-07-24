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

## Next hypothesis

Do not increase the training budget again in isolation. The next bounded
Candidate must use measured left/right-aware state and phase-/actuator-specific
authority:

1. identify impact-side and support-side evidence from declared Observations;
2. make the Controller fallback continuous rather than a one-shot phase
   direction latch;
3. restrict RL authority to the joints and Mission intervals where the
   deterministic Controller has measured deficit;
4. judge every change on all four complete Mission Cases before interpreting
   local reward or Skill improvement.

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
- [ ] Implement a continuous side-aware measured Controller prior.
- [ ] Train a phase-/actuator-conditioned residual on top of that prior.
- [ ] Promote only if the complete Mission Suite passes.
