# Residual policy autoresearch

Improve the force-sensing quadruped's frozen residual policy under the locked `sensor-development` Benchmark.

Only propose values listed in `training-research/residual-policy.training-research.json`. The Trainer source, residual force-aware PD prior, Assembly, observation/action contracts, task, scenarios, objective, Benchmark lock, evaluation seeds, and dependency lock are fixed inputs.

Prefer hypotheses about sample budget, optimizer stability, exploration, and PPO update pressure. Training reward is diagnostic only; KEEP is decided exclusively by deterministic frozen-policy evaluation across every Benchmark case. A small training-reward increase is not evidence of robot improvement.

Do not weaken the survival or per-case regression gates. Do not select a Policy by looking at unregistered evaluation seeds.
