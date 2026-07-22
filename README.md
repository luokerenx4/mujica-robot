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
```

The bundled development slice adds a four-foot force sensor component to a quadruped, extends the Observation contract, and evaluates the complete assembly/controller change against nominal, low-friction, and lateral-push cases.

Read [the architecture](docs/ARCHITECTURE.md), [project format](docs/PROJECT_FORMAT.md), and [CLI reference](docs/CLI.md).
