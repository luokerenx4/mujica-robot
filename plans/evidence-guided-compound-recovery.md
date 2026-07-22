# Evidence-guided compound recovery

- Status: `completed`
- Updated: `2026-07-23`
- Related design: [spatial generalization audit](../docs/design/spatial-generalization-audit.md)

## Outcome

Mujica turns a locked multi-case evaluation into deterministic, machine-readable development guidance, then uses that evidence to improve the 3-DOF quadruped under combined actuator delay and lateral disturbance. The target Robot/Controller pair passes survival, forward-progress, and lateral-drift gates across the held-out `spatial-generalization` Benchmark without weakening fixed inputs.

## Context

Executable Controller interfaces now prove that `latency-aware-spatial-gait` legally requires `force-sensing-history-3dof`. A fresh locked evaluation scores `54.6651005551`. Pure 20 ms and 60 ms delay survive with progress above `0.35` and essentially zero drift. The remaining failures are sharply localized:

- `delay-plus-push`: survival `1.0`, progress `1.0`, lateral drift `0.2809868099` against the `0.2` gate.
- `delay-plus-reset`: survival `1.0`, progress `0.3232599112`, lateral drift `0.7988807490` against the `0.2` gate.

The robot has enough longitudinal and delay authority; delayed lateral recovery is the constrained capability gap.

## Scope

### In scope

- A deterministic `mujica diagnose` protocol that reports per-case gate margins, ranks bottlenecks, separates evidence from intervention hypotheses, and emits exact next CLI actions.
- A bounded Research definition and human program for the latency-aware Controller against the locked held-out Benchmark.
- Controller changes limited to explicit lateral-recovery and delay-aware configuration or a reviewed small program change when scalar tuning is insufficient.
- Immutable experiments, gate enforcement, regression tests, and a Robot Revision only after a genuine KEEP.

### Out of scope

- Weakening `spatial-generalization`, changing its seeds, or making failed cases non-gating.
- Treating aggregate score as success while either compound lateral-drift gate fails.
- Unbounded neural-policy retraining before the analytic Controller surface is exhausted with attributable evidence.
- Claiming HIL or real-robot recovery from MuJoCo evidence.

## Acceptance

- [x] `mujica diagnose ... --json` identifies both compound lateral-drift violations with threshold, value, signed margin, severity, and reproduction argv.
- [x] Human output names the worst case and the relevant robot-development surfaces without presenting hypotheses as measured facts.
- [x] Compound-recovery Research cannot edit the Benchmark, Assembly, Runtime, Controller interface, or undeclared parameters.
- [x] The developed Controller passes every gating case: survival `>= 0.8`, forward progress `>= 0.25`, and lateral drift `<= 0.2`.
- [x] A KEEP publishes immutable experiment evidence and a child Robot Revision; unsuccessful attempts remain inspectable.
- [x] Full TypeScript/Python regression and a fresh locked MuJoCo evaluation pass.

## Work

- [x] Re-establish the compatible Assembly/Controller pair and current held-out evidence.
- [x] Define and implement the diagnostic schema and CLI.
- [x] Add the bounded compound-recovery research program.
- [x] Run experiments and inspect event/trajectory evidence for the two failing cases.
- [x] Keep only a gate-passing improvement and complete regression verification.

## Findings and decisions

- 2026-07-23 — Pure-delay cases prove delay calibration and mechanics are sufficient in isolation; the next intervention should target lateral-state recovery under delayed actuation, not add training budget indiscriminately.
- 2026-07-23 — Diagnostic output will distinguish measured gate violations from suggested editable surfaces. Mujica must not launder a heuristic into evidence.
- 2026-07-23 — The `0.2 m` drift gate remains authoritative even though `delay-plus-push` has a high total score; capability gates outrank attractive aggregates.
- 2026-07-23 — Experiment 23 passed every gate but was reverted by the old score-first rule. Research selection is now lexicographic: fewer violations first, then score within a feasibility tier, while fixed-case regression remains anchored to the lock.

## Progress log

- 2026-07-23 — Plan created from a fresh seven-case MuJoCo evaluation under the renewed `spatial-generalization` lock.
- 2026-07-23 — 33 immutable experiments produced two score KEEP decisions (`54.6651 -> 60.0785`), reduced failures from two to one, exhausted scalar first neighbors, and disproved instantaneous velocity and integrated-position feedback as single-factor fixes.
- 2026-07-23 — Experiment 34 replayed the previously missed feasible controller under lexicographic governance. It reduced enforced violations `1 -> 0`, published Robot Revision `quadruped-r-cb6b31bc8f4a`, and passed all seven held-out cases with aggregate score `56.9823` (`+4.4758` over the locked baseline).
- 2026-07-23 — Final evaluator locks were renewed at harness hash `baea871570cc`; type checking, 33 TypeScript tests, 16 Python/MuJoCo tests, and a fresh `mujica diagnose` all passed. The former worst `delay-plus-reset` drift is `0.0676 m` against the `0.2 m` gate.
