# ML motion-quality autoresearch

- Status: `complete`
- Updated: `2026-07-23`
- Related design: [ML motion-quality research](../docs/design/ml-motion-quality-research.md), [Motion-quality Judge](../docs/design/motion-quality-judge.md), [Research Lab V2](../docs/design/research-lab-v2.md)

## Outcome

Mujica can let a Coding Agent propose a bounded ML control experiment, train a residual Policy against dense motion-quality feedback, freeze the learned model, reject or keep it through the independent motion-quality Judge and capability regressions, and expose the resulting behavior in the same dual-Run Studio used by a human.

## Context

The first motion-quality Benchmark makes the delayed gait's jerk, saturation, planted-foot slip, and contact impact measurable. The existing residual PPO Policy does not optimize those signals: it scores `48.4059` versus the program baseline's `50.4663`, increases enforced violations from seven to ten, and adds delayed pitch, body-tilt, and lateral-drift failures. More training with the old reward would optimize the wrong proxy.

## Scope

### In scope

- Add neutral-default, typed training-only quality reward weights.
- Derive dense quality proxies from exact MuJoCo state, applied Action, foot sites, and touch sensors without changing evaluation scores or gates.
- Record base reward, quality penalty, and term totals in immutable Training evidence.
- Add a bounded residual PPO Trainer, Training definition, Policy Controller, and Research Lab whose locked primary Judge is `motion-quality`.
- Let the Coding Agent author and execute at least one real ML experiment; keep only frozen Policies that improve the lexicographic Judge tier and preserve locked regressions.
- Render the most informative baseline/candidate pair for human review.

### Out of scope

- Online weight updates during evaluation or Studio playback.
- Editing Objectives, Benchmarks, gates, tasks, scenarios, or Runtime from inside the Research Lab.
- Claiming that a short CPU PPO run discovers a production quadruped gait.
- Replacing task capability, safety gates, or hardware verification with training reward.

## Acceptance

- [x] Existing Training definitions preserve identical reward behavior through neutral defaults.
- [x] Quality-aware training can penalize normalized Action slew, saturation, joint/body angular acceleration, planted-foot slip, and contact impact.
- [x] Training artifacts expose base reward and each quality penalty term rather than only one opaque reward.
- [x] A source-governed Policy Lab fixes editable source, transition/wall-clock budgets, primary Judge, and capability regressions.
- [x] At least one learned Policy is trained, frozen, and evaluated on the locked motion-quality Benchmark.
- [x] KEEP requires lexicographic gate improvement and zero regression-suite gate regressions; REVERT/CRASH remains immutable evidence.
- [x] The resulting experiment is reproducible from its Training Run, Policy, source patch, evaluation, and verdict.
- [x] A real baseline/candidate comparison is available in Studio at `http://127.0.0.1:8765/`.
- [x] Validation, TypeScript tests, Python tests, Benchmark locks, and protocol-only hardware evidence pass.
- [x] The completed result is documented, committed, and pushed.

## Work

- [x] Audit the existing residual Policy, training reward, and Research Lab authority boundary.
- [x] Measure the current frozen residual Policy under the new motion-quality Judge.
- [x] Implement typed quality-aware training reward and evidence.
- [x] Add the motion-quality residual Policy Lab and bounded Coding-Agent proposal surface.
- [x] Run ML experiments and accept the Judge outcome without hand-editing frozen weights.
- [x] Generate human comparison, verify, document, commit, and push.

## Findings and decisions

- 2026-07-23 — The existing learned residual is a useful negative control: it improves delayed progress but regresses score, posture, drift, slip, and gate count. ML capability is not evidence of aligned optimization.
- 2026-07-23 — Dense training feedback may use lower-order acceleration proxies for sparse control-grid jerk, but the independent Judge continues to gate the actual jerk metrics.
- 2026-07-23 — Quality terms are normalized against fixed documented reference magnitudes before weighting. This keeps reward coefficients legible and avoids coupling training stability to raw `N/s` or `rad/s²` scale.
- 2026-07-23 — The Coding Agent may edit only Trainer, Training, and Policy Controller source in isolation. It cannot edit the Judge or retroactively repair a frozen Policy.
- 2026-07-23 — The first two experiments exposed zero foot-quality reward terms because the training probe used abbreviated sensor names instead of the Assembly's declared `foot-force-*` names. Their immutable REVERT evidence remains, but no Policy trained under the disconnected term may be promoted.
- 2026-07-23 — Safety-first policy authority is explicit: start at residual scale `0.002`, promote only after the frozen Judge passes, then test `0.004`. The expansion regressed lateral drift and braking, so the smaller Policy remains head.

## Progress log

- 2026-07-23 — Locked diagnosis of `upright-residual-gait` reports score `48.4059`, delta `-2.0603`, and ten violations. The delayed case adds pitch-angle, body-tilt, and lateral-drift failures while planted-foot slip rises to `0.2733 m/s`.
- 2026-07-23 — Session `session-017880d862e33847` trained 4096- and 6144-transition PPO candidates. Both were REVERT: the first retained ten violations with higher severity and broke delayed tracking/braking gates; the second reached fifteen violations and moved backward. Their Training metrics exposed the disconnected foot reward channel.
- 2026-07-23 — Session `session-31782800775f72d9` verified live foot-slip and contact-impact reward terms. Its `51.4668` candidate was correctly REVERT for two regression-gate failures; the second candidate failed delayed survival.
- 2026-07-23 — Session `session-3655b6b9b1d36fd1` KEEP promoted Policy `motion-quality-residual-locomotion-478335c4ce7fee99` and Revision `quadruped-p-a19af86be9ad`: score `48.4059 → 49.6529`, violations `10 → 7`, severity `7.7188 → 2.6004`. Doubling residual authority was then REVERT for lateral-drift and braking regressions.
- 2026-07-23 — Studio snapshot `studio-60a7e47ac38cec8c` synchronizes delayed program Run `run-fd0c98cb0cade834` with promoted learned Run `run-862d582573ce7646`.
