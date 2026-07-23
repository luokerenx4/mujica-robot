# Read-only Studio

Status: implemented vertical slice.

## Boundary

Studio is a debugger for evidence already produced by the file-native Harness. It is not a robot editor, simulator, evaluator, or mutable database. The authoritative inputs remain `mujica.json`, Robot Assemblies and Components, compiled contracts, immutable Runs and Policies, locked Benchmarks, Candidates, and Revision manifests.

`mujica studio <project> [--run ID]` reads those inputs, creates or reuses a content-addressed MuJoCo replay beneath `.mujica/replays/<replay-id>/`, and writes an offline projection beneath `.mujica/studio/<snapshot-id>/`. The snapshot contains `snapshot.json`, `index.html`, and a verified copy of the replay frames; it has no external network assets and uses a restrictive Content Security Policy. Repeating the command over identical evidence yields the same ids.

## Debugging surfaces

The V1 projection shows:

- every compiled Assembly, component membership, mass/cost proxy, and ordered Observation/Action contract;
- a selected completed Simulation Run, its metrics, score identity, semantic Event timeline, and top-down trajectory playback;
- actual MuJoCo-rendered 3D poses synchronized with play/pause, stepping, speed, scrubbing, Event seeking, health, attitude, motion, contact, and Action telemetry;
- bounded deterministic sampling for long NDJSON trajectories and event streams, with total row count and stride made visible;
- Robot Revision lineage and Policy Revision identities;
- Training Run and frozen Policy inventory;
- fixed Benchmark definitions and declared Development Candidates.

Studio never calls MuJoCo and never computes KEEP/REVERT. Missing Run ids are rejected instead of being silently substituted.

Studio may display a content-addressed visual replay prepared by the Python Runtime. MuJoCo reconstructs every pose from the completed Run's recorded `qpos`; Studio remains a read-only projection and only selects a derived frame. See [Visual simulation debugger](visual-simulation-debugger.md).

## North-star evidence

The checked-in `run-e8bd80892b0f0123` evaluates the promoted 3-DOF frozen residual Policy in the nominal forward-walk task. It completes 250 control steps, survives the full 5 seconds, moves forward `0.668120 m`, and stays within `0.005782 m` lateral drift. This gives Studio a real locomotion trajectory rather than a fabricated UI fixture.
