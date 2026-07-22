# Mujica

**Mujica** is an AI-native robot development harness built on MuJoCo. It lets Coding Agents modify robot assemblies, add components, compile explicit observation/action contracts, develop controllers, train policies, run simulations, diagnose failures, and decide complete Robot Revisions through locked benchmarks.

> A robot is a folder. Assemblies are hardware programs. Components are packages. Controllers and trainers are programs. Tasks are tests. Objectives are benchmarks. MuJoCo is the runtime. Events are the debugging protocol.

Mujica is a clean sister project of [Integrated Industry Maker](https://github.com/luokerenx4/integrated-industry-maker). It inherits INM's file-native, compile-before-run, immutable-evidence, locked-benchmark, and agent CLI principles—not its industrial domain model.

## Quick start

Requires Bun and uv.

```bash
bun install
uv sync --project runtime

bun run mujica validate examples/quadruped
bun run mujica assembly compare examples/quadruped --from baseline --to force-sensing
bun run mujica simulate examples/quadruped \
  --assembly force-sensing --controller forward-gait \
  --task forward-walk --scenario nominal --seed 101

bun run mujica simulate examples/quadruped \
  --assembly force-sensing-3dof --controller spatial-forward-gait \
  --task forward-walk --scenario actuator-delay --seed 606

bun run mujica evaluate examples/quadruped \
  --assembly force-sensing --controller forward-gait \
  --benchmark forward-locomotion
bun run mujica train examples/quadruped --training forward-residual-locomotion --seed 42
bun run mujica policies examples/quadruped
bun run mujica studio examples/quadruped --run run-e8bd80892b0f0123
bun run mujica research examples/quadruped --research forward-gait --iterations 6
bun run mujica train-research examples/quadruped --research forward-residual-policy --iterations 6
```

The bundled development slice adds a four-foot force sensor component to a quadruped, extends the Observation contract, and evaluates the complete assembly/controller change against nominal, low-friction, and lateral-push cases. Its bounded autoresearch loop keeps fixed inputs locked, records every KEEP/REVERT/CRASH attempt, updates only the declared controller parameters, and publishes each accepted result as a child Robot Revision.

The same hardware change also has an independent frozen-policy Development Candidate. It explicitly records the Assembly, contract, training configuration, Controller, and Policy transition. That candidate is honestly REVERT: the 1024-step force-aware PPO policy scores `43.3281` versus `44.0822` and misses every survival gate. Mujica records this as evidence that a real training run is not automatically a successful robot revision.

The checked-in research ledger contains 43 real MuJoCo experiments. Ten accepted controller changes improved the force-sensing quadruped from `83.3599` to `84.2544`; the built-in search then exhausted every one-step neighbor in its declared envelope without weakening the `0.02` KEEP threshold.

The Python/PyTorch lane uses a serialized force-aware PD residual prior instead of starting PPO from zero torque. Its checked-in Training Research ledger contains 11 frozen-policy experiments. One KEEP reduced the sample budget from 4096 to 2048 steps and improved the budget-aware learned-policy score from `84.1888` to `84.2398`. It remains slightly below the program-controller Robot Revision, so Mujica records it as a Policy Revision without making a false whole-robot promotion claim.

The current north-star slice closes the standing loophole. `forward-locomotion` scores net displacement toward a 1.25 m target, velocity, survival, uprightness, lateral drift, energy, model cost, and training cost across seven fixed cases. The promoted symmetric bound reaches `0.65–0.98 m` in every gating case, survives two seeded resets, low friction, payload, and a lateral push, and improves the stationary baseline by `23.5860` points. The 40 ms actuator-delay case remains visible as a scored, non-gating challenge because the current 2-DOF legs cannot yet recover it.

The periodic residual-policy lane ran 29 governed experiments. Four KEEP decisions improved its frozen score from `67.0765` to `71.2307` while reducing the selected budget to 4096 steps. It remains below the program controller's `72.9459`, so the program controller is the default Robot Revision and the learned lane remains an inspectable Policy Revision.

The spatial development slice adds abduction authority to every leg. Its 3-DOF controller passes a gating 50 N lateral push and the former 40 ms actuator-delay challenge, improving the locked development score from `59.7765` to `62.6170`. The accepted assembly is Robot Revision `quadruped-r-b1a3d1f7161a`; see [the spatial quadruped decision](docs/design/spatial-quadruped-development.md).

Native PPO then learns a governed half-scale residual over that predictive controller. The frozen policy scores `63.0350`, passes all seven gates, and improves actuator-delay progress to `0.694` with `0.030 m` drift. It is promoted as Policy Revision `quadruped-p-7423506a0965` and is the example project's default controller.

A separate held-out audit tests mirrored pushes, unseen delay durations, and compound disturbances. It exposes delay-duration overfitting and adds an explicit 69-value actuator-telemetry Assembly without falsely promoting the unsuccessful generalized policies; see [the spatial generalization audit](docs/design/spatial-generalization-audit.md).

The follow-up adds a replayable four-step history contract, a bounded GRU history encoder, calibrated-latency priors, and governed residual regularization. Pure 20–60 ms latency is solved analytically; compound latency plus disturbance remains an explicit unsolved research gate.

`mujica studio` projects the file-native evidence into a content-addressed, offline, read-only debugger. The checked-in spatial-policy Run travels `0.668 m`; Studio replays its top-down trajectory and exposes metrics, semantic events, Assembly contracts, Benchmarks, Candidates, training artifacts, and Revision lineage without becoming an editor or evaluator.

Read [the architecture](docs/ARCHITECTURE.md), [read-only Studio design](docs/design/read-only-studio.md), [forward locomotion benchmark](docs/design/forward-locomotion-benchmark.md), [project format](docs/PROJECT_FORMAT.md), [controller research design](docs/design/robot-research-loop.md), [policy training research](docs/design/policy-training-research.md), and [CLI reference](docs/CLI.md).
