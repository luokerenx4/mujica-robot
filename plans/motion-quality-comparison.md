# Motion-quality judgement and comparison

- Status: `completed`
- Updated: `2026-07-23`
- Related design: [Motion-quality Judge](../docs/design/motion-quality-judge.md), [Visual simulation debugger](../docs/design/visual-simulation-debugger.md)

## Outcome

Mujica can distinguish a robot that merely survives and advances from one that moves with controlled, repeatable contact. Coding Agents receive unitful motion-quality evidence and gates; humans can replay a baseline and subject Run side by side on one simulation-time clock and copy the exact comparison context back to an Agent.

## Context

The authoritative replay made the current quadruped's jerky delayed gait immediately visible, but the Judge only exposes energy, Action smoothness, posture, progress, and tracking. It cannot localize joint/body jerk, sustained actuator saturation, planted-foot slip, or contact-force impacts. Studio also shows only one Run at a time, so a human must compare improvements from memory.

## Scope

### In scope

- Derive unitful motion-quality signals from MuJoCo state, applied Action, exact foot-site position, and touch-force streams.
- Record per-step diagnostic rows and aggregate metrics for joint/body jerk, Action slew, saturation, foot slip, and contact impact.
- Add backward-compatible Objective weights and gates, CLI diagnosis, and a locked example motion-quality Benchmark.
- Add `mujica studio --run <baseline> --compare-run <subject>` with two authoritative replays, one time cursor, aggregate deltas, and copyable comparison context.
- Generate a real apples-to-apples baseline/subject pair and verify the browser interaction at the local Studio URL.

### Out of scope

- Inferring dynamics, contacts, or quality from rendered pixels.
- Replacing task success, safety, or hardware verification with a single aesthetic score.
- Mutating completed Runs, treating a visual preference as promotion authority, or claiming sim-to-real smoothness.
- General multi-agent or distributed experiment orchestration.

## Acceptance

- [x] New Runs record unitful per-step and aggregate evidence for joint jerk, body angular jerk, Action slew, actuator saturation, planted-foot slip, and contact impact.
- [x] Foot motion is sampled from named MuJoCo foot sites; unavailable channels fail explicitly or remain marked unavailable rather than being visually inferred.
- [x] Existing Objective files remain valid through neutral defaults; a motion-quality Objective can score and gate every new metric.
- [x] `mujica diagnose` reports violated motion-quality gates with evidence-ranked hypotheses.
- [x] `mujica studio --run A --compare-run B` creates or reuses two integrity-checked immutable replays and one content-addressed snapshot.
- [x] Both replay panels use one simulation-time cursor, at-or-before frame mapping, shared playback/event controls, per-side telemetry, and aggregate metric deltas.
- [x] Copied comparison context identifies both Run results, replay frames, simulation times, and metric deltas.
- [x] A real baseline and subject with identical Assembly, Task, Scenario, Objective, and seed are visible at `http://127.0.0.1:8765/`.
- [x] Validation, Assembly compilation, TypeScript tests, Python tests, and browser interaction checks pass.
- [x] Design/CLI documentation and immutable lock identities are updated; changes are committed and pushed.

## Work

- [x] Audit trajectory evidence, Judge metrics, and Studio replay authority.
- [x] Fix the measurement and synchronized-comparison contracts in design.
- [x] Implement Runtime metrics, Objective scoring/gates, diagnostics, and tests.
- [x] Implement dual replay generation and synchronized Studio comparison.
- [x] Produce and browser-verify a real baseline/subject comparison.
- [x] Run full verification, update evidence, commit, and push.

## Findings and decisions

- 2026-07-23 — “Natural” is not a metric. This slice names physical proxies with units and keeps them separate so an Agent can identify whether a defect comes from command discontinuity, actuator saturation, body motion, foot slip, or contact impact.
- 2026-07-23 — Derivatives use the Task control grid and applied Action, not requested Controller output or renderer frame cadence.
- 2026-07-23 — Planted-foot slip requires contact on adjacent samples and exact MuJoCo site positions. Swing-foot speed is not slip.
- 2026-07-23 — Comparison aligns frames by simulation time rather than array index, preserving correct behavior across differing episode lengths and replay strides.
- 2026-07-23 — Motion quality augments task/safety gates. A smooth robot that fails to perform the task is not a successful candidate.
- 2026-07-23 — The first locked bounds deliberately retain an infeasible baseline. They turn the observed nominal and delayed defects into the next optimization target without pretending the existing gait already passes.

## Progress log

- 2026-07-23 — Audited the user's delayed Run and confirmed the replay exposes a visible defect that current aggregate `meanSmoothness` and `peakActuator` cannot localize.
- 2026-07-23 — Immutable delayed comparison Runs `run-3404db433e7eb644` (`bounded-traction-gait`) and `run-35cd362b2def8a20` (`upright-traction-gait`) use the same Assembly, Task, Scenario, Objective, and seed. The subject improves mean planted-foot slip by `0.0946 m/s` but adds `1451.79 rad/s³` mean body angular jerk and `7982.83 N/s` peak contact impact.
- 2026-07-23 — Locked `motion-quality` diagnosis scores the current upright baseline `50.4663` and reports seven explicit violations: nominal joint/body jerk and Action slew; delayed body jerk, saturation, planted-foot slip, and contact impact.
- 2026-07-23 — Published replay pair `replay-3b208aedb91c6038` / `replay-e022c8ae2d464ba3` in Studio snapshot `studio-7c4ac5edfef0bf11`, served at `http://127.0.0.1:8765/`.
- 2026-07-23 — Browser verification loaded both `640 × 480` MuJoCo frames, synchronized step `1 → 2`, played both at `2×` to completion, scrubbed both to frame `125` at `2.500 s`, sought the shared completion Event, exposed per-frame quality telemetry, copied comparison context, and reported no browser warnings or errors.
- 2026-07-23 — Final verification passed project validation across 9 Assemblies, 41 TypeScript tests, and 30 Python Runtime tests. All 12 Benchmarks were re-locked. Hardware export remains dry-run only and its final protocol verification is `PROTOCOL-VERIFIED` with `hardwareVerified = false`.
