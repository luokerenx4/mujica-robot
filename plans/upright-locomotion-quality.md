# Upright locomotion quality

- Status: `completed`
- Updated: `2026-07-23`
- Related design: [Upright locomotion](../docs/design/upright-locomotion.md), [Traction recovery](../docs/design/traction-recovery.md)

## Outcome

Mujica can develop and verify a quadruped that keeps its torso recognizably upright while walking and recovering, instead of treating survival and displacement as sufficient evidence when the body rotates nearly horizontal. Humans and Coding Agents receive a locked posture-quality capability, orientation evidence with unambiguous geometry, and a bounded Controller surface that preserves every completed locomotion and traction gate.

## Context

The newly promoted `bounded-traction-gait` solves multi-seed `friction = 0.1`, but fresh immutable Run `run-3306034fb5a210f7` exposes the next north-star gap on the nominal surface: survival is `1.0` and signed progress is `0.515`, yet maximum pitch reaches `1.565 rad` and maximum pitch rate reaches `4.700 rad/s`. The robot advances, but its torso approaches a ninety-degree forward rotation. The current backward-only traction gate correctly distinguished the previous failure direction; it must not become a permanent excuse for poor upright locomotion.

## Scope

### In scope

- Add orientation-quality evidence that remains geometrically meaningful near Euler-angle singularities and is visible in Runs, diagnosis, and Studio.
- Lock nominal, reset, payload, push, command, delay, and completed traction cases behind an explicit upright envelope.
- Develop bounded sagittal posture/foot-placement control using existing deployable Observation channels.
- Preserve signed progress, backward displacement, command tracking, transitions, traction recovery, and spatial-generalization gates.
- Publish immutable Runs, bounded Research, a governed Candidate, design evidence, and a child Robot Revision only after all hard gates pass.

### Out of scope

- Weakening progress or traction gates to make standing still look upright.
- Reading Scenario identity, friction, or future command segments inside the Controller.
- Claiming `friction = 0.05`, changing morphology, or representing dry-run protocol evidence as physical hardware verification.

## Acceptance

- [x] Runtime evidence exposes body tilt independently of yaw and Euler pitch singularities, with tested units/sign conventions.
- [x] A locked Benchmark gates maximum torso tilt and absolute sagittal pitch across nominal and completed locomotion capabilities.
- [x] The selected Controller keeps maximum absolute pitch `<= 0.6 rad` on every hard upright case while retaining each authored progress/tracking gate.
- [x] Extreme traction and all prior locked diagnoses retain zero violations.
- [x] A feasibility-first KEEP publishes a child Robot Revision; full TypeScript/Python tests pass and evidence is pushed.

## Work

- [x] Audit the nominal orientation trajectory and define a quaternion-derived tilt contract.
- [x] Build and lock an upright locomotion capability ladder with honest baseline failures.
- [x] Develop bounded sagittal posture control and exhaust immediate alternatives.
- [x] Run every completed capability regression and apply the governed Candidate.
- [x] Update design/Plan evidence, verify the repository, commit, and push.

## Findings and decisions

- 2026-07-23 — Survival, progress, and backward-pitch safety do not prove upright gait quality. The next gate must measure both forward and backward body inclination without confusing yaw with tilt.
- 2026-07-23 — The proposed `0.6 rad` absolute-pitch envelope is a new capability requirement, not a reinterpretation of the completed traction gate. Existing immutable evidence remains valid for the claim it actually made.
- 2026-07-23 — Body tilt is `acos(1 - 2(x² + y²))` for MuJoCo `wxyz` quaternions. It is the yaw-invariant body-up/world-up angle, remains meaningful near Euler pitch singularities, and complements rather than replaces signed pitch.
- 2026-07-23 — A single gait did not span normal support, severe slip, and three-step delay. The kept Controller uses only observable operating domains: a normal four-beat crawl, measured early-progress selection of the proven traction bound, and a delayed command-speed boundary constrained strictly between `0.20` and `0.25 m/s`.
- 2026-07-23 — Delayed command transitions must return to the passing bound. A feedback-yaw sign branch first diverged from its parent at `2.86 s`; command-sign selection restored action-for-action identity across all `325` delayed-braking control steps.
- 2026-07-23 — Contact-only classification, dynamic phase alignment, inertial payload classification, emergency neutral holds, broad transition gain scans, and several direct velocity feedback variants were rejected because they overlapped valid reset states or destabilized delayed support.

## Progress log

- 2026-07-23 — Plan opened from immutable nominal Run `run-3306034fb5a210f7`: survival `1.0`, signed progress `0.515`, maximum pitch `1.565 rad`, and maximum absolute pitch rate `4.700 rad/s`.
- 2026-07-23 — Runtime and harness now expose trajectory `bodyTiltRad`, aggregate mean/maximum tilt, Objective gates, diagnosis, JSON/Studio projection, and a geometric unit test covering pure yaw and near-singular pitch.
- 2026-07-23 — Locked `upright-locomotion` contains twelve hard stand/forward/reset/payload/push/delay/reverse/lateral/yaw/traction cases. `upright-traction-gait` passes with score `76.4735`, delta `-2.7876`, and zero violations; all maximum absolute pitch values are at most `0.3730 rad`.
- 2026-07-23 — Locked regressions remain feasible with zero violations: `extreme-traction` `58.7656` (`+11.1873`), `spatial-generalization` `53.2280` (`+1.6694`), `command-tracking` `74.7139` (`+3.4395`), and `command-transitions` `67.9957` (`-1.3323`).
- 2026-07-23 — Bounded Research `upright-locomotion-gait` records the legal classifier, crawl, and delayed-domain surface. Candidate `upright-locomotion` removes all twelve baseline gate violations and publishes child Revision `quadruped-r-72516cc9a6dd` from `quadruped-r-1101a73a0752`.
- 2026-07-23 — Repository verification passed: project validation, Assembly compilation, Controller config/reference audit, three-package TypeScript typecheck, `37` TypeScript tests, and `26` Python tests. Harness identity refresh also produced dry-run bundle `hardware-6d6bbb8b401a8f5b` and protocol-only verification `verification-5c915086e3f15783`.
