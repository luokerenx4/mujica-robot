# Policy training research

Status: V1 implemented.

Related: [Research Lab V2](research-lab-v2.md), [robot research loop](robot-research-loop.md), [architecture](../ARCHITECTURE.md), and [CLI](../CLI.md).

## Purpose

Mujica Training Research applies the same bounded autoresearch discipline to native Python/PyTorch training: one human program, one declared Training JSON surface, fixed Trainer and evaluator code, immutable attempts, compact memory, and KEEP/REVERT/CRASH decisions owned by Core.

This V1 protocol remains executable for historical ledgers. New source-level ML research uses Research Lab V2, which applies the same frozen-policy judgement to a declared Trainer/model/Training source closure in an isolated workspace.

Training reward is diagnostic. A candidate is judged only after the resulting Policy is frozen and evaluated deterministically across every case in a locked Benchmark. Every candidate Policy and Training Run remains immutable, including REVERT.

## Residual policy contract

The first learned quadruped policy does not start from zero torque. `force-residual-ppo` stores a `force-aware-pd-residual` action transform in `architecture.json`. Both PPO collection and frozen inference call the same Runtime function:

```text
raw neural action
  -> force-aware PD prior from joint, foot-force, and IMU observations
  -> add scaled residual torque
  -> clip to the compiled Action contract
```

The actor head is initialized to zero, so its deterministic initial behavior is exactly the stable sensor-aware prior. PPO learns only residual torque. Older identity-transform Policy Artifacts remain loadable.

The forward-locomotion lane adds `force-aware-gait-residual`. The serialized transform includes gait frequency, left/right and front/rear phase, hip and knee trajectories, contact feedback, PD gains, and residual scale. Both collection and inference receive simulation time, so the neural residual wraps the exact same periodic prior instead of an approximation hidden in Trainer code.

## Authored contract

`training-research/<id>.training-research.json` declares a locked Benchmark, one Training definition, one promoted policy Controller, one fixed seed, an `AUTOTRAIN.md` program, numeric parameter bounds, minimum improvement, and a per-invocation budget.

V1 can edit only declared numeric fields already present in `training/<id>.training.json`. Trainer source, Runtime source, dependency locks, Assembly, contracts, task, scenarios, objective, evaluation seeds, and Benchmark remain fixed.

## Identity and memory

Benchmark locks cover the Python Runtime source, production Core/CLI evaluator source, Python and Bun dependency locks, baseline robot/controller, objective, tasks, scenarios, weights, and seeds. Training Run and Policy identities include Runtime and Harness source hashes, dependency locks, Trainer hash, Training hash, contracts, seed, budget, and model hash.

Experiment de-duplication is scoped to the same Research definition, program, Benchmark lock, Trainer hash, and dependency lock. A Runtime, evaluator, Trainer, or dependency change therefore reopens configurations that must be retested.

## KEEP transaction

For each proposal, Core trains or reuses a content-addressed Training Run, freezes a Policy, evaluates it through a temporary in-memory Controller, applies gates, and compares it to the currently promoted Policy. KEEP rechecks both source files, atomically advances the Training definition and promoted Controller, and publishes a parent-linked Policy Revision containing the Policy, source closure, compiled robot, and before/after evaluation.

Policy Revisions are separate from whole-robot Revisions. This avoids pretending that an improvement inside the learned-policy lane supersedes a stronger program-controller Robot Revision. A future whole-robot Candidate may explicitly promote the learned lane when it wins the complete robot comparison.

A Judge-kept Policy Revision may also become the source of a shadow-only
Hardware Bundle before whole-robot promotion. Export freezes its compiled model,
Controller pointer, Policy bytes, contracts, and Judge evidence, then derives an
authority ceiling that no Target, Plan, or authorization can widen. Frozen
networks are preheated before driver connection so lazy framework startup is
measured and removed outside the device control deadline. This path gathers
device evidence; it does not change the Robot Revision head.

## First result

The checked-in run contains 11 real frozen-policy experiments: one KEEP and ten REVERT. Reducing PPO from 4096 to 2048 steps improved the budget-aware score from `84.18884075657773` to `84.23980305153188` (`+0.050962294954146614`), then the bounded neighborhood exhausted. The learned policy remains slightly below the best program controller (`84.25444528948661`) after charging the Objective's training-step cost, so it is not promoted as the whole-robot head.

## Forward locomotion result

The forward lane trains on nominal, seeded reset, low-friction, payload, lateral-push, and actuator-delay scenarios, then evaluates seven locked cases. Its ledger contains 29 governed attempts across the initial and corrected research-program contexts. Four KEEP decisions selected 4096 steps, learning rate `0.0002`, two epochs, and clip ratio `0.15`, improving the frozen score from `67.07651040151221` to `71.23071451203992`. A final context-correct replay exhausted all eight one-step neighbors with no further KEEP.

The program gait remains stronger at `72.94594910737753`. The learned result is therefore a Policy Revision, not the whole-robot head.
