# Mujica contributor guide

Mujica is an AI-native robot development harness. Domain correctness, reproducible evidence, and a complete executable loop take priority over compatibility while the project is pre-alpha.

## Product invariants

- A robot is a folder. A workspace discovers projects but owns no robot assets.
- Assemblies are hardware programs; components are self-described packages.
- Robot source compiles before it executes. Raw assembly JSON never runs directly.
- Controllers and trainers are programs. Tasks are tests. Objectives are benchmarks.
- Program Controllers declare their required Observation subset and complete produced Action contract; incompatible Assembly pairs fail before Runtime invocation.
- Training and evaluation are separate operations. Evaluation consumes a frozen Policy Artifact.
- Events are the debugging protocol. Completed runs and policies are immutable artifacts.
- Capability gates outrank aggregate score; research compares score only within the same gate-feasibility tier.
- A Coding Agent edits files and invokes the same CLI as a human; it does not manipulate a 3D scene as source state.
- A kept Development Candidate creates a new Robot Revision with explicit lineage.

## Change loop

1. Read `PLANS.md` and the active plan for non-trivial work.
2. Update the relevant design document with any changed invariant.
3. Implement source, project fixtures, and public CLI changes together.
4. Exercise `mujica validate`, `mujica assembly compile`, and the affected runtime loop.
5. Run `bun run test`.
6. Never rewrite a completed run or Policy Artifact. Write into a temporary directory and publish atomically.

Do not add placeholder packages. A package boundary must own a concrete lifecycle: TypeScript Core owns schemas/compilation/governance, CLI owns the public protocol, and Python Runtime owns MuJoCo execution and training.
