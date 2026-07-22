# Forward residual policy research program

Improve the frozen periodic residual policy under the locked `forward-locomotion` Benchmark.

Only propose values declared in `training-research/forward-residual-policy.training-research.json`. The periodic force-aware gait prior, Trainer source, Assembly, observation/action contracts, task, scenario set, Objective, evaluation seeds, Runtime, evaluator, and dependency locks are fixed inputs.

Training reward is diagnostic. KEEP is decided only by deterministic frozen-policy evaluation across all seven cases, including the scored actuator-delay challenge, after charging the Objective's training-step cost. Do not trade away a required survival, forward-progress, or lateral-drift gate for a higher aggregate. Do not select on unregistered seeds.

Prefer small, attributable hypotheses about budget, learning rate, exploration, PPO update pressure, and clipping. Return only the proposal JSON requested by the CLI protocol.
