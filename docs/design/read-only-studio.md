# Read-only Studio

Status: implemented vertical slice.

## Boundary

Studio is a debugger for evidence already produced by the file-native Harness. It is not a robot editor, simulator, evaluator, or mutable database. The authoritative inputs remain `mujica.json`, Robot Assemblies and Components, compiled contracts, immutable Runs and Policies, locked Benchmarks, Candidates, and Revision manifests.

`mujica studio <project> [--run ID]` reads those inputs and writes a content-addressed cache projection beneath `.mujica/studio/<snapshot-id>/`. The snapshot contains `snapshot.json` plus one self-contained `index.html`; it has no external network assets and uses a restrictive Content Security Policy. Repeating the command over identical evidence yields the same snapshot id.

## Debugging surfaces

The V1 projection shows:

- every compiled Assembly, component membership, mass/cost proxy, and ordered Observation/Action contract;
- a selected completed Simulation Run, its metrics, score identity, semantic Event timeline, and top-down trajectory playback;
- bounded deterministic sampling for long NDJSON trajectories and event streams, with total row count and stride made visible;
- Robot Revision lineage and Policy Revision identities;
- Training Run and frozen Policy inventory;
- fixed Benchmark definitions and declared Development Candidates.

Studio never calls MuJoCo and never computes KEEP/REVERT. Missing Run ids are rejected instead of being silently substituted.

## North-star evidence

The checked-in `run-e8bd80892b0f0123` evaluates the promoted 3-DOF frozen residual Policy in the nominal forward-walk task. It completes 250 control steps, survives the full 5 seconds, moves forward `0.668120 m`, and stays within `0.005782 m` lateral drift. This gives Studio a real locomotion trajectory rather than a fabricated UI fixture.
