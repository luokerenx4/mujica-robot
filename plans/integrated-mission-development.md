# Integrated Mission development

Status: active

## Outcome

Robot development and ML optimization use one authored end-to-end Mission as
their shared North Star. Local Skills accelerate learning and isolate faults,
but every promoted design or Policy must win a locked Suite of complete,
no-reset Missions.

## Acceptance

- [x] Task schema expresses ordered Mission phases and required capabilities.
- [x] Runtime measures each phase without resetting physical or Controller
  state.
- [x] Benchmark schema expresses a Mission Suite with resets only between
  complete cases.
- [x] Training schema mixes labeled Skill and Mission episode sources and
  records actual exposure.
- [x] Quadruped Charter and project defaults select the integrated Mission.
- [x] Studio shows phase evidence, actual Controller modes, A/B replay, and
  Skill/Mission training coverage.
- [x] One real curriculum Policy is judged by the locked Mission Suite.
- [ ] Improve degraded-impact recovery and signed post-recovery progress
  without weakening the Suite.
- [ ] Replace synthetic plant ranges with calibrated/HIL evidence before
  claiming transfer readiness.

## Findings

- The previous `approach → impact → recovery → resume` Mission was continuous,
  but it stopped before evaluating redirection, lateral traversal, and braking.
- A named phase schedule is more informative than inferring task stages from
  Controller state. Requirement timing and robot response can now disagree
  visibly.
- The current exact cases self-right, but resume with negative signed task
  progress. The degraded cases enter recovery and remain inverted. These
  failures would be obscured by separately resetting walking and recovery
  tests.
- The first mixed curriculum overwhelmingly sampled Mission data
  (`7,742/8,192` steps) and varied nine domain dimensions, yet removed no
  locked violation. Coverage is necessary evidence, not proof of learning.
- Policy `integrated-resilience-curriculum-c811d76190c264d3` is preserved as a
  `REVERT` Candidate with delta `-0.075186`; training reward remains
  diagnostic-only.

## Next experiment

Keep the Mission Suite frozen. Change only the governed training surface:

1. assign signed downstream progress credit after recovery completion;
2. emphasize recovery-completion and handoff transitions without allowing the
   residual to perturb impact entry or self-righting;
3. report phase-conditioned returns and actor authority;
4. reject the experiment unless degraded recovery gates improve and no exact
   Mission gate regresses.
