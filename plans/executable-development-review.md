# Executable Development Review

Status: completed

## Outcome

Given one complete robot Charter and one concrete Assembly/Controller subject,
Mujica produces an immutable, headless- and human-readable answer to:

1. Does this robot fit the declared design resource envelope?
2. Which capability stages pass their locked Benchmarks?
3. Does the subject satisfy the project's declared north star?
4. Which governed design, controller, training, or visual-review action is
   justified next?

## Context

Development Charters currently bind propositions and scenario witnesses, while
Candidates, Research Labs, RL Training, and Studio govern individual changes.
There is no single evidence object joining those layers. A human or Agent must
manually infer whether the current robot structure fits the requirement, which
stage is blocked, and whether an optimization result advances the project
north star.

## Scope

- Extend the Charter with a machine-checkable north-star binding and compiled
  design resource envelope.
- Evaluate one selected Assembly/Controller against every unique locked
  Benchmark named by the Charter.
- Publish a content-addressed Development Review with per-gate evidence and
  exact reproduction commands.
- Show the latest Review in Studio without granting the browser mutation or
  Judge authority.
- Exercise the protocol on the Hexapod project.

This slice does not claim that mass, Action count, Observation width, Component
cost, and contact-point count are a complete mechanical specification. It
creates the governed requirement/evidence spine on which geometry, power,
thermal, payload, manufacturability, and hardware acceptance constraints can be
added without changing the authority model.

## Acceptance

- [x] Every Charter declares one north-star Benchmark/stage and an explicit
      compiled design resource envelope.
- [x] Charter validation rejects a missing north-star stage/Benchmark or a
      north-star Benchmark outside that stage.
- [x] `mujica project review` fails closed on drifted Benchmark locks.
- [x] A Review evaluates each unique Charter Benchmark once, records all
      enforced gates, separates measured findings from intervention
      hypotheses, and publishes exact reproduction commands.
- [x] North-star success requires design-envelope feasibility, a passing
      required capability stage, and no unresolved explicitly required human
      review.
- [x] Studio shows the latest immutable Review, including design constraints,
      stage results, worst case, and Agent handoff.
- [x] The Hexapod Review is generated from the final six-foot Assembly and
      starter Benchmark and is browser-verifiable.
- [x] Existing TypeScript/Python tests and quadruped validation remain green.

## Work

1. Freeze Charter and Review authority in the design document.
2. Add Charter schema/reference validation and example declarations.
3. Implement deterministic Review evaluation and immutable artifacts.
4. Add CLI discovery/inspection and Studio projection.
5. Run the Hexapod Review, inspect its evidence, and verify the browser view.
6. Refresh governed Harness identities, run the full suite, and publish.

## Findings and decisions

- Authored stage status is project intent; observed Review status is evidence.
  Mujica never silently rewrites the Charter from one evaluation.
- A stage is evaluated against every gating case of each locked Benchmark it
  names, not only the visually highlighted Task/Scenario witnesses.
- Human visual judgement remains a hypothesis. Passing numerical gates can
  request visual review, but Studio cannot turn that review into a Judge
  verdict.

## Progress log

- 2026-07-24: Audited the current project-first harness. Individual design,
  Controller, RL, Judge, and visual-debugging protocols exist, but no immutable
  project-level requirement-to-evidence review joins them.
- 2026-07-24: Published Hexapod
  `development-review-9b21f2a19cff2d93`: compiled design PASS, one of one
  numerical capability stages PASS, zero gate violations, and
  `HUMAN_REVIEW_REQUIRED`. Browser verification exercised all 200 authoritative
  MuJoCo frames and the exact Agent handoff.
- 2026-07-24: Published Quadruped
  `development-review-0e2bffa0e4013dd5`: compiled design PASS, two of three
  numerical stages PASS, and `DEVELOPMENT_REQUIRED`. The locked
  `robust-transfer` stage has 15 gate violations; the worst case is
  `sim-to-real-audit/heavy-weak`, with Controller as the eligible intervention
  surface.
- 2026-07-24: Refreshed all 14 Benchmark locks and published
  `verification-e08e021727f14483` (`PROTOCOL-VERIFIED`) plus
  `verification-4d09015beca819e4` (`SHADOW-VERIFIED`). Full regression passed
  75 TypeScript and 43 Python/MuJoCo tests.
