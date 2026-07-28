# TypeScript React Studio foundation

Status: completed
Updated: 2026-07-28

## Outcome

`mujica studio` opens a typed Vite + React workbench whose primary replay
surface can inspect and synchronously play one or two immutable MuJoCo Runs.
The generated artifact remains local, offline, deterministic, read-only, and
content-addressed. Every debugger surface not yet migrated remains reachable
without changing its evidence or authority semantics.

## Context

The current Studio data projection is sound, but its renderer has grown into a
1,200-line TypeScript function containing one HTML/CSS/JavaScript template.
Small interaction changes now require editing source-order-dependent markup and
untyped browser code. This is the measured Harness bottleneck for the
human–Agent debugging surface.

## Scope

- Add one TypeScript/TSX Vite application inside `@mujica/studio`.
- Keep `buildStudioSnapshot` and immutable artifacts as the only data source.
- Move the default A/B MuJoCo replay experience into React.
- Build renderer assets locally and include their source identity in the
  content-addressed Studio Snapshot.
- Preserve the complete existing debugger as a read-only Evidence view while
  its panels migrate incrementally.
- Do not add a server API, mutable frontend database, robot editing, evaluation,
  or promotion authority.

## Development emphasis

- Mode: `balanced`.
- Evidence: this slice changes Harness presentation only; the current
  quadruped remains in morphology/Controller co-design and receives no new
  Training budget.
- Budget bias: preserve evidence identity first, then improve the replay
  interaction with the smallest useful component set.
- Exit condition: the generated React replay passes type, unit, artifact, and
  browser playback checks while the complete prior debugger remains available.
- Switch-back condition: if the React projection cannot reproduce exact Run,
  frame, and simulation-time selectors, stop visual work and repair the
  Snapshot contract before migrating another panel.

## Acceptance

- All new browser source is `.ts` or `.tsx`; no handwritten JavaScript files
  are introduced.
- Vite builds a static React renderer with checked-in shadcn-style component
  source and no CDN or runtime network dependency.
- One-Run and A/B Runs share a typed simulation clock with play, pause, frame
  step, scrub, speed, and keyboard controls.
- Each visible frame names its immutable Run, mapped replay frame, trajectory
  row, health/recovery state, and essential telemetry.
- The renderer source hash changes when UI source or its build contract
  changes, and generated UI assets are local derived files ignored by Git.
- The former complete Studio is available from the same generated artifact as
  a transitional Evidence view.
- Targeted tests, the full TypeScript suite, Python tests, and browser smoke
  checks pass.

## Work

1. Freeze the typed Snapshot-to-UI boundary and renderer source identity.
2. Add the Vite/React/TypeScript build and minimal source-owned UI primitives.
3. Implement the synchronized Run replay workbench.
4. Package the built renderer and complete legacy Evidence view atomically.
5. Verify generation, offline assets, interaction, and existing debugger
   accessibility.

## Findings and decisions

- React is a renderer over immutable Snapshot data, not a new source of truth.
- The migration is vertical rather than a big-bang rewrite: the default replay
  is native React, while `legacy.html` temporarily retains every non-migrated
  evidence panel.
- shadcn is used as source-owned component composition, not as a remote runtime
  dependency or a reason to add unrelated dashboard abstractions.
- Renderer dependencies have a nested lock and install lifecycle. Changing
  React or Vite must change Studio identity without invalidating Benchmark
  locks, Hardware Bundles, or Runtime authorization.

## Progress log

- 2026-07-28: Measured the existing renderer at 1,233 lines and froze the first
  migration slice around the primary Run replay.
- 2026-07-28: Added the Vite/React/TypeScript renderer, source-owned UI
  primitives, synchronized A/B Run replay, source-hashed local bundle cache,
  restrictive external-asset CSP, and the complete legacy Evidence fallback.
- 2026-07-28: Browser smoke testing caught and closed a Vite library-mode
  production-constant failure before release; the repaired renderer loaded both
  300-frame replays and advanced them on the same frame index.
- 2026-07-28: Full regression testing exposed accidental coupling between UI
  dependencies and the Harness authorization lock. Isolating the renderer lock
  restored all Review, Benchmark, Hardware, Capture, and Twin Audit identities;
  96 TypeScript and 78 Python tests then passed.
