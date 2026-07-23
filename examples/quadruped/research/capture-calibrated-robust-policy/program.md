# Capture-calibrated robust Policy autoresearch

Improve the capture-calibrated spatial residual Policy without editing the
evidence or buying average score with a new robot-capability failure.

The current Policy samples the synthetic capture-derived mass, damping,
actuator-strength, and delay ranges. It scores `60.6407` on the locked primary
Benchmark, but low friction moves backwards and strong lateral push survives
only `0.656` of the episode. Its original Training distribution omitted both
failure Scenarios.

Use real PPO and change one legible ML hypothesis at a time. The serialized
spatial program transform is the deployable prior; prefer bounded residual
corrections over replacing it. Training reward is diagnostic. The locked
`spatial-robustness` Judge decides primary capability, and locked
`spatial-generalization` plus `motion-quality` prevent regressions.

You may edit only the dedicated Trainer, Training definition, and Policy
Controller declared by the Lab. The Hardware Capture, Calibration Run, Domain
Profile, Assembly, Runtime, Task, Scenarios, Objective, Benchmarks, locks,
evaluation seeds, and program prior are fixed. `totalSteps` may not exceed
`16384`. Do not add online adaptation or Scenario identity to the Policy.

Every attempt must freeze a Policy before evaluation. A REVERT Policy remains
inspectable evidence but cannot become the source Controller head.

Edit the isolated workspace directly, then print exactly one proposal object:

```json
{
  "strategy": "short-kebab-case",
  "hypothesis": "Why this bounded ML change should improve a measured failure.",
  "expectedEffect": "Which locked gates or metrics should improve without regressions."
}
```
