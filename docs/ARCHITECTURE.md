# Mujica architecture

> Mujica turns robot development into an executable, testable, trainable, and agent-operable software process.

## Concrete package boundaries

- `@mujica/core` owns strict schemas, project/workspace loading, path confinement, content hashes, Robot Assembly compilation, contract diffs, benchmark locks, and revision governance.
- `@mujica/cli` owns the `mujica` command, human summaries, versioned JSON envelopes, exit behavior, and invocation of Core and the Python Runtime.
- `@mujica/studio` owns a read-only, content-addressed projection of project source and immutable evidence into an offline debugger.
- `mujica_runtime` owns MuJoCo model validation, episodes, controllers, trajectories, semantic events, metrics, PPO training, Policy Artifacts, and frozen evaluation.

There is no generic plugin framework. New Runtime and Trainer backends split only when they have an independent implementation and lifecycle.

## Compile and execution pipeline

```text
mujica.json + Robot Base + Component packages + Robot Assembly
  -> strict schema validation and root-confined resolution
  -> mount compatibility and instance/name validation
  -> deterministic MJCF fragment composition
  -> observation/action contract compilation
  -> content-addressed compiled robot directory
  -> MuJoCo load validation
  -> controller or trainer program
  -> optional static or periodic force-aware PD prior + learned residual action
  -> episode events + trajectory + net-motion/robustness metrics
  -> immutable Simulation Run or Policy Artifact
  -> locked multi-case evaluation
  -> Candidate review or bounded Research proposal
  -> KEEP/REVERT/CRASH evidence and optional child Robot Revision
  -> immutable Hardware Bundle -> external driver Evidence -> protocol/HIL/real verification
```

The autonomous path borrows autoresearch's small loop—human program, one editable surface, fixed evaluator, compact memory, keep/discard—but keeps authority in Core. The proposer may suggest bounded numeric controller values; it cannot write project files, change the evaluator, waive gates, or publish revisions.

The training path freezes every candidate Policy before scoring it. Training reward never decides KEEP. Whole-robot Revisions and Policy Revisions are distinct lineages, so a learned-lane improvement cannot silently replace a stronger robot controller. Development Candidate change declarations are compiled and verified before evaluation; kept Revisions freeze component, contract, Controller, and Policy identities in addition to source/evaluation snapshots. Benchmark locks include production evaluator source and dependency locks, not only authored JSON inputs. Locomotion evaluation uses net displacement and target distance, so standing or oscillating cannot masquerade as walking; seeded reset perturbations make multi-seed cases physically distinct.

Hardware export is downstream of Revision governance. The Bundle freezes the deployable contracts and safety envelope; verification never trusts a mutable project pointer and re-hashes the embedded Revision, Controller, Target, and contracts. Dry-run protocol conformance is explicitly distinct from HIL or physical-hardware evidence.

See [the harness design](design/robot-development-harness.md), [read-only Studio](design/read-only-studio.md), [hardware verification boundary](design/hardware-verification-boundary.md), [forward locomotion benchmark](design/forward-locomotion-benchmark.md), [controller research](design/robot-research-loop.md), [policy training research](design/policy-training-research.md), [project format](PROJECT_FORMAT.md), and [CLI reference](CLI.md).
