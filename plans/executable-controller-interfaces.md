# Executable Controller interfaces

- Status: `completed`
- Updated: `2026-07-23`
- Related design: [Program Controller interface contract](../docs/design/program-controller-interface.md)

## Outcome

A human or Coding Agent can discover exactly which named Observation channels a Program Controller consumes and which ordered Action channels it produces. Mujica rejects an incompatible Assembly/Controller pair before starting the Python Runtime, while valid quadruped combinations continue through real MuJoCo evaluation.

## Context

A real evaluation paired `latency-aware-spatial-gait` with `force-sensing-3dof`. The Controller reads `actuator-delay-steps`, but the Assembly does not provide that channel. Because Program Controller manifests declared only an entry point and opaque config, the mismatch escaped validation and failed inside the episode with a Python `KeyError`. Frozen policies already bind exact contract hashes; Program Controllers need an explicit, inspectable subset contract.

## Scope

### In scope

- Required named Observation channels and ordered produced Action channels in every Program Controller manifest.
- Core compatibility checks for channel presence, size, order, and Action bounds before Runtime invocation.
- Compatibility validation for project defaults, Benchmark baselines, Development Candidates, Research definitions, and Hardware Targets.
- `mujica controller list|inspect` with human and versioned JSON output.
- Quadruped fixtures, tests, format/CLI/design documentation, and renewed Benchmark locks.

### Out of scope

- Static analysis of arbitrary Python source.
- Allowing Controllers to transform or rename channels implicitly.
- A generic type system for tensor layouts beyond named channel and flat size.
- Benchmark failure diagnosis and autonomous morphology search; these build on this contract in later plans.

## Acceptance

- [x] Every checked-in Program Controller declares its required Observation and produced Action interface.
- [x] An incompatible Controller fails before Python Runtime invocation with the exact missing or mismatched channel.
- [x] Valid Controller/Assembly pairs pass project validation and real MuJoCo evaluation.
- [x] `controller list|inspect` exposes interface data in human and JSON modes and appears in machine-discoverable help.
- [x] Benchmark locks, docs, TypeScript tests, and Python tests pass without rewriting immutable Runs, Policies, or Revisions.

## Work

- [x] Reproduce the undeclared `actuator-delay-steps` failure.
- [x] Define the minimal manifest contract and compatibility rules.
- [x] Implement Core validation and CLI discovery.
- [x] Migrate quadruped Program Controller manifests and renew affected locks.
- [x] Run regression and real MuJoCo verification.

## Findings and decisions

- 2026-07-23 — Program Controllers consume a named subset of Observations but produce the complete ordered Action vector. The manifest models those asymmetrical semantics instead of pretending both sides are exact full contracts.
- 2026-07-23 — Runtime exceptions are still recorded for dynamic failures, but deterministic interface incompatibility is a source-validation error and must fail before an episode starts.
- 2026-07-23 — Frozen Policy Controllers retain exact content-addressed contract hashes; this plan does not weaken that stronger compatibility rule.
- 2026-07-23 — Action bounds are part of the declared output ABI: the existing 2-DOF robot uses `[-6, 6]` Nm while the 3-DOF robot uses `[-8, 8]` Nm. The migration exposed and preserved that real difference.

## Verification

- `bun run mujica validate examples/quadruped --json`: 11 Controllers and all eight Assemblies validate across Core and MuJoCo.
- Incompatible `force-sensing-3dof` plus `latency-aware-spatial-gait` fails with the missing `actuator-delay-steps` channel before Python Runtime invocation.
- `mujica controller inspect` identifies `force-sensing-history-3dof` as the Controller's sole compatible Assembly and returns an executable next action.
- Real MuJoCo Run `run-7f9847695ec2f0d9` executes the valid history/Controller pair at 60 ms delay: survival `1.0`, forward progress `0.3542003157`, lateral drift effectively zero.
- Six authored Benchmark locks were renewed against the new Controller identities and harness source.
- `bun run test`: 31 TypeScript tests pass.
- Python Runtime: 15 tests pass.

## Progress log

- 2026-07-23 — Plan created after a real spatial-generalization invocation exposed the missing static Controller boundary.
- 2026-07-23 — Migrated all Program Controller manifests, added discovery and fail-fast enforcement, renewed governed identities, and completed regression plus real Runtime verification.

## Completion

Program Controller compatibility is now an explicit source contract and a discoverable CLI capability. Invalid robot/program combinations cannot consume simulation time or fail as opaque Python dictionary errors.
