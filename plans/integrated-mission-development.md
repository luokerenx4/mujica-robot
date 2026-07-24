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
- [x] Complete-design, Controller-code, and RL-policy lanes are judged by the
  same locked Mission Suite instead of private capability tests.
- [x] Studio exposes a complete-design Candidate's mass, Action, Observation,
  and cost burden beside its latest governed Mission evidence.
- [x] Correct the post-recovery body/world-frame mismatch under the unchanged
  Mission Suite and publish the kept Controller as a Robot Revision.
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
- A 14-action articulated-waist Candidate was evaluated on the same four
  complete Missions. Its neutral comparison scored `-14.293828` against the
  rigid robot's `38.935033` and failed all four recovery handoffs.
- Governed waist experiment `001-e9997df1cda1` improved mechanical failure
  count and severity (`44 → 42`, `185.804 → 180.903`) but regressed isolated
  recovery safety; reversing the impulse worsened the Mission. Both attempts
  were reverted, so the partial signal cannot masquerade as a design win.
- Work Order `development-work-order-0ee33d0b4224cd04` now keeps morphology,
  Controller code, and RL Policy as separate intervention surfaces under one
  Mission authority.
- The continuous Mission revealed that a successful self-right followed by a
  successful walking Skill can still fail the job: recovery changes heading,
  while the legacy gait initially interpreted the next world-frame command as
  body-forward. Isolated resettable tests erase this mismatch.
- Six bounded handoff attempts were rejected before experiment
  `001-950524569565` kept measured-heading-conditioned world-frame tracking.
  It improved score `38.935033 → 39.119018` and normalized violation severity
  `71.283 → 59.194` without increasing the 26 violations or regressing a gate.
  The deployed result is Robot Revision `quadruped-r-40206836cd00`.
- Three residual PPO Policies on the improved prior tested `0.02`, `0.01`, and
  `0.017` action authority. The largest removed one aggregate violation but
  exceeded the right-exact yaw gate by `0.021 rad/s`; the two safer Policies
  did not lexicographically beat the program prior. All remain `REVERT`
  evidence, so the selected robot has no learned residual pretending to be an
  improvement.
- Review `development-review-161b2ff0add84e0f` ranks
  `impact-right-degraded` and `impact-left-degraded` first; exact recovery and
  the atomic self-righting/handoff regressions remain passing.

## Next experiment

Keep the Mission Suite frozen. Run bounded interventions without splitting the
acceptance test:

1. treat the measured-heading Controller as the new prior and improve the
   Program recovery basin under randomized degraded Missions so downstream
   phases become reachable consistently;
2. only resume residual-Policy work after degraded cases expose useful
   post-recovery actor data; do not spend more budget interpolating residual
   scale around the already measured yaw boundary;
3. for the design lane, change split-torso geometry/contact workspace together
   with leg/waist sequencing; do not accept another neutral-servo or sign-only
   comparison;
4. retain phase-conditioned reward and authority evidence;
5. preserve impact entry and self-righting as Program-only authority until a
   separate governed experiment explicitly changes that safety boundary;
6. reject every experiment unless degraded recovery gates improve and no exact
   Mission gate regresses.
