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
  --assembly baseline --controller baseline-gait \
  --task stand --scenario nominal --seed 42

bun run mujica train examples/quadruped --training baseline-locomotion --seed 42
bun run mujica policies examples/quadruped
bun run mujica research examples/quadruped --research support-controller --iterations 6
```

The bundled development slice adds a four-foot force sensor component to a quadruped, extends the Observation contract, and evaluates the complete assembly/controller change against nominal, low-friction, and lateral-push cases. Its bounded autoresearch loop keeps fixed inputs locked, records every KEEP/REVERT/CRASH attempt, updates only the declared controller parameters, and publishes each accepted result as a child Robot Revision.

The checked-in research ledger contains 43 real MuJoCo experiments. Ten accepted controller changes improved the force-sensing quadruped from `83.3599` to `84.2544`; the built-in search then exhausted every one-step neighbor in its declared envelope without weakening the `0.02` KEEP threshold.

Read [the architecture](docs/ARCHITECTURE.md), [project format](docs/PROJECT_FORMAT.md), [research-loop design](docs/design/robot-research-loop.md), and [CLI reference](docs/CLI.md).
