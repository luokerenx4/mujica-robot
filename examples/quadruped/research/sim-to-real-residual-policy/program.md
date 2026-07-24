# Domain-randomized residual Policy autoresearch

Improve the frozen residual Policy on exact, held-out plant combinations while
retaining the serialized `bounded-traction-gait` program as its reviewed
prior.

Training samples the fixed `quadruped-pre-hil-v1` synthetic Domain Profile. It is
an engineering uncertainty envelope, not a measured hardware calibration. The
Profile, held-out Scenarios, Benchmarks, Objective, seeds, Assembly, task, prior
Controller, and Runtime are judge inputs and must remain unchanged.

The locked `sim-to-real-audit` Benchmark is primary. Its heavy/weak and
light/strong cases are capability gates; slippery/weak is a scored stress probe.
Locked `upright-locomotion` and `motion-quality` are mandatory regressions. A
higher aggregate score cannot compensate for a new fall, lost command
capability, backwards travel, or motion-quality gate violation.

You may edit only the declared Trainer, Training, and Policy Controller source.
Every experiment must perform real PPO and freeze a new Policy before any
evaluation. `totalSteps` may not exceed `8192`. Prefer one legible ML hypothesis
at a time: more samples, a smaller residual, less exploration, or a targeted
quality term. Do not widen the uncertainty envelope or weaken the Judge.

Every Training Run and Policy remains immutable evidence. REVERT means the
weights stay inspectable but do not become the Controller head.

Edit the isolated workspace directly, then print exactly one proposal object:

```json
{
  "strategy": "short-kebab-case",
  "hypothesis": "Why this bounded ML change should improve held-out dynamics.",
  "expectedEffect": "Which locked capabilities or quality metrics should improve without regressions."
}
```
