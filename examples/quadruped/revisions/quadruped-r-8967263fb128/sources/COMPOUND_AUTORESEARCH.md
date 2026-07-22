# Delayed lateral-recovery research program

Improve `force-sensing-history-3dof` plus `latency-aware-spatial-gait` against the locked `spatial-generalization` Benchmark.

The measured gap is lateral recovery under compound disturbances. Pure 20 ms and 60 ms delay already survive, make forward progress, and have effectively zero lateral drift. `delay-plus-push` and `delay-plus-reset` survive and make progress but exceed the `0.2 m` lateral-drift gate. Do not trade away the passing reset, mirrored-push, or pure-delay cases for one attractive aggregate score.

Only propose numeric values declared by `research/compound-recovery.research.json`. Benchmark cases, seeds, Objective gates, Assembly, Controller interface, calibrated delay table, source code, dependencies, and Runtime are fixed. A KEEP below an unmet gate must monotonically improve that exact metric relative to the current best; per-case score regression remains anchored to the locked baseline.

Treat gate measurements as evidence and mechanism descriptions as hypotheses. Prefer one coherent lateral-state or saturation hypothesis per proposal. Return only the proposal JSON requested by the CLI protocol.
