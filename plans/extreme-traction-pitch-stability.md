# Extreme traction and pitch stability

- Status: `completed`
- Updated: `2026-07-23`
- Related design: [Traction recovery](../docs/design/traction-recovery.md)

## Outcome

Mujica can develop and verify a quadruped that advances on the physically effective `friction = 0.1` surface without trading traction authority for an uncontrolled sagittal tumble. Humans and Coding Agents receive explicit pitch and pitch-rate evidence, a locked extreme-traction capability ladder, and a bounded Controller surface that uses only deployable Observation channels. The kept robot retains every completed traction, command, transition, and spatial-generalization gate.

## Context

Robot Revision `quadruped-r-3275cb855510` closes the `friction = 0.35` gap and passes a hard `friction = 0.2` case. Its non-gating `friction = 0.1` evidence survives only `53.6%`, moves `0.309 m` backward, and falls after pitch rotation accelerates. A same-seed replay with the pre-traction Controller survives the full episode and moves only `0.103 m` backward. The current `2×` hip-amplitude recovery therefore converts a traction deficit into a sagittal-stability failure; adding more undifferentiated authority is not a valid next step.

## Scope

### In scope

- Add deterministic pitch-angle and pitch-rate evidence and diagnostic gates without changing the robot ABI.
- Promote `friction = 0.1` to a hard extreme-traction case with reset and completed locomotion regressions; retain a harder non-gating stress point.
- Develop severity-aware traction and sagittal posture control using existing orientation, angular-velocity, contact, command, joint, base-motion, and delay observations only.
- Preserve `traction-recovery`, `command-tracking`, `command-transitions`, and `spatial-generalization` locks.
- Publish immutable Runs, bounded Research, a governed Candidate, design evidence, and a child Robot Revision only after all hard gates pass.

### Out of scope

- Reading Scenario identity or friction inside a Controller.
- Lowering the signed-progress requirement, shortening the Task, or accepting survival-only shuffling as extreme traction.
- Claiming an arbitrary or zero-friction operating envelope.
- Terrain vision, footstep planning, adhesion hardware, or editing historical Revisions.

## Acceptance

- [x] Runtime and diagnosis expose pitch instability with tested sign/unit conventions.
- [x] A locked Benchmark makes `friction = 0.1` and three seeded reset variants hard gates and retains a lower-friction non-gating stress case.
- [x] The selected Controller survives and reaches signed forward progress `>= 0.25` with backward displacement `<= 0.02 m` on every hard extreme-traction case.
- [x] All prior traction, command-tracking, command-transition, and spatial-generalization diagnoses retain zero violations.
- [x] A feasibility-first KEEP publishes a child Robot Revision; full TypeScript/Python tests pass and evidence is pushed.

## Work

- [x] Add pitch metrics, gates, diagnosis, tests, and an extreme-traction ladder.
- [x] Establish frozen same-seed baselines and isolate authority versus pitch-control effects.
- [x] Develop a bounded severity-aware sagittal Controller and exhaust its immediate alternatives.
- [x] Run every locked regression, apply the governed Candidate, and publish the Revision.
- [x] Update design/Plan evidence, verify the repository, commit, and push.

## Findings and decisions

- 2026-07-23 — `friction = 0.1` is now the explicit next hard capability, not a permanently non-gating curiosity. The existing `0.25` signed-progress and `0.02 m` backward-displacement requirements remain unchanged.
- 2026-07-23 — Same-seed evidence falsifies the simple “more hip amplitude means more extreme traction” hypothesis: the prior gait survives with `0.103 m` backward displacement, while the `2×` recovery falls after `0.309 m` backward displacement.
- 2026-07-23 — The failure is sagittal rather than lateral. Roll/yaw stay near symmetric while pitch quaternion and pitch rate diverge after the recovery latches. Pitch must become first-class evidence before further tuning.
- 2026-07-23 — Absolute pitch is not the release gate: the established forward gait reaches positive pitch near `+1.56 rad` while surviving and advancing, whereas the traction failure diverges in the negative direction. The objective gates `maximumBackwardPitchRad <= 0.5` and retains absolute angle/rate as diagnostic evidence.
- 2026-07-23 — A same-seed authority scan found the feasible boundary: `1.2`, `1.4`, and `1.6` survive but miss extreme progress; `1.7–1.75` can pass; `2.0` tumbles. Applying the lower scale globally regressed the completed low-friction reset, so the final Controller retains `2.0` for mild recovery and latches `1.74` only after signed pitch crosses `-0.15 rad`.
- 2026-07-23 — Instantaneous forward velocity is not a reliable severity classifier. Its within-stride oscillation falsely classified a passing `friction = 0.35` case; the final surface uses continuous signed pitch and no Scenario-derived material label.
- 2026-07-23 — The first locked KEEP passed authored cases but independent reset seed `1702` still fell when the `0.2 rad` intervention arrived late. The failure remains immutable in Run `run-8c561c5da30616c8`; the Benchmark now hard-gates seeds `1605`, `1702`, and `1710`, and the final threshold is `0.15 rad`.

## Progress log

- 2026-07-23 — Plan opened from immutable Runs `run-c8a94f3260d3d593` (traction recovery, fall at `2.70 s`) and `run-7fa14767b2516969` (prior gait, full survival). Both use the same Assembly, Task, Scenario, Objective, and seed `1509`.
- 2026-07-23 — Added tested signed pitch/pitch-rate trajectories and metrics, an eleven-case locked extreme-traction ladder, two bounded Research parameters, and immutable authority-scan Runs. Baseline has 20 hard violations on the expanded lock.
- 2026-07-23 — Final `bounded-traction-gait` passes all ten hard cases: unperturbed extreme progress is `0.468`; reset seeds reach `0.366`, `0.497`, and `0.430`; every case survives with zero backward displacement and backward pitch below `0.5 rad`. `friction = 0.05` remains non-gating and fails.
- 2026-07-23 — Locked regression diagnoses retain zero violations: traction recovery `65.5714` (`+15.1246`), command tracking `76.0241` (`+4.7497`), command transitions `67.1619` (`-2.1661` within gates), and spatial generalization `56.6273` (`+5.0687`).
- 2026-07-23 — Feasibility-first KEEP improves the expanded extreme score `47.5783 → 66.0074`, removes all 20 baseline violations, and publishes child Robot Revision `quadruped-r-1101a73a0752` after intermediate Revision `quadruped-r-b77621e855a4` exposed the held-out reset gap.
- 2026-07-23 — Final verification passed: all ten Benchmark locks are current, 37 TypeScript/CLI/Studio tests and 25 Python Runtime tests pass, project validation crosses MuJoCo successfully, refreshed dry-run evidence is `PROTOCOL-VERIFIED` with `hardwareVerified=false`, and commit `d25b1fe` is pushed to `origin/main`.

## Completion

Mujica's default quadruped now uses the governed `bounded-traction-gait` and `extreme-traction` Benchmark. Signed pitch evidence, three hard extreme reset seeds, phase-robust severity latching, immutable failed probes, two linked Robot Revisions, and five zero-violation capability diagnoses make the result inspectable to humans and Agents. `friction = 0.05` remains an explicit non-gating failure rather than an implied capability.
