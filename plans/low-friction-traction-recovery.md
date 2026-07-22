# Low-friction traction recovery

- Status: `completed`
- Updated: `2026-07-23`
- Related design: [Traction recovery](../docs/design/traction-recovery.md)

## Outcome

Mujica can develop and verify a quadruped Controller that detects and recovers from backward slip on a physically effective low-friction surface using only deployable Observation channels. The kept robot advances under the locked `friction = 0.35` case without sacrificing nominal locomotion, reset recovery, payload handling, lateral-push recovery, actuator-delay behavior, constant command tracking, or command transitions. Harder traction conditions remain visible stress evidence rather than being silently weakened or omitted.

## Context

The Runtime previously applied Scenario friction only to the floor geom. MuJoCo contact combination with unchanged foot geoms made the authored low-friction case behaviorally inert. Applying the Scenario value to all contact geoms revealed that the frozen spatial policy survives but slides `0.238 m` backward and records zero forward progress. This invalidates the old all-gates interpretation and exposes traction adaptation as the next quadruped capability bottleneck.

## Scope

### In scope

- Establish a locked, friction-correct baseline and a small traction ladder with at least one hard low-friction gate and one harder non-gating stress case.
- Add deterministic slip evidence that distinguishes survival from forward traction and is useful to both humans and Coding Agents.
- Develop a bounded Controller response using only command, base motion, pose, contact, and actuator observations; Scenario identity and friction values may not cross the Controller ABI.
- Preserve the completed `command-tracking`, `command-transitions`, and `spatial-generalization` gates.
- Publish immutable Runs, a KEEP Robot Revision, updated design evidence, and full regression results.

### Out of scope

- Terrain perception, exteroceptive material classification, footstep planning, or online system identification.
- Claiming arbitrary friction robustness from one coefficient.
- Changing the low-friction gate to non-gating or lowering forward-progress requirements to fit the current robot.
- Rewriting historical Policy or Robot Revisions produced under the old Runtime.

## Acceptance

- [x] Runtime evidence exposes backward slip and forward traction without relying on Scenario labels.
- [x] A locked Benchmark gates nominal and `friction = 0.35` traction, plus reset/payload/push/delay regressions, and retains a harder non-gating stress case.
- [x] The selected Controller passes every traction gate and all completed command/spatial regression suites.
- [x] Controller source and config document a bounded, deployable slip response with no future command or friction preview.
- [x] A feasibility-first KEEP publishes a child Robot Revision; typecheck and all TypeScript/Python tests pass.

## Work

- [x] Audit contact/friction semantics and reproduce the corrected failure from immutable evidence.
- [x] Add slip metrics, diagnostic gates, tests, and the traction capability ladder.
- [x] Diagnose gait direction/authority under slip and develop a bounded recovery response.
- [x] Lock regressions, apply the governed Candidate, and publish the Robot Revision.
- [x] Update design/Plan evidence, run full regression, commit, and push.

## Findings and decisions

- 2026-07-23 — Survival is insufficient traction evidence: the current frozen policy survives the full episode while its net target-direction displacement is negative. This Plan requires explicit backward-slip evidence in addition to forward progress.
- 2026-07-23 — Scenario identity and authored friction are evaluator inputs, not Controller observations. Recovery must be triggered by measured robot behavior available on hardware.
- 2026-07-23 — The existing `friction = 0.35` gate remains hard. A harder point may be added only as explicitly non-gating stress evidence until independently solved.
- 2026-07-23 — `forwardProgress` stays clipped for score compatibility, while new `signedForwardProgress` and `backwardDisplacement` gates expose direction honestly. Per-foot contact forces are copied into immutable trajectory rows when the Assembly provides them.
- 2026-07-23 — Waiting for a three-step delayed robot to accumulate displacement makes recovery too late. The kept Controller uses a conservative high-delay traction gait and separately records first-contact unloading from deployable force channels; normal delay remains inside its locked drift gate.
- 2026-07-23 — Traction authority cannot be dropped abruptly at a command boundary. A `0.15 s` release, retained lateral-position feedback, reversal/braking-specific velocity feedback, and reachable `0.1` yaw damping preserve the completed delayed-braking capability.
- 2026-07-23 — The honest capability boundary is currently between the tested `friction = 0.2` and `friction = 0.1` points. The former passes as a hard case; the latter survives `53.6%` and moves `0.309 m` backward, so it remains non-gating stress evidence.

## Progress log

- 2026-07-23 — Plan opened from the friction-correct `spatial-robustness` failure found during command-transition completion. Current evidence: survival `1.0`, forward displacement `-0.2378 m`, forward progress `0.0`.
- 2026-07-23 — Added a nine-case traction ladder, signed slip diagnosis, bounded Research surface, and immutable failed Runs covering phase discontinuity, late response, unsafe release, and transition damping hypotheses.
- 2026-07-23 — Locked diagnoses report zero violations: traction score `64.1743` (`+13.7275`), command tracking `76.0241` (`+4.7497`), command transitions `67.1619` (`-2.1661` within every regression gate), and spatial generalization `56.6273` (`+5.0687`).
- 2026-07-23 — Feasibility-first KEEP removed all 12 traction baseline violations and published child Robot Revision `quadruped-r-3275cb855510`; full repository verification and push remain.
- 2026-07-23 — Final verification passed: all three TypeScript packages typecheck, 37 TypeScript integration/unit tests pass, 23 Python Runtime tests pass, all nine Benchmark locks are current, and the dry-run bundle is `PROTOCOL-VERIFIED` with `hardwareVerified=false`.

## Completion

Mujica's default quadruped now points to the command-capable 3-DOF Assembly and the kept traction-aware Controller. Signed slip evidence, contact-force trajectories, a bounded Research surface, four zero-violation regression diagnoses, immutable failed Runs, and Robot Revision `quadruped-r-3275cb855510` make the capability inspectable to both humans and Agents. Extreme `friction = 0.1` traction remains an explicit next gap rather than a hidden regression.
