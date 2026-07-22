# Quadruped autoresearch loop

- Status: `completed`
- Updated: `2026-07-22`
- Related design: [robot research loop](../docs/design/robot-research-loop.md)

## Outcome

A Coding Agent or deterministic built-in proposer can run repeated, reviewable quadruped controller experiments against one locked Benchmark. Every attempt records its hypothesis, exact candidate values, metrics, gate result, KEEP/REVERT/CRASH decision, and immutable artifact. KEEP atomically advances the editable controller and creates a child Robot Revision.

## Context

The foundation proves manual assembly, simulation, training, evaluation, Candidate, and Revision operations. It does not yet provide the autonomous iterative research protocol needed to improve a quadruped over many experiments. Karpathy's `autoresearch` demonstrates the useful minimal pattern: one editable program, fixed evaluation, bounded experiments, a compact results ledger, and keep/discard continuation. Mujica needs that pattern under stronger robot-domain governance.

## Scope

### In scope

- Project-local Research definition and human-authored `AUTORESEARCH.md` program.
- One declared JSON controller configuration as the V1 editable surface, with an explicit numeric parameter allowlist and bounds.
- Built-in deterministic coordinate proposals and an external `--agent-command` JSON protocol.
- Locked Benchmark evaluation, gate enforcement, minimum improvement, immutable experiment artifacts, compact TSV memory, and CRASH recording.
- Atomic KEEP, controller stale protection, and parent-linked Robot Revision creation.

### Out of scope

- Unbounded source-code rewriting, concurrent workers, distributed training, automatic paper search, and arbitrary multi-file Development Candidates.
- Letting an Agent modify Benchmark, Scenario, Objective, dependency, or runtime files during an experiment.

## Acceptance

- [x] `mujica research ... --iterations N` executes N or an explicitly exhausted number of experiments without mutating fixed inputs.
- [x] Built-in and external proposals are validated against the exact editable parameter contract.
- [x] Every attempt produces an immutable artifact and one results-ledger row, including crashes and reverts.
- [x] KEEP atomically advances the controller, preserves REVERT behavior, and creates a child Revision from the latest lineage head.
- [x] A real quadruped research run improves or honestly exhausts the current controller under the locked sensor-development Benchmark.
- [x] CLI discovery, project validation, TypeScript tests, and Python tests pass.

## Work

- [x] Study the current repository and Karpathy autoresearch protocol.
- [x] Define schemas, invariants, and public CLI.
- [x] Implement proposal, evaluation, ledger, experiment artifact, and revision publication.
- [x] Run quadruped experiments and inspect lineage evidence.
- [x] Complete regression verification and documentation.

## Findings and decisions

- 2026-07-22 — The transferable autoresearch unit is `human program + one editable surface + fixed evaluator + compact memory + keep/discard`, not its LLM-specific training implementation.
- 2026-07-22 — Mujica Core, not the proposer, owns bounds, Benchmark locks, gates, artifact identity, writes, and Revision lineage.
- 2026-07-22 — V1 restricts autonomous edits to numeric values already present under one controller `config`; coordinated Assembly/Component/Trainer changes remain explicit Development Candidates.
- 2026-07-22 — Filesystem existence checks now use `stat`; the previous file-oriented check incorrectly treated artifact directories as absent and would have broken Revision enumeration and lineage.
- 2026-07-22 — Proposal acquisition and schema failures are immutable CRASH experiments, so an external Agent cannot erase failed attempts by returning invalid output.

## Verification

- `bun run test`: 9 TypeScript tests and 3 Python tests pass.
- `mujica validate examples/quadruped`: both MuJoCo assemblies validate; one Research definition resolves.
- 43 real locked-Benchmark experiments completed: 10 KEEP and 33 REVERT, no gate violations or unrecorded runtime crashes.
- Score improved from `83.35985271738677` to `84.25444528948661` (`+0.89459257209984`).
- A final request for 24 iterations completed seven remaining neighbors and returned `exhausted=true`.
- Revision history contains the original Development Revision followed by ten parent-linked Research Revisions.

## Progress log

- 2026-07-22 — Plan created; research protocol design and implementation started.
- 2026-07-22 — Fixed directory existence semantics after the first real run exposed a broken parent chain; invalid generated evidence was moved recoverably to `/tmp/mujica-invalid-research-lineage-20260722` and the run was repeated.
- 2026-07-22 — Completed and exhausted the bounded controller search with a real MuJoCo score improvement; documentation and regression verification completed.
