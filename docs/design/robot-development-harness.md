# Robot development harness

Status: V1 foundation implemented.

## North star

Mujica lets Coding Agents design robot assemblies, add components, develop controllers, train policies, run simulations, diagnose failures, and validate complete Robot Revisions through locked benchmarks.

The authoritative source is a self-contained project folder. A scene viewer may eventually project artifacts, but it may never become a second editor or evaluator.

## Robot source model

A Robot Base declares its MJCF, mount catalog, built-in observation channels, action channels, mass, and attribution. A Component package declares a root-level MJCF fragment, compatible mount types, provided mounts, observation/action additions, mass/cost proxies, dependencies, license, and attribution. An Assembly selects one base and named component instances attached to compatible mounts.

The V1 compiler accepts one explicit `<!-- MUJICA_COMPONENTS -->` marker in the base MJCF. Component fragments are complete MuJoCo root elements such as `<sensor>...</sensor>`. This keeps composition deterministic and inspectable. Components that require body-local geometry must target a base-provided site in V1; arbitrary body-tree patching is deferred until a real component needs it.

The compiler rejects missing packages, directory/id mismatches, duplicate instances, incompatible or multiply occupied mounts, missing dependencies, duplicate channel names, and action/observation collisions. MuJoCo performs the final XML, referenced-name, joint, actuator, and sensor validation.

## Contracts

Observation and Action contracts are ordered, typed JSON artifacts. Channel order is executable ABI and participates in all assembly, policy, run, benchmark, and revision hashes. Adding a sensor is therefore a visible contract change, not an implicit array-length change.

## Runtime and evidence

An episode consumes a compiled model, task, scenario, seed, and either a program controller or frozen Policy Artifact. The Python host owns MuJoCo state and validates action shape/finiteness/range before writing `data.ctrl`. Controller code receives an immutable observation mapping and returns an action vector.

Every step may append a sampled trajectory row. Semantic events cover reset, controller action validation, contacts, falls, pushes, episode completion, and runtime failure. Metrics derive from runtime state and the event/trajectory stream. A completed run contains its input snapshots, manifest, `events.ndjson`, trajectory, metrics, and report. `manifest.json` is published last.

## Training boundary

Training and evaluation are different commands and processes. A Training definition fixes Assembly, Trainer, Task/Scenario distribution, seed, budget, and hyperparameters. The V1 trainer is a small readable PyTorch PPO implementation with explicit seeds and CPU defaults. Its purpose is to prove real optimizer/environment integration, not benchmark-leading locomotion.

A Policy Artifact is an immutable directory whose identity covers runtime versions, trainer/model source, dependency lock, assembly and component catalog, observation/action contracts, training config, scenarios, seeds, budget, hardware facts, training metrics, and produced model hash. Evaluation loads the frozen model and never calls trainer code.

## Benchmarks and revisions

A Benchmark is a weighted list of fixed task/scenario/seed cases plus transparent gates and objective weights. Its lock records the fixed-input hashes. Evaluation refuses drift. The candidate assembly/controller/policy is excluded from the lock.

A Development Candidate explicitly names baseline and proposed Assembly/Controller, component and contract changes, Controller files, optional Trainer/training files, optional frozen Policy transition, allowed changed files, hypothesis, and expected effect. Core compares the declaration to the compiled Assembly diff before any decision. Preview compares fixed-case evidence and cost proxies and publishes the content-derived proposed Revision identity. Candidate selection is feasibility-first: eliminating all locked baseline violations can KEEP despite a lower aggregate score only when every proposal gate, including per-case regression, passes; two feasible robots still require score improvement. Apply requires KEEP, an unchanged candidate/base/lock, and atomically creates a new immutable Robot Revision. The Revision freezes component, contract, Controller, and Policy identities and copies a referenced Policy Artifact into its snapshot. It never silently rewrites the base Assembly.

The first trained component audit is deliberately negative evidence. Both the baseline and force-sensing PPO outputs are frozen before the `trained-sensor-development` Benchmark runs. The force-sensing proposal scores `43.3281` against `44.0822`, fails survival in all three cases, and is REVERT. Adding a component and completing training are therefore not treated as proof that the resulting robot is better.

## Determinism claims

MuJoCo evaluation uses a fixed seed and deterministic CPU stepping. Policy evaluation is intended to be bitwise deterministic on the same declared software/hardware environment. Training records a reproducible configuration and uses deterministic PyTorch settings where available, but only claims best-effort deterministic training across machines.
