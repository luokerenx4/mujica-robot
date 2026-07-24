# Review-guided Development Work Orders

## Outcome

Given a current executable Development Review, a human or Coding Agent can produce one immutable Development Work Order that:

- names the exact locked capability blockers and their severity;
- routes each blocker only to compatible, source-governed Research Labs that can improve that primary Benchmark;
- distinguishes controller-code, RL-policy, and complete-design lanes;
- exposes exact headless commands for running each lane and regenerating the Review;
- shows unmatched intervention surfaces instead of inventing a generic optimization path; and
- remains visible in Studio beside the project status and robot evidence.

The quadruped proof must route the `sim-to-real-audit/heavy-weak` blocker to both a real controller-code lane and the existing RL-policy lane, then execute at least one bounded experiment and preserve the locked Judge outcome.

## Context

`development-review-0e2bffa0e4013dd5` correctly reports that the quadruped has passed two of three capability stages but still has fifteen gating violations. Its worst case is `sim-to-real-audit/heavy-weak`, with controller intervention ranked first.

The Review currently stops at that generic intervention surface. The project contains an exact RL Research Lab for `sim-to-real-audit`, but no exact controller Research Lab, and neither CLI nor Studio joins the Review to those governed lanes. A Coding Agent therefore still needs undocumented repository knowledge to decide what it may edit, which Benchmark is authoritative, and how to prove the result.

## Scope

In scope:

- typed Development Review and Development Work Order evidence;
- current-pointer integrity and source-staleness checks;
- exact Review-to-Research-Lab matching by primary Benchmark and compatible subject;
- immutable work-order artifacts with Agent commands and authority boundaries;
- a quadruped controller Research Lab for robust transfer;
- Studio and Workspace summaries for current Work Orders;
- one real quadruped controller experiment and, if bounded runtime permits, one RL experiment;
- before/after Review evidence for any kept source change.

Out of scope:

- changing Benchmark locks, Objectives, scenarios, or domain profiles to make a result pass;
- automatic acceptance of human review;
- unconstrained architecture search or a generic workflow engine;
- hardware actuation;
- treating a regression-only Benchmark match as an eligible improvement lane;
- promising improvement when the locked Judge returns REVERT.

## Acceptance

- `mujica project work <workspace-or-project> [--project ID] [--review ID]` creates a content-addressed immutable Work Order.
- The command rejects a stale or corrupted Review and validates exact Charter, Assembly, and Controller identity.
- Every lane names its kind, exact Research Lab, primary Benchmark, editable closure, budget, run command, and Review command.
- A lane is eligible only when its primary Benchmark is one of the Work Order blockers and its execution subject is compatible with the reviewed Assembly/Controller.
- Unmatched design, assembly, controller, or training surfaces are reported explicitly.
- Core schemas parse both Review and Work Order artifacts; Studio does not consume them as untyped arbitrary JSON.
- Studio shows current blocker ranking, eligible controller/RL/design lanes, and copyable headless commands.
- The quadruped has a valid `robust-transfer-controller` Lab with locked `sim-to-real-audit` primary evaluation and regression Benchmarks.
- At least one real isolated Agent-authored experiment is evaluated by the locked Judge; KEEP or REVERT is preserved honestly.
- All TypeScript tests, Python/MuJoCo tests, project definition validation, and generated Studio integrity checks pass.
- Durable authority and matching rules are recorded in `docs/design/review-guided-development-work-orders.md`.

## Work

- [x] Audit the gap between Development Review and existing Research Labs.
- [x] Fix the routing, authority, compatibility, and artifact contract.
- [x] Add schemas, integrity loaders, and controller source identity.
- [x] Implement `project work`, immutable evidence, and CLI tests.
- [x] Add current Work Order projection to project/workspace Studio.
- [x] Add and validate the quadruped robust-transfer controller Lab.
- [x] Run governed quadruped controller/RL experiments and regenerate Review evidence.
- [x] Run the full verification matrix, freeze generated evidence, commit, and push.

## Findings and decisions

- A Work Order is derived prioritization, not a new Judge. Benchmark locks and Research Lab definitions remain authoritative.
- Exact primary-Benchmark matching is required. A Lab that lists a blocker only as a regression may protect it but is not authorized to claim improvement on it.
- Controller-code and RL-policy are separate lanes even when Review diagnosis calls both `controller`; their editable closures and publication semantics differ.
- Work Orders are immutable because they are shared human/Agent coordination evidence. `current.json` is only a mutable pointer.
- A Work Order may expose several eligible lanes. It ranks exact blocker matches but does not silently choose or run one.
- Source staleness is checked against the Charter, compiled Assembly, Controller payload, Review, and Research Lab definition hashes.
- An experiment that returns REVERT still closes a valid learning step: it disproves a bounded hypothesis without weakening the release contract.
- Regression evaluation must preserve the original locked baseline even when the editable candidate Controller is itself that Benchmark's baseline Controller. The staged project must keep the Benchmark definition and lock artifact byte-equivalent, but recomputing the lock from deliberately changed candidate source would incorrectly reject every legal experiment.

## Progress log

- 2026-07-24: Audited the current quadruped Review and six source-governed Research Labs. Confirmed that `sim-to-real-residual-policy` is an exact RL match for `sim-to-real-audit`, while no controller-code Lab currently owns that primary Benchmark.
- 2026-07-24: Generated `development-work-order-645934bb86bfe696`, routing four failing cases to one controller-code and one RL-policy lane with no uncovered intervention surface.
- 2026-07-24: The first two controller attempts were recorded as CRASH before Judge evaluation: one used a non-portable repository-root researcher path; the second exposed an incorrect staged-lock recomputation when the edited Controller was a regression Benchmark baseline. Neither changed project source.
- 2026-07-24: Controller experiment `001-f4cbb1255fa6` in `session-517c89bdaa5dc63b` tested an early-gentle recovery change. The locked Judge returned REVERT: primary score and thirteen primary violations were unchanged, while upright and motion-quality regression gates failed.
- 2026-07-24: RL experiment `001-c7756c629625` in `session-5a27d00447e9ff7a` trained Policy `sim-to-real-residual-locomotion-c8a04a78531406ed`. It improved aggregate score by `0.9051661716444528`, reduced violations from fourteen to thirteen, and reduced severity from `39.48` to `36.26`, but the locked reference-controller gate found no lexicographic improvement and returned REVERT.
- 2026-07-24: Regenerated `development-review-53f564058e5db5c8` and `development-work-order-a1e0a386b26d0ad8`. The Work Order remains READY with four blocker cases, two eligible lanes, and no uncovered intervention surface.
- 2026-07-24: Regenerated Protocol-verified Bundle `hardware-458a24caec3e6111` and Shadow-verified Bundle `hardware-59feb46f3a150e08`, then rebound all affected capture plans and hardware evidence.
- 2026-07-24: Passed 77 TypeScript tests with 710 assertions, 43 Python/MuJoCo tests, TypeScript type-checking, project validation, hardware verification, and browser inspection of the generated Studio.
