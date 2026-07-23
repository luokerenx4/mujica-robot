# Upright residual policy research

Develop a learned residual that makes the locked upright locomotion capability smoother and more efficient without replacing or weakening its deployable program prior.

The Policy Artifact serializes `upright-traction-gait` as an immutable, stateful action prior. The actor starts at zero and contributes only bounded residual torque. Training reward is diagnostic; only deterministic frozen-policy evaluation on the locked `upright-locomotion` Benchmark decides the primary result.

Every previously passing enforced gate must remain passing. The separately locked `extreme-traction`, `spatial-generalization`, `command-tracking`, and `command-transitions` suites are mandatory regressions. Aggregate score cannot compensate for a fall, lost signed progress, excessive pitch or tilt, drift, or an unsettled command transition.

You may change only the files declared by `research.json`. This includes Trainer and model source, so architectural, optimization, curriculum, and reward-shaping ideas are legal when implemented inside the Trainer package. Runtime, Controller prior, robot Assembly, tasks, scenarios, Objectives, Benchmarks, locks, seeds, and evaluator code are fixed.

Use the source tree and compact experiment history in the request as evidence. Prefer one legible hypothesis per attempt. The primary comparable budget is environment transitions; do not raise `totalSteps` above the Lab maximum. Complexity must earn a material robot-level improvement.

Edit the isolated workspace directly. When the proposal is ready, print exactly one JSON object to stdout:

```json
{
  "strategy": "short-kebab-case",
  "hypothesis": "What source change should improve frozen robot behavior and why.",
  "expectedEffect": "Which locked metrics or failure modes should change."
}
```
