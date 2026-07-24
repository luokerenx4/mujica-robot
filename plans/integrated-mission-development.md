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
- [x] Training reward uses phase-local displacement references and applies
  Mission shaping only under learned-actor authority.
- [x] Frozen Policy evidence records per-phase progress, reward, and actor
  authority for Studio and Agent inspection.
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
- The first continuous reward used episode-start lateral displacement even
  after the Mission changed command direction. That made correct displacement
  from an earlier phase become a penalty in a later phase. Task v7 now resets
  this training-only reference at each named phase; atomic Tasks are unchanged.
- Mission reward is ignored while the Program Controller has exclusive
  authority. This prevents PPO from claiming credit for self-righting actions
  it did not control.
- Three 8,192-step seeds scored `38.893505`, `38.853113`, and `38.871558`
  against baseline `38.935033`. The selected seed remains `REVERT` with delta
  `-0.041528`.
- A 32,768-step run scored `38.637973`; more samples did not repair degraded
  recovery and incurred the locked training-budget cost.
- In the selected seed, actor exposure was 11.1% in `resume`, 19.5% in
  `redirect`, 12.5% in `traverse`, and 24.0% in `stop`. One alternate seed
  received zero Mission-phase actor authority, showing that the next bottleneck
  is handoff/data availability rather than PPO budget alone.

## Next experiment

Keep the Mission Suite frozen. Change only the governed training surface:

1. change the recovery-to-policy handoff or curriculum so successful Mission
   episodes supply substantially more post-recovery actor data;
2. retain phase-conditioned reward and authority evidence;
3. preserve impact entry and self-righting as Program-only authority until a
   separate governed experiment explicitly changes that safety boundary;
4. reject every experiment unless degraded recovery gates improve and no exact
   Mission gate regresses.
