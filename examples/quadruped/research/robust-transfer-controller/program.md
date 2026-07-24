# Held-out plant robust-transfer Controller research

Improve `behavior-supervisor` on the exact locked `sim-to-real-audit`
Benchmark while retaining the locked `upright-locomotion`, `motion-quality`,
`command-tracking`, `command-transitions`, and `recovery-handoff` regressions.

The current Development Review ranks `heavy-weak` first: the robot travels
backwards, pitches, saturates, and falls under the held-out heavy-body,
weak-actuator combination. `light-strong` is also a hard gate. The
`slippery-weak` case is diagnostic but non-gating.

You may edit only `controllers/behavior-supervisor/**`. Prefer one legible,
bounded hypothesis at a time. The ordinary locomotion path, fall detector,
recovery phases, bounded Action handoff, and pose-conditioned post-recovery
gait are all in scope, but the Controller interface, Assembly, Runtime, tasks,
Scenarios, Benchmark locks, Objectives, and regression gates are fixed.
Do not special-case case ids, seeds, or held-out Scenario names in executable
code.

The locked Judge decides KEEP or REVERT. Aggregate score cannot compensate for
a fall, backwards-travel gate, excessive tilt, loss of ordinary command
tracking, or loss of recovery-to-command handoff.

Edit the isolated workspace directly, then print exactly one proposal object:

```json
{
  "strategy": "short-kebab-case",
  "hypothesis": "Why this bounded Controller change should improve held-out dynamics.",
  "expectedEffect": "Which locked gates or metrics should improve without regressions."
}
```
