# Mujica architecture

> Mujica turns robot development into an executable, testable, trainable, and agent-operable software process.

## Concrete package boundaries

- `@mujica/core` owns strict schemas, project/workspace loading, path confinement, content hashes, Robot Assembly compilation, contract diffs, benchmark locks, and revision governance.
- `@mujica/cli` owns the `mujica` command, human summaries, versioned JSON envelopes, exit behavior, and invocation of Core and the Python Runtime.
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
  -> episode events + trajectory + metrics
  -> immutable Simulation Run or Policy Artifact
  -> locked multi-case evaluation
  -> Candidate review or bounded Research proposal
  -> KEEP/REVERT/CRASH evidence and optional child Robot Revision
```

The autonomous path borrows autoresearch's small loop—human program, one editable surface, fixed evaluator, compact memory, keep/discard—but keeps authority in Core. The proposer may suggest bounded numeric controller values; it cannot write project files, change the evaluator, waive gates, or publish revisions.

See [the harness design](design/robot-development-harness.md), [research-loop design](design/robot-research-loop.md), [project format](PROJECT_FORMAT.md), and [CLI reference](CLI.md).
