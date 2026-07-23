# Motion-quality residual Policy autoresearch

Develop a learned torque residual that reduces visible gait defects without replacing the serialized `upright-traction-gait` support logic.

The current residual Policy is a negative control: it scores below the program baseline and adds task/posture violations in delayed motion. Use the request's fixed-case metrics and experiment history to change one legible ML hypothesis at a time.

The dense `qualityReward` is a training aid. Frozen evaluation on locked `motion-quality` is the primary authority. Locked `upright-locomotion` and `command-transitions` are mandatory regressions. Do not trade survival, progress, posture, drift, tracking, braking, or settling for a lower training loss.

You may change only the declared Trainer, Training, and Policy Controller files. Runtime, Assembly, prior Controller, tasks, scenarios, Objectives, Benchmarks, locks, and seeds are fixed. `totalSteps` may not exceed `8192`. Prefer a small residual, low exploration, and explicit quality terms over a larger opaque network.

Every Training Run and Policy is evidence. A candidate is frozen before evaluation; REVERT means its weights remain inspectable but never become the mutable Controller head.

Edit the isolated workspace directly, then print exactly one proposal object:

```json
{
  "strategy": "short-kebab-case",
  "hypothesis": "Why this bounded ML change should improve frozen robot behavior.",
  "expectedEffect": "Which locked quality metrics should improve without capability regressions."
}
```
