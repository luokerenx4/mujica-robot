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
- [x] Training v3 grows monotonically longer prefixes of one integrated
  Mission; the final stage is necessarily the complete Task.
- [x] Each Mission stage freezes its Domain Profile, observed global-step
  interval, actor authority, and phase-local reward evidence.
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
- Training v3 replaced detached recovery Skills with monotonically expanding
  prefixes of one Task v7 Mission. The 13-second exact prefix gives the actor
  `21.5%` authority exposure and the exact full-Mission stage gives `43.3%`.
- Three Mission-progression seeds scored `38.863401`, `38.867625`, and
  `38.853282`. The selected seed remains `REVERT` against `38.935033`; improved
  causal data did not yet correct negative post-handoff `redirect` progress or
  degraded recovery.

## Next experiment

Keep the Mission Suite frozen. Change only the governed training surface:

1. keep the new Mission progression and change reward/credit assignment so
   residual authority during `redirect` produces positive signed progress;
2. improve the Program recovery basin under randomized degraded Missions so
   the learned actor receives downstream authority consistently;
3. retain phase-conditioned reward and authority evidence;
4. preserve impact entry and self-righting as Program-only authority until a
   separate governed experiment explicitly changes that safety boundary;
5. reject every experiment unless degraded recovery gates improve and no exact
   Mission gate regresses.
