# Upright locomotion quality

- Status: `active`
- Updated: `2026-07-23`
- Related design: [Traction recovery](../docs/design/traction-recovery.md)

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

- [ ] Runtime evidence exposes body tilt independently of yaw and Euler pitch singularities, with tested units/sign conventions.
- [ ] A locked Benchmark gates maximum torso tilt and absolute sagittal pitch across nominal and completed locomotion capabilities.
- [ ] The selected Controller keeps maximum absolute pitch `<= 0.6 rad` on every hard upright case while retaining each authored progress/tracking gate.
- [ ] Extreme traction and all prior locked diagnoses retain zero violations.
- [ ] A feasibility-first KEEP publishes a child Robot Revision; full TypeScript/Python tests pass and evidence is pushed.

## Work

- [ ] Audit the nominal orientation trajectory and define a quaternion-derived tilt contract.
- [ ] Build and lock an upright locomotion capability ladder with honest baseline failures.
- [ ] Develop bounded sagittal posture control and exhaust immediate alternatives.
- [ ] Run every completed capability regression and apply the governed Candidate.
- [ ] Update design/Plan evidence, verify the repository, commit, and push.

## Findings and decisions

- 2026-07-23 — Survival, progress, and backward-pitch safety do not prove upright gait quality. The next gate must measure both forward and backward body inclination without confusing yaw with tilt.
- 2026-07-23 — The proposed `0.6 rad` absolute-pitch envelope is a new capability requirement, not a reinterpretation of the completed traction gate. Existing immutable evidence remains valid for the claim it actually made.

## Progress log

- 2026-07-23 — Plan opened from immutable nominal Run `run-3306034fb5a210f7`: survival `1.0`, signed progress `0.515`, maximum pitch `1.565 rad`, and maximum absolute pitch rate `4.700 rad/s`.
