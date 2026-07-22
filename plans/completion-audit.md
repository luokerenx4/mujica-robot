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

1. Candidate manifests do not yet explicitly declare contract, Controller, Trainer, and Policy changes, and the evaluator does not compare those declarations with the compiled semantic diff.
2. Development Revision manifests omit component, Controller, and Policy identities even though the source snapshot exists.
3. Component manifests still lack the complete physical/kinematic inventory required for agent-readable hardware diffs. Migrating existing components changes their content-addressed Assembly identity and therefore needs an explicit frozen-Policy migration strategy.
4. The HIL/real boundary now exports immutable driver Bundles and verifies external Evidence without conflating dry-run protocol checks with hardware proof. Actual HIL/real evidence still requires an external device.

## Current slice

- Add a strict declared change set to every Candidate.
- Reject a Candidate when its declared component/contract/controller change differs from compiled reality or when declared mutable files escape `allowedChanges`.
- Publish component hashes, Controller hash, Policy hash/id, contract hashes, and the verified change set in every kept Development Revision.
- Expose the verified change set and proposed Revision identity through the existing agent CLI.
- Add regression tests and update the public format/design documentation.

## Verification

```bash
bun run mujica validate examples/quadruped
bun run mujica candidate examples/quadruped --candidate foot-force-recovery --json
bun run mujica assembly compile examples/quadruped --assembly force-sensing-3dof --json
bun run test
```
