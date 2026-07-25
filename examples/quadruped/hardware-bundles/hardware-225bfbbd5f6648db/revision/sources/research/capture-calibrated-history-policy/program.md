# Capture-calibrated history Policy research

Develop a bounded learned residual that uses replayable commanded/applied actuator history to improve delay robustness without replacing the frozen `latency-aware-spatial-gait` program prior.

The physical Domain Profile comes from safety-supervised dry-run device captures. It is synthetic protocol evidence, not real-hardware verification. Its `plantHash` matches the history Assembly, while the Assembly's distinct Observation Contract and `executionHash` require a newly trained Policy.

The primary Judge is the locked `spatial-robustness` Benchmark. `spatial-generalization` and `motion-quality` are mandatory regressions. A better mean score cannot compensate for a newly failing survival, progress, drift, delay, saturation, impact, or score-regression gate.

You may edit only the declared Trainer, Training, and Policy Controller closure. Runtime, captured evidence, Domain Profile, program prior, Assembly, Tasks, Scenarios, Objectives, Benchmarks, locks, and seeds are fixed. Prefer the smallest useful residual; the zero-residual program prior is a valid outcome when learned corrections do not survive held-out gates.

Edit the isolated workspace and print exactly one proposal JSON object:

```json
{
  "strategy": "short-kebab-case",
  "hypothesis": "Why this bounded source change should improve robot behavior.",
  "expectedEffect": "Which locked metrics or failures should change."
}
```
