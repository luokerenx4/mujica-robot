# Human-reviewed Research Outcomes

Status: completed

## Outcome

Every judged Research Lab experiment leaves a reproducible visual review pair
that a human can open in Studio after the candidate source has been kept or
reverted. CLI and Studio preserve the complete Observation → Brief → Session →
Experiment → Judge → MuJoCo Run lineage without giving visual intuition
promotion authority.

## Context

Research Briefs now carry human hypotheses into isolated Agent/ML experiments.
Completed experiments retain metrics, source patches, and Judge verdicts, but a
reverted candidate's executable source disappears with its temporary workspace.
Humans therefore cannot visually compare the accepted state with the exact
candidate that produced a verdict, which breaks the feedback half of the
human–AI loop.

## Scope

- Select one deterministic primary-Benchmark case that best explains each
  completed KEEP or REVERT decision.
- Persist immutable accepted-state and candidate Simulation Runs while the
  isolated candidate is still executable.
- Publish a strictly verified Research Review record binding those Runs to the
  Brief, Session, Experiment, Benchmark lock, proposal, and locked Judge result.
- Add headless inspection and an exact Studio review shortcut.
- Project the full lineage and review action into read-only Studio.

Out of scope:

- letting visual review change a stored verdict or mutate source;
- rendering every Benchmark and regression case eagerly;
- claiming that one review case proves the full Judge decision;
- fabricating a human Observation when none has been recorded;
- changing reward weights, Benchmark locks, or Lab source closures;
- rewriting historical Research Sessions that predate Research Reviews.

## Acceptance

- [x] Review-case selection is deterministic and prioritizes the first
  gate-regression case before the largest weighted score delta.
- [x] Completed KEEP/REVERT experiments preserve two integrity-checked immutable
  Runs and a strict Review record before the candidate workspace is discarded.
- [x] Review failure is explicit but cannot change the locked Judge verdict.
- [x] `research review inspect` verifies full lineage and Run bytes and returns
  an exact Studio command.
- [x] `studio --research-lab ... --session ... --experiment ...` opens the
  accepted/candidate Run pair with Research Review context.
- [x] Studio exposes Brief, observations, proposal, verdict, gate reasons,
  selected case, and an exact visual-review handoff.
- [x] Core, CLI, Studio, browser, MuJoCo/Python, full repository, docs, commit,
  and push validation pass while preserving the user-owned untracked Run.

## Work

1. Define strict Research Review identity and deterministic case selection.
2. Persist review Runs and bind them to completed experiment manifests.
3. Add Review inspection and Studio shortcut.
4. Render the lineage and handoff in Studio.
5. Validate with real MuJoCo Runs and browser interaction, then document and
   publish.

## Findings and decisions

- 2026-07-24 — A Research Review is a derived human-review surface, not a second
  Judge. The full locked evaluation remains authoritative.
- 2026-07-24 — Review Runs must be persisted before the isolated workspace is
  removed so a REVERT remains visually reproducible.
- 2026-07-24 — One deterministic primary case is intentionally a witness, not a
  summary of every primary and regression gate.
- 2026-07-24 — Review capture runs after the locked decision and catches failure
  locally. A failed visual derivation therefore cannot convert KEEP to REVERT or
  REVERT to KEEP.
- 2026-07-24 — Harness identity changes require fresh Benchmark locks, Hardware
  Bundles, Verification records, and representative Captures. Current dry-run
  evidence remains explicitly non-physical.

## Progress log

- 2026-07-24 — Audited Brief/Session/Experiment/Studio data flow. Confirmed
  Experiment evaluations contain result hashes but `evaluate-case` does not
  persist trajectories, while reverted candidate source is removed with the
  workspace.
- 2026-07-24 — Added strict `mujica-research-review` schema, deterministic
  gate-first witness selection, accepted/candidate Run capture, full lineage
  verification, CLI inspection, and the exact three-selector Studio handoff.
- 2026-07-24 — Ran real controller Lab Session
  `session-c773bff5c54a2cd7`, Experiment `001-0f8bcb31c045`. The Agent's
  lateral-lean change improved aggregate score `68.1943 → 68.8866` but regressed
  the passing `yaw-redirection` gate, so the locked Judge returned REVERT and
  source remained unchanged.
- 2026-07-24 — Published Review
  `f901aff3ebc04c9dddeade0a8e554261862153c0dcc768fca52e249c488a1e7a`
  with accepted Run `run-6f9c6481f208e927` and exact candidate Run
  `run-b05629b197f18ee9`. Both replays contain 325 MuJoCo frames.
- 2026-07-24 — Browser-verified Studio snapshot `studio-b1e915f75f353cea`,
  including synchronized event seeking at 4.500 s and the complete
  hypothesis-only Review handoff.
- 2026-07-24 — Refreshed all 13 Benchmark locks, Robot/Policy Hardware Bundles,
  protocol/shadow Verifications, and five representative dry-run Captures.
  Full validation passed 66 TypeScript tests with 583 assertions and 40
  Python/MuJoCo tests.
