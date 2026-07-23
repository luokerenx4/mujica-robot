# Research Lab V2

- Status: `completed`
- Updated: `2026-07-23`
- Related design: [Research Lab V2](../docs/design/research-lab-v2.md), [Policy training research](../docs/design/policy-training-research.md)

## Outcome

Mujica lets a Coding Agent perform real robot research rather than only coordinate-search declared numbers. A single governed Research Lab can change an explicit source closure for a program Controller, an ML training lane, or a complete Development Candidate; every attempt runs in an isolated project workspace, produces immutable evidence, and is judged by locked robot Benchmarks before any source or Revision is promoted.

## Context

The V1 Controller Research and Training Research loops already preserve gates, immutable attempts, frozen Policies, and Revision lineage. Their editable surfaces are nevertheless limited to numeric JSON paths and are split across two schemas and two commands. That prevents an Agent from researching network architecture, reward construction, curriculum, Controller algorithms, or coordinated robot changes in the same way that `autoresearch` permits full changes inside one bounded `train.py`.

Karpathy's `autoresearch` demonstrates three useful boundaries: a human-authored research program, an Agent-owned editable source surface, and an immutable evaluator with a comparable budget. Mujica needs the same simplicity without copying its unsafe reset-based state handling, single-metric judgement, or lack of deployable robot artifacts.

## Scope

### In scope

- Add one canonical Research Lab V2 definition with a human program, explicit editable source closure, locked Judge, budget, execution lane, and promotion rule.
- Support program-controller, frozen-policy, and complete Development Candidate experiment lanes without separate research protocols.
- Run Agent edits in an isolated temporary project, reject writes outside the declared closure, and capture source patches and hashes.
- Preserve every experiment, Training Run, Policy, evaluation, and verdict, including REVERT and CRASH.
- Apply KEEP atomically with stale-source protection; retain gate-first lexicographic selection.
- Keep V1 Research and Training Research readable and executable during migration.
- Demonstrate the policy lane with an upright residual-learning Lab whose frozen Policy is evaluated on the locked upright capability.
- Expose Lab definitions, sessions, experiments, and lineage to CLI inspection and Studio.

### Out of scope

- Treating training reward or training completion as robot acceptance.
- Allowing Agent edits to Runtime, Benchmark locks, evaluation seeds, or undeclared project files.
- Requiring a particular Agent vendor, distributed training backend, or GPU.
- Claiming physical verification from MuJoCo evidence.

## Acceptance

- [x] `mujica research inspect|run|status` discovers and operates a V2 Lab through one public protocol.
- [x] A source proposal can add, edit, or delete only declared paths inside an isolated project workspace; an escape becomes CRASH evidence and never touches the source project.
- [x] Controller, policy, and development lanes share the same Experiment and decision model.
- [x] Policy experiments train first, freeze a content-addressed Policy, and only then evaluate it without learning.
- [x] Every attempt has a compact ledger row plus an immutable directory containing proposal, patch, before/after hashes, execution references, evaluation, and verdict.
- [x] KEEP is stale-safe and atomic; REVERT and CRASH leave the project source unchanged.
- [x] V1 definitions remain valid while at least one checked-in V2 Lab exercises the new protocol.
- [x] The upright residual Lab produces real Training and Policy Artifacts and locked Benchmark evidence.
- [x] Project validation, compilation, TypeScript tests, Python tests, and affected CLI smoke tests pass.
- [x] Stable design decisions, user documentation, and Studio projection are updated; evidence is committed and pushed.

## Work

- [x] Audit V1 schemas, commands, evidence, and `autoresearch` boundaries.
- [x] Implement the V2 Core schema, loader, validation, and compatibility inventory.
- [x] Implement isolated source transactions, proposal protocol, experiment artifacts, and unified CLI.
- [x] Implement controller, policy, and development executors with shared judgement.
- [x] Add and run the upright residual policy Lab.
- [x] Add inspect/Studio surfaces, migrate documentation, verify, commit, and push.

## Findings and decisions

- 2026-07-23 — Copy the `program / editable source / fixed judge` invariant from `autoresearch`, not its three literal files. A robot experiment has multiple executable artifacts and hard capability gates.
- 2026-07-23 — Researcher and integrator are permission roles connected by immutable Policy Artifacts. One or many Agents may fill them; the Harness must not depend on an Agent topology.
- 2026-07-23 — V2 permits source-level research but only inside an explicit path closure. Benchmark locks, Runtime, evaluator, tasks, scenarios, and seeds remain outside that closure.
- 2026-07-23 — Fixed environment transitions are the primary ML sample budget; wall clock is an upper safety bound and part of execution evidence. Robot comparison remains gate-first, then severity, score, and cost.
- 2026-07-23 — Disposable project copies are the portable isolation primitive for V2. They avoid destructive branch resets and work when a robot folder is not itself a Git repository.

## Progress log

- 2026-07-23 — Opened from V1 evidence: nine bounded Controller Research definitions, four Training Research definitions, real PPO Policies and Policy Revisions, but no governed source-editing experiment protocol.
- 2026-07-23 — Reviewed `karpathy/autoresearch` at commit `228791fb499afffb54b46200aca536f79142f117`: its useful invariants are one human program, one Agent-editable implementation, one fixed evaluator, fixed budget, compact results, and autonomous KEEP/discard iteration.
- 2026-07-23 — Added the canonical V2 schema and CLI for controller, policy, and development lanes. Agent proposals carry only hypothesis metadata; the filesystem diff in the disposable project is authoritative.
- 2026-07-23 — Added serialized Program Controller priors for residual Policies. Policy `upright-residual-locomotion-1d4c901d04ccfabb` freezes the exact `upright-traction-gait` source and completed 2048 PPO transitions in Training Run `training-9c29578571faf758`.
- 2026-07-23 — Session `session-2d54b3b2e5ee8251`, Experiment `001-7244577953a6` raised the primary score from `76.090968` to `76.161163`, but was correctly REVERT after three regression gates crossed from passing to failing. Candidate Training Run `training-9652ae612a6f33a7`, Policy `upright-residual-locomotion-b097ebe5d74ddec3`, patch, evaluations, and verdict remain immutable evidence; source stayed unchanged.
- 2026-07-23 — Session `session-9d64459a125d7019`, Experiment `001-2a398b270824` deliberately attempted to edit `objectives/upright-locomotion.objective.json`. The isolated run recorded CRASH and the original Objective hash remained byte-identical.
- 2026-07-23 — Studio now projects V2 Labs, Sessions, Experiments, hypotheses, deltas, and gate reasons. Final verification passed TypeScript `39/39`, Python `27/27`, all nine Assembly Runtime validations, and explicit compilation of `command-conditioned-history-3dof`.
