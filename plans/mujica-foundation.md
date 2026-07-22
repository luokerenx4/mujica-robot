# Mujica foundation

- Status: `completed`
- Updated: `2026-07-22`
- Related design: [robot development harness](../docs/design/robot-development-harness.md)

## Outcome

A Coding Agent can compile a self-contained robot assembly, run deterministic MuJoCo episodes, train a real CPU PPO policy, evaluate a frozen policy or program controller on a locked benchmark, and inspect the immutable evidence through one versioned CLI.

## Scope

### In scope

- Strict project, robot, component, assembly, controller, training, task, scenario, objective, benchmark, candidate, policy, and revision formats.
- Mount validation, MJCF fragment composition, name/reference validation delegated to MuJoCo, observation/action contract compilation, and content hashes.
- A real quadruped example with a foot-force sensor component that changes the observation contract.
- Program and frozen-policy controllers, semantic events, trajectories, metrics, immutable runs, CPU PPO training, frozen evaluation, benchmark locks, and revision creation.
- Human-readable and versioned JSON CLI output.

### Out of scope

- Interactive CAD, arbitrary mesh generation, distributed training, MJX, hardware-in-the-loop, and a graphical Studio.
- Claiming that short example training reaches production locomotion quality.

## Acceptance

- [x] `mujica validate` and `mujica assembly compile` produce a MuJoCo-loadable model plus explicit observation/action contracts.
- [x] Baseline and force-sensing assemblies have a semantic diff and distinct observation contracts.
- [x] `mujica simulate` writes a replayable immutable run with events, trajectory, metrics, source hashes, and result hash.
- [x] `mujica train` performs real gradient updates and publishes a frozen Policy Artifact with provenance.
- [x] `mujica evaluate` scores frozen controllers over fixed cases without training.
- [x] A locked Development Candidate can be previewed and a KEEP can atomically create a child Robot Revision.
- [x] TypeScript and Python tests pass.

## Work

- [x] Establish clean repository, plan, and design boundaries.
- [x] Implement Core compiler and CLI discovery/inspection surfaces.
- [x] Implement MuJoCo execution, artifacts, and PPO training.
- [x] Build the quadruped component-development fixture.
- [x] Verify the public loop and complete the acceptance audit.

## Findings and decisions

- 2026-07-22 — Reuse INM's project isolation, compile-before-run, immutable evidence, locked benchmark, and versioned CLI principles; do not retain industrial assets or simulation code.
- 2026-07-22 — TypeScript owns authored-file governance and composition. Python owns MuJoCo and PyTorch because those ecosystems are the runtime boundary, not an implementation leak.
- 2026-07-22 — V1 MJCF components are root-level fragments inserted at one explicit marker. This is intentionally narrower than arbitrary XML surgery and is sufficient for sensors and other MuJoCo root sections.
- 2026-07-22 — Policy loading requires exact Assembly, Component Catalog, Observation contract, and Action contract hashes; shape compatibility alone is insufficient.
- 2026-07-22 — A kept Revision snapshots its complete assembly source closure, fixed benchmark inputs, compiled MJCF, contracts, and evaluation so later project edits do not erase replay evidence.

## Verification

Verified on 2026-07-22:

```bash
bun run test
bun packages/mujica-cli/src/bin.ts validate examples --json
bun run mujica train examples/quadruped --training baseline-locomotion --seed 42 --json
bun run mujica train examples/quadruped --training force-aware-locomotion --seed 42 --json
bun run mujica candidate examples/quadruped --candidate foot-force-recovery --apply --json
```

Evidence: 6 TypeScript tests and 3 Python tests pass. Both assemblies load in MuJoCo 3.10.0. Real 1024-step PPO runs produced frozen baseline and force-sensing policies. The locked three-case Development Candidate scored `80.674948 -> 83.359853` (`+2.684905`) and produced Revision `quadruped-r-9a4d27c7d7cd`.

## Progress log

- 2026-07-22 — Plan created and foundation implementation started.
- 2026-07-22 — Foundation acceptance audited and completed.

## Completion

The first executable robot-development loop shipped across Core, CLI, Python Runtime, and a self-contained quadruped project. Graphical Studio, hardware-in-the-loop, arbitrary body-tree component patching, and large-scale training remain intentionally deferred rather than represented by empty packages.
