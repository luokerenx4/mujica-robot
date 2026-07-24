# Review-guided Development Work Orders

## Purpose

Mujica separates three questions that are easy to blur:

1. **What robot are we trying to build?** The Development Charter and compiled Assembly answer this.
2. **What capability is currently blocked?** The immutable Development Review answers this using locked Benchmarks.
3. **What may an Agent change next?** A Development Work Order answers this by joining the Review to real Research Lab source closures.

A Work Order is not a task description written by a language model. It is a deterministic, content-addressed projection of project evidence and governed development lanes.

## Authority

The authority order is:

1. Development Charter defines proposition, design envelope, capability stages, and north star.
2. Benchmark locks and Objectives define numerical acceptance.
3. Development Review measures one exact Assembly and Controller against that contract.
4. Research Lab definitions constrain editable source, budget, regressions, and promotion.
5. Development Work Order derives eligible next actions from items 3 and 4.
6. Research Judge decides KEEP or REVERT.
7. A new Development Review measures the resulting exact subject.

The Work Order cannot edit locks, relax gates, accept a visual claim, promote an experiment, or claim that a hypothesis worked.

## Evidence model

Each immutable Work Order records:

- exact project, Charter hash, Review id/hash, and reviewed subject hashes;
- ordered gating blockers with Benchmark, case, severity, hypotheses, and reproduction command;
- eligible lanes with Research Lab definition hash, execution kind, subject, editable closure, budgets, primary and regression Benchmarks;
- exact `research run` command prefix and exact `project review` follow-up command;
- uncovered intervention surfaces;
- an authority-boundary statement.

The content hash determines `development-work-order-<16 hex>`. `development-work-orders/current.json` points to the latest successfully written artifact but is never evidence by itself.

## Routing rules

A Research Lab is eligible only when:

- its primary Benchmark is a failing locked Benchmark in the reviewed subject;
- its execution Assembly equals the reviewed Assembly, directly for controller Labs or through the Training definition for policy Labs;
- a controller Lab targets the reviewed program Controller;
- a policy Lab names a compatible reference Controller when the reviewed Controller is program-based, or targets the reviewed policy Controller directly;
- a development Lab's Candidate owns the same primary Benchmark and exact applicable subject;
- its definition and program pass normal project validation.

Regression Benchmarks never create eligibility. They only constrain the Judge after a lane has matched its primary Benchmark.

During isolated evaluation, the original project proves every lock against its frozen inputs. The staged project must retain byte-equivalent Benchmark definitions and lock artifacts, while its explicitly editable candidate source is expected to differ. Mujica therefore evaluates the immutable baseline in the original project and the candidate in the staged project. It does not recompute a regression lock from candidate source: that would make a legal Controller edit impossible whenever the reviewed Controller is also the regression Benchmark baseline.

Review hypothesis surfaces map as follows:

| Review surface | Eligible lane kinds |
| --- | --- |
| `controller` | `controller-code`, `rl-policy` |
| `training` | `rl-policy` |
| `assembly` or `design` | `complete-design` |
| `human-review` | none; Studio review is required |

If no compatible Lab covers a surface, the Work Order records it in `uncoveredSurfaces`. This is an actionable architecture gap, not permission to widen an existing Lab.

## Lifecycle and staleness

Work Order generation reloads and parses the Review, verifies its content hash and manifest, then recomputes Charter, Assembly, morphology, and Controller identities. A mismatch is a hard stale-evidence error.

Research Lab definitions and human-authored programs are hashed into each lane. A Work Order remains historically inspectable after those sources change, but its run command is only a plan. `research run` independently reloads and enforces the current Lab before executing.

After an experiment:

- REVERT preserves the experiment, evaluation, and visual Review while leaving the source subject unchanged.
- KEEP publishes the governed Revision defined by the Lab.
- `project review` must be run on the resulting exact Assembly and Controller to make a new north-star claim.

Mujica does not infer project completion from a Work Order or a Research verdict.

## Human and Agent interfaces

The CLI JSON envelope is canonical for Agents. It includes immutable artifact paths, complete argv arrays, hashes, and explicit effects.

Studio projects the same typed Work Order for humans: ranked blockers, lane kind, editable closure, budget, and copyable commands. Studio does not execute experiments or modify authority-bearing source.

## Conservative boundary

This design intentionally avoids a general workflow DAG. The join has only three existing domain objects—Review, Research Lab, and follow-up Review—and only creates evidence when all identities are concrete. New robot morphologies gain routing by declaring real Charters, Benchmarks, Candidates, and Research Labs rather than by adding framework plug-ins.
