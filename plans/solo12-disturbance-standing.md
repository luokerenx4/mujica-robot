# Solo12 disturbance-standing capability

Updated: 2026-07-28

## Outcome

The source-grounded `solo12-informed` Assembly remains upright and returns to a
stable home stance across one locked suite containing nominal standing,
four-direction external pushes, payload/friction variation, observation noise,
and one-step actuation delay. Mujica can give an Agent bounded Controller source
authority, run isolated experiments, diagnose gate failures, and preserve a
human-inspectable comparison without confusing the old demo robot's evidence
with this capability.

## Context

The first Solo12 probe proves only that a readable joint-space PD Controller can
hold the authored pose for two seconds in the nominal plant. It does not test
closed-loop disturbance rejection, settling, parameter uncertainty, or delay.
The old project Benchmarks are plant-specific and cannot qualify the new
Assembly. The next cheapest discriminating experiment is therefore a
Solo12-specific standing suite, not locomotion RL.

## Scope

- Keep the `solo12-informed` morphology, sourced dimensions, mass properties,
  collision envelopes, numerical settings, and 2.5 Nm actuator limit fixed.
- Add one plant-qualified standing Task, Scenarios, Objective, locked Benchmark,
  readable Controller candidate, and Controller Research Lab.
- Controller work may use only declared Solo12 observations and bounded torque.
- Permit aggressive Harness and Studio changes when real use reveals missing or
  misleading evidence; no pre-alpha compatibility work is required.
- Do not train a Policy, claim locomotion, claim self-righting, import meshes, or
  alter the old demo-family capability ledgers in this slice.

## Development emphasis

`behavior-heavy`, with a small diagnostic design budget. The compiled plant has
passed static support screening and a bounded nominal dynamic probe with zero
disallowed contacts and large actuator headroom. That evidence makes a fixed-
plant Controller experiment credible for standing disturbances.

Exit behavior-heavy work when the locked suite has no enforced violations and
the kept Controller remains readable. Switch to `design-reassessment` if two
meaningfully different bounded Controllers fail on the same direction because
foot workspace, support polygon, joint margin, contact opportunity, or actuator
authority is absent. Switch to `balanced` if the mechanism exists but a modest
plant-envelope change exposes coupled design/control sensitivity.

## Acceptance

- The Benchmark combines nominal, ±X, ±Y push, payload/friction, noise, and
  one-step-delay cases under one Assembly-compatible Task.
- Gates cover survival, body tilt, final height/tilt, actuator authority,
  disallowed contacts, and recovery quality using Runtime measurements.
- Baseline diagnosis records the real failure surface before edits.
- At least one isolated Agent-style Controller experiment is judged against the
  locked primary Benchmark; a KEEP requires every enforced gate to pass.
- Studio exposes the baseline/candidate evidence and enough trajectory context
  for a human to visually audit the conclusion.
- New Harness requirements found in use are resolved or explicitly retained in
  `examples/quadruped/HARNESS_REQUIREMENTS.md`.
- `mujica validate`, focused tests, and `bun run test` pass.

## Work

1. Author and lock the plant-qualified disturbance-standing suite.
2. Diagnose the home-pose PD baseline and classify the limiting surface.
3. Add a readable feedback Controller and bounded Research Lab source closure.
4. Run isolated experiments, preserve evidence, and inspect the kept trajectory.
5. Repair product gaps, update durable design rules, and clean superseded local
   artifacts.
6. Run the full validation loop and publish the result.

## Findings and decisions

- An 8 N, 0.1 s push was non-discriminating (maximum body tilt approximately
  0.015 rad), so the still-unpublished suite was re-authored at 20 N for
  cardinal/payload cases and 16 N for the coupled degraded cases before any
  candidate evidence was produced.
- The original PD already passed all gates at the stronger disturbance. This
  moved the work from feasibility rescue to same-tier recovery-quality
  optimization; thresholds were not tightened after seeing the result.
- Studio and Runtime incorrectly treated all stability targets as
  self-righting. Stability intent is now explicit, and disturbance recovery
  emits `robot.stability-restored` rather than `robot.self-righted`.
- Post-recovery `lateralDrift` hid a 5–6 cm transient translation. Maximum
  Episode-relative planar displacement is now a first-class metric, score term,
  and gate.
- Development Review still applied every project Benchmark to one selected
  robot despite Assembly-qualified capability claims. Benchmark applicability
  is now explicit; unrelated stages are `NOT_EVALUATED`, never false failures.
- With no failing applicable case, the current Work Order correctly has no
  Controller/RL lane but cannot yet route inception of the next capability.
  That remains an explicit follow-on Harness requirement for Solo12 locomotion.
- Joint-space gain research still had useful headroom. Two experiments were
  kept and one was reverted; no whole-body or learned mechanism was needed.

## Progress log

- 2026-07-28: Opened after the nominal Solo12 home-stand Run completed 2,000
  steps with no fall, no disallowed collision, and 0.623 Nm peak actuation.
- 2026-07-28: Locked the eight-case disturbance suite and diagnosed the original
  `kp=5`, `kd=0.1` Controller at zero violations.
- 2026-07-28: Research Session `session-c1975017e06b685e` kept two bounded
  Controller changes, rejected one, and selected `kp=6`, `kd=0.2`.
- 2026-07-28: Current locked diagnosis passes all cases with aggregate delta
  `+0.152476`; left-push Runs `run-d4e8ecf5d06d72b8` and
  `run-a51d324180d944fd` preserve the synchronized visual witness.
- 2026-07-28: Development Review `development-review-a794a70e16ce7275`
  evaluated only the applicable Solo12 suite: one stage PASS, zero violations,
  and five unrelated demo-family stages explicitly not evaluated.
- 2026-07-28: Full validation passed 97 TypeScript tests and 80 Python Runtime
  tests after regenerating all content-addressed locks and hardware bundles.
