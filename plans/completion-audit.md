# Complete harness audit

Status: active

## Objective

Audit the implemented Mujica repository against the complete robot-development-harness constraints and close missing executable boundaries without invalidating immutable evidence.

## Evidence already present

- Robot Base, Component, Assembly, deterministic MJCF compilation, and explicit Observation/Action contracts.
- Program and frozen-policy controllers, native PPO training, immutable Training Runs and Policy Artifacts.
- Locked multi-case Benchmarks, simulation trajectories/events, Development Candidates, Robot Revisions, and bounded controller/training research.
- A real foot-force component slice and a 3-DOF morphology revision with governed benchmark evidence.

## Audited gaps

1. Resolved: Candidate manifests explicitly declare contract, Controller, Trainer, and Policy changes; evaluation compares the declaration with the compiled semantic diff and exact allowed files.
2. Resolved: kept Development Revisions publish component, Controller, Policy, contract, and verified-change-set identities in addition to immutable sources and evaluation evidence.
3. Resolved: Component manifests carry complete physical/kinematic inventories. Full Assembly provenance is separated from execution identity, and six frozen Policies were migrated only through byte-identical MJCF/contract proofs.
4. Inherently external: the HIL/real boundary exports immutable driver Bundles and verifies separately captured Evidence without conflating dry-run protocol checks with hardware proof. Actual HIL/real evidence still requires an external device.

## Current audit state

- Candidate, Revision, Component inventory, Policy compatibility, Studio, and Hardware Bundle boundaries are executable and regression-tested.
- Component instance configuration is now a closed, typed MJCF binding: resolved defaults enter semantic diffs, and inert or invalid parameters fail compilation.
- Base-owned structural Mount slots now compile mechanical Component geometry into a specific MuJoCo body; the payload slice proves the resulting geom and mass delta independently in Python.
- The checked-in dry-run proves only protocol conformance. It intentionally remains `hardwareVerified=false` until a real HIL or physical device produces evidence.
- Further work should grow robot capability or add a real device adapter, rather than weakening the evidence model with simulated hardware claims.

## Verification

```bash
bun run mujica validate examples/quadruped
bun run mujica candidate examples/quadruped --candidate foot-force-recovery --json
bun run mujica assembly compile examples/quadruped --assembly force-sensing-3dof --json
bun run test
```
