# Human–AI debugging workspace

Status: completed

## Outcome

Mujica exposes one evidence context to both collaborators: Studio gives a human
an anomaly-first visual workspace and a structured observation draft at the
current frame, while the CLI gives a Coding Agent the same exact Run/Capture
context and immutable human observations as machine-readable JSON.

## Context

Studio can replay and compare Runs, and its clipboard payload already identifies
the current frame. The human still has to describe a visible problem in prose,
the Agent has no first-class command for retrieving that exact frame, hardware
Capture failures are buried outside Studio, and a visual judgement has no
durable provenance. This prevents the human visual loop and the Agent headless
loop from sharing one vocabulary.

## Scope

- Add a read-only `evidence inspect` command for exact Run time/frame or Hardware
  Capture transcript context.
- Add immutable, separately typed human-observation artifacts that bind their
  source identity, preserve the human/Agent authority boundary, and remain
  listable and inspectable from the CLI.
- Project Capture failures and existing human observations into Studio.
- Add an anomaly-first attention queue and a structured observation composer
  tied to the currently rendered Run comparison frame.
- Let the offline page copy or download an importable draft; recording remains
  an explicit CLI artifact creation so Studio does not silently mutate evidence.

Out of scope:

- treating a human visual judgement as measured evidence or a Judge verdict;
- editing Robot/Controller/Policy source from Studio;
- a database, account system, collaborative server, or hidden browser state;
- inventing Capture 3D replay where the frozen device session lacks qpos frames;
- changing immutable Run or Capture artifacts.

## Acceptance

- [x] `evidence inspect --run ... --time ...` returns the same current frame,
  nearby Events, source hashes, and comparison deltas used by Studio.
- [x] `evidence inspect --capture ... --event ...` verifies Capture integrity and
  returns the exact transcript event plus bounded neighboring protocol context.
- [x] Observation recording rejects missing/tampered sources and invalid drafts,
  publishes an immutable artifact, and labels the claim as human observation /
  hypothesis rather than evidence.
- [x] Studio ranks unhealthy Events and aborted/safety-tripped Captures before
  ordinary history, seeks Run attention items, and exposes exact Capture ids.
- [x] The current frame can produce one schema-valid observation draft carrying
  the same evidence context identity that the CLI can independently reconstruct.
- [x] Existing observations appear in Studio without changing their bytes, and
  the snapshot remains deterministic for unchanged project evidence.
- [x] Browser interaction, CLI contract tests, Studio tests, project validation,
  TypeScript/Python tests, docs, commit, and push pass while preserving the
  user-owned untracked Run.

## Work

1. Define the shared context and human-observation artifact contracts.
2. Implement headless inspection and observation lifecycle commands.
3. Add Studio attention, Capture, and observation-composer projections.
4. Exercise the complete human-to-Agent loop in the browser and CLI.
5. Document, validate, commit, and push.

## Findings and decisions

- 2026-07-23 — Studio stays a projection, not an authority. It may create a
  portable draft in browser memory, but only the explicit CLI record command can
  publish a project artifact.
- 2026-07-23 — Human observations are valuable hypotheses with source
  provenance. Their schema must never let `severity` or `confidence` masquerade
  as a measured safety result.
- 2026-07-23 — Run context uses the trajectory row at or before the requested
  simulation time, matching Studio's shared clock instead of selecting a future
  frame.
- 2026-07-23 — Capture context is reconstructed only after full Capture integrity
  verification and contains the selected event plus two transcript neighbors on
  either side.
- 2026-07-23 — The Studio renderer source hash participates in snapshot identity,
  preventing stale HTML from being reused after a UI-only change.

## Progress log

- 2026-07-23 — Audited Studio snapshot generation, synchronized comparison
  clock, clipboard frame context, Run/Capture manifests, CLI envelopes, and the
  existing read-only boundary. Confirmed that no shared context query or durable
  visual-observation type exists.
- 2026-07-23 — Added `evidence inspect` for exact Run time and Capture event
  contexts plus immutable `observation record/list/inspect` artifacts with
  independent source reconstruction and tamper rejection.
- 2026-07-23 — Studio snapshot `studio-1454a10aec3f0a98` projects 31 Hardware
  Captures. Browser verification selected `capture-a63d524c756f38f2` event 6
  from the first attention item and bound that exact event into the human
  observation composer.
- 2026-07-23 — Re-exported Robot Bundle `hardware-e1bc1904822e021f` and
  Policy Bundle `hardware-445d07accc35ef2b`; protocol evidence produced
  `verification-88564bd21dfa5d13` and `verification-68b2a06e9f17e510`.
- 2026-07-23 — Published formal Captures `capture-d3a8793f4302d8e5`
  (normal shadow), `capture-1a683644f8d53dd7` (isolated fault),
  `capture-275c769df56fc29c` (new-session recovery candidate),
  `capture-99ac8dff16206f51` (system identification), and
  `capture-a63d524c756f38f2` (host loss). The Driver autonomously stopped after
  104.674500 ms of host silence with no host emergency stop.
- 2026-07-23 — Project validation passed for 9 Assemblies, 23 Controllers,
  13 Benchmarks, 7 Capture Plans, and 9 MuJoCo Runtime models. Full regression
  passed with 61 TypeScript tests / 533 expectations and 40 Python tests.
