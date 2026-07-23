# Human-guided Research Briefs

Status: completed

## Outcome

A human can turn one or more provenance-bound visual observations into an
immutable Research Brief for a specific Research Lab. A Coding Agent receives
that exact Brief inside its isolated experiment request, while locked
Benchmarks—not human confidence or severity—remain the only promotion authority.

## Context

Studio and the CLI now share exact Run-frame and Hardware-Capture contexts, and
human observations are durable hypotheses. Research Lab V2 still receives only
its program, current evaluation, and experiment history. Connecting the two
today requires unstructured copy/paste, loses the selected observation identity,
and does not prove which human input influenced a Research Session.

## Scope

- Add a content-addressed Research Brief artifact that binds a Lab, its program
  and Benchmark lock, and one or more verified human observations with their
  exact evidence contexts.
- Add CLI creation/inspection and let `research run --brief ...` verify and
  freeze the Brief into the Session and every Agent request.
- Project the handoff into Studio so a human can select a recorded observation
  and Lab, then copy the exact headless command.
- Preserve the authority boundary: observations prioritize investigation;
  editable source closure, budgets, regression Benchmarks, and the Judge remain
  unchanged.

Out of scope:

- automatically converting prose into reward or Controller changes;
- allowing a Brief to edit source, widen a Lab, change a Benchmark lock, or
  force KEEP;
- silently selecting every human observation;
- running an expensive autonomous Training campaign merely to prove transport;
- rewriting completed observations, Runs, Captures, Research Sessions, or
  Revisions.

## Acceptance

- [x] Brief creation rejects missing, tampered, duplicated, or excessive
  observations and publishes deterministic immutable bytes.
- [x] Brief inspection verifies its own hashes and every referenced observation.
- [x] `research run --brief` rejects a Brief for another or changed Lab and
  passes the exact verified payload and authority boundary to the isolated Agent.
- [x] Session and Experiment identities/manifests retain Brief provenance.
- [x] Studio exposes an explicit observation/Lab handoff and copies executable
  `research brief` CLI arguments without writing project state.
- [x] Core, CLI, Studio, browser, project, MuJoCo/Python, docs, commit, and push
  validation pass while preserving the user-owned untracked Run.

## Work

1. Define and verify the Research Brief contract.
2. Implement Brief CLI lifecycle and Research Lab request binding.
3. Add the Studio human-to-Agent handoff.
4. Validate transport, authority boundaries, and the full repository.
5. Document, complete, commit, and push.

## Findings and decisions

- 2026-07-23 — A Brief is a derived handoff artifact, not evidence and not a
  Judge decision. Its source observations remain human hypotheses.
- 2026-07-23 — Lab selection is explicit. Mujica will not infer an editable
  surface or ML objective from observation prose.
- 2026-07-23 — The Brief freezes current Lab/program/Benchmark-lock identities.
  A later Lab or lock change makes it stale for execution rather than silently
  reinterpreting the human input.
- 2026-07-24 — Observation inputs are sorted before hashing, Lab selection is
  always explicit, and Researcher request version 3 transports the exact Brief
  while retaining the hypothesis/Judge authority split.
- 2026-07-24 — Generated `human-observations/` and `research-briefs/` roots are
  excluded from Research Lab source snapshots. They may guide an experiment but
  cannot masquerade as an editable source change or perturb source identity.

## Progress log

- 2026-07-23 — Audited Human Observation verification, CLI diagnosis,
  Research Lab V2 isolation/transactions, Researcher stdin, Session identity,
  and Studio Lab/observation projections. Confirmed that Research Sessions do
  not currently retain human-input provenance.
- 2026-07-24 — Added the strict, content-addressed Brief schema, creation and
  inspection commands, `research run --brief`, and Session/Experiment
  provenance. An exact stdin transport test proved request version 3 and the
  fixed authority boundary; stale, duplicated, and tampered inputs are rejected.
- 2026-07-24 — Studio snapshot `studio-dda66f6d832aba81` exposes the explicit
  Observation × Lab selector. Browser validation showed 36 Hardware Captures,
  zero fabricated observations/Briefs, a safely disabled Brief action, and
  exact selection of `capture-0823130818fab9d0` event 6.
- 2026-07-24 — Full validation passed: 62 TypeScript tests with 562
  expectations, 40 Python/MuJoCo tests, project validation with 9 Assemblies,
  23 Controllers, 13 Benchmarks, 7 Capture Plans, 5 Research Labs, and 9 Runtime
  models, plus compilation of `command-conditioned-history-3dof`.
- 2026-07-24 — Rebuilt deployment evidence as Robot Bundle
  `hardware-4905316d1d799406`, Policy Bundle `hardware-b0bf1545307c8d5f`,
  protocol verification `verification-f40efa17d2d39fb2`, shadow verification
  `verification-a017521dacaacbdf`, and five new formal Captures. The host-loss
  transcript proves a latched autonomous stop after 101.245500 ms on a 100 ms
  command lease, with immutable neighboring events 4–8.
