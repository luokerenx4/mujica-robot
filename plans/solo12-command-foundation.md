# Solo12 command foundation

Updated: 2026-07-28

## Outcome

The source-grounded `solo12-informed` robot executes stop, forward, reverse,
lateral, and yaw commands through one readable Controller. Atomic cases prove
that each commanded direction creates measured motion; one no-reset command
tour proves that the robot can change modes and stop again under nominal,
delayed, and disturbed execution before learning is authorized.

## Context

`solo12-readable-crawl` established honest four-foot contact exchange and
retained the eight-case standing suite, but it only turns the world-X command
into motion. The current Development Work Order therefore routes the
`command-foundation` stage rather than an optimization lane. The old demo
robot's command-tracking Revision is interface reference evidence, not proof
for this 2.5 Nm, 1 kHz Solo12 plant.

The Harness already owns typed world-frame motion commands, scheduled
transitions, transient metrics, and exact current-command delivery. This slice
reuses those semantics and spends its budget on plant-qualified behavior and
integrated evidence.

## Scope

- Keep the compiled `solo12-informed` Assembly, source provenance, geometry,
  sensors, 1 kHz plant, joint limits, and 2.5 Nm actuator limit fixed.
- Retain the four-beat, three-foot-support crawl and extend only its bounded
  hip-abduction and hip-flexion trajectories.
- Add Solo12-only constant reverse, lateral, yaw, and zero-command Tasks plus
  one scheduled no-reset command tour.
- Lock atomic, delayed-tour, and delayed-plus-disturbance cases under one
  Solo12-only Objective and Benchmark.
- Require `solo12-disturbance-standing` and
  `solo12-readable-locomotion` as regressions.
- Do not train a Policy, change morphology, claim arbitrary combined planar
  commands, claim navigation, claim self-righting, or promote hardware.

## Development emphasis

`behavior-heavy`, mechanism-first. The fixed Assembly already has independent
HAA/HFE/KFE actuation on every leg, safe joint margin, contact sensing, and a
measured crawl with actuator headroom. Those facts make bounded lateral and yaw
foot trajectories plausible without an embodiment change.

Exit when every locked atomic and integrated gate passes, both accepted Solo12
regressions remain passing, and Studio visibly agrees that the command tour
changes motion modes without sliding or falling. Switch to `balanced` if the
HAA and HFE trajectories create the requested contact directions but lose the
support triangle within safe authority. Switch to `design-reassessment` if
bounded readable trajectories cannot create lateral or yaw displacement at all
without collision, joint-limit use, or actuator saturation.

## Acceptance

- Solo12-only Tasks declare exact world-frame command values, healthy height,
  1 kHz execution, and scheduled command boundaries.
- The locked Benchmark covers stand, forward, reverse, lateral, yaw, a
  nominal no-reset command tour, a delayed tour, and a delayed disturbed tour.
- A static stand cannot pass motion gates: every non-zero planar command must
  earn signed target progress, and yaw must earn measured rate.
- Gates retain survival, tilt, collision, joint margin, actuator, jerk, slew,
  slip, impact, velocity tracking, braking, settling, and final stop evidence.
- The accepted Controller declares requested and filtered command telemetry
  plus intended swing/support feet for human and Agent inspection.
- `solo12-disturbance-standing` and `solo12-readable-locomotion` pass unchanged.
- Studio provides synchronized baseline/candidate evidence for the integrated
  command tour; locked atomic cases preserve per-axis numerical witnesses.
- Any uncovered Harness requirement is resolved or recorded in
  `examples/quadruped/HARNESS_REQUIREMENTS.md`.
- `mujica validate` and the full TypeScript/Python suite pass.

## Work

1. Freeze Tasks, Scenarios, Objective, Benchmark, and lock.
2. Diagnose `solo12-readable-crawl` as the honest one-axis baseline.
3. Implement continuous command filtering and readable HAA/HFE command basis.
4. Tune only bounded trajectory parameters from measured atomic failures.
5. Run both Solo12 regressions and inspect synchronized Studio witnesses.
6. Publish the new Development Review/Work Order, clean artifacts, validate,
   commit, and push.

## Findings and decisions

- Existing Task v2/v3 command semantics are sufficient. A new command schema
  would add abstraction without improving robot evidence.
- Atomic cases and one integrated no-reset tour serve different purposes:
  atomic displacement prevents cancellation from hiding a dead command axis;
  the tour exposes switching and stopping failures that constant commands miss.
- The accepted Controller keeps the already-qualified joint-space longitudinal
  crawl and adds analytic Solo12 foot-space inverse kinematics only where HAA
  authority is needed for lateral and yaw strokes. Direct joint sinusoids and
  cosine stance returns were rejected because they slid or made support feet
  fight the body.
- Transition averaging and settled dwell are different measurement concepts.
  The Runtime now exposes them separately; this 1 Hz gait averages a full
  one-second stride and the tour gives every stop 1.5 seconds so the additional
  0.2-second hold can actually be observed.
- A shared net-forward-progress gate is only a conservative proxy in a
  composite tour that intentionally reverses and turns. The current common
  floor remains strong enough to reject no-motion behavior, while typed
  per-case gate scope is recorded as an open Harness requirement.
- Training remains unauthorized. This is the cheapest readable mechanism test
  for the Assembly's existing three-axis legs.

## Progress log

- 2026-07-28: Opened from Development Work Order
  `development-work-order-61a0efe49ddfb531` with both accepted Solo12
  Benchmarks required as regressions.
- 2026-07-28: Locked `solo12-command-foundation` with eight gating cases:
  atomic stand/forward/reverse/lateral/yaw and nominal/delayed/disturbed
  20-second no-reset tours.
- 2026-07-28: Accepted `solo12-command-crawl` at aggregate score 102.683
  versus the readable-crawl baseline, +1.203 overall, with zero violations.
  The three tour cases improved by +2.177, +2.284, and +2.200 respectively;
  every transition settled and all slip, impact, jerk, slew, actuator, joint,
  tilt, collision, and tracking gates passed.
- 2026-07-28: Retained `solo12-readable-locomotion` at score 80.548
  (+5.177, zero violations) and `solo12-disturbance-standing` at score 84.574
  (+0.180, zero violations).
- 2026-07-28: Preserved the final nominal tour pair as Runs
  `run-1e30033d4420aedc` (baseline) and `run-b21ed98d977bffe6` (candidate).
- 2026-07-28: Generated synchronized 20,000-frame A/B Studio snapshot
  `studio-1ab2a56f0e48f9ab`; both replays loaded, played on one simulation
  clock, and emitted no browser warnings or errors.
- 2026-07-28: Published Development Review
  `development-review-a1d4f99215a57e1e`; the exact Solo12 subject now passes
  standing, readable locomotion, and command foundation. Development Work
  Order `development-work-order-b0f6f87583f1ad5a` routes a mechanism-first,
  Training-disabled self-righting capability inception while retaining all
  three Solo12 suites as regressions.
