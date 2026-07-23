# Visual simulation debugger

- Status: `completed`
- Updated: `2026-07-23`
- Related design: [Visual simulation debugger](../docs/design/visual-simulation-debugger.md), [Read-only Studio](../docs/design/read-only-studio.md)

## Outcome

Mujica Studio shows the actual articulated robot moving through a completed MuJoCo Simulation Run. A human can play, pause, step, slow down, jump to semantic events, compare motion with telemetry, and copy an exact frame context back to a Coding Agent without introducing a second browser-side physics implementation.

## Context

Simulation Runs already retain complete `qpos`, `qvel`, Action, command, contact-force, health, and Event streams. Studio currently projects only the base XY path onto a top-down canvas. This hides gait timing, leg configuration, foot contact, body attitude, and falls—the evidence a human notices fastest when jointly debugging a robot with an Agent.

The local Runtime can render the checked-in quadruped model offscreen at `640 × 480`; a probe against `run-7638fa709b5f1a78` reconstructed the 19-value configuration and produced a real MuJoCo perspective frame from its first recorded state.

## Scope

### In scope

- Render completed Run trajectories from their exact compiled MuJoCo model and recorded `qpos`.
- Publish a content-addressed replay cache without mutating the immutable Run.
- Embed replay frames and manifest in the content-addressed Studio snapshot.
- Add synchronized 3D playback, speed, stepping, scrubbing, Event seeking, health/contact/command telemetry, and copyable frame context.
- Preserve the current top-down trajectory as a complementary spatial diagnostic.
- Demonstrate the feature with the user's existing `run-7638fa709b5f1a78` and serve it at the current local Studio URL.

### Out of scope

- Recomputing physics, Controller actions, metrics, or KEEP/REVERT in the browser.
- Editing robot source or immutable Run evidence from Studio.
- Claiming physical-robot or HIL evidence from rendered MuJoCo frames.
- Remote multi-user streaming. A later live mode may stream the same Runtime state, but deterministic completed-Run replay is the first complete human-debugging boundary.

## Acceptance

- [x] `mujica studio <project> --run <id>` creates or reuses an immutable replay whose identity covers Run result, exact model, Runtime renderer, and render settings.
- [x] Every displayed pose is reconstructed by MuJoCo from the Run's recorded `qpos`; the browser never performs robot dynamics or kinematics.
- [x] Studio displays a perspective robot animation synchronized with the existing trajectory and frame telemetry.
- [x] Play/pause, previous/next frame, speed, scrub, and semantic Event seeking work in the browser.
- [x] The selected frame exposes time, health, body attitude, command, measured motion, contact force, and Action magnitude.
- [x] A human can copy a structured frame context containing Run identity and exact frame index for an Agent.
- [x] Missing or hash-mismatched model/trajectory inputs fail closed rather than displaying an invented replay.
- [x] The user's quadruped Run is visible and moving at `http://127.0.0.1:8765/`.
- [x] Project validation, Assembly compilation, TypeScript tests, Python tests, and browser interaction checks pass.
- [x] Design and CLI/README documentation are updated; changes are committed and pushed.

## Work

- [x] Prove local MuJoCo offscreen rendering against the user's completed Run.
- [x] Implement Runtime replay rendering and content-addressed CLI cache.
- [x] Add Studio replay projection and synchronized debugging controls.
- [x] Generate and visually verify the user's quadruped replay.
- [x] Verify, document, commit, and push.

## Findings and decisions

- 2026-07-23 — MuJoCo remains the only authority for pose reconstruction. Pre-rendered replay frames avoid a second physics or kinematics implementation in the browser.
- 2026-07-23 — Replay is a derived content-addressed cache, not a mutation of a completed Simulation Run.
- 2026-07-23 — Perspective replay and top-down path are complementary: one exposes articulation and attitude, the other exposes displacement and drift.
- 2026-07-23 — New Simulation Runs freeze the exact compiled `model.xml` and its hash. Legacy replay is allowed only while the matching content-addressed Assembly cache remains available.
- 2026-07-23 — Studio snapshots copy and revalidate the complete replay frame set so their offline projection cannot silently depend on an absolute cache path.
- 2026-07-23 — Replay manifests retain per-frame SHA-256 hashes; both Runtime cache reuse and Studio projection reject a missing, added, or byte-modified PNG.

## Progress log

- 2026-07-23 — Audited the current 8765 Studio page: it selects `run-7638fa709b5f1a78`, exposes 250 trajectory rows at 50 Hz, but renders only the base XY path.
- 2026-07-23 — Offscreen probe loaded Assembly `70a4b98624c0aa5b…`, reconstructed `nq = 19`, and rendered a `640 × 480` PNG from recorded `qpos` using MuJoCo 3.10.0.
- 2026-07-23 — Published replay `replay-c2e65d79c67cf2d9` and final project snapshot `studio-0ffd9bfae00cf4d7` for the user's Run. The cache contains 250 exact `qpos` frames with per-frame integrity hashes and is served at `http://127.0.0.1:8765/`.
- 2026-07-23 — Browser checks advanced playback to frame 22, completed all 250 frames, stepped 249 ↔ 250, scrubbed to frame 126 with synchronized telemetry, switched to 2×, sought both semantic Events, and copied frame context. The image loaded at `640 × 480` with no browser warnings or errors.
- 2026-07-23 — `bun run test` passed 40 TypeScript and 28 Python tests. `mujica validate` passed all 9 Assemblies, and the default 3-DOF Assembly compiled as `70a4b98624c0aa5b…` with `nq = 19`, `nu = 12`.
- 2026-07-23 — Re-locked all 11 Benchmarks for the new Runtime/Harness identity. Hardware bundle `hardware-8969748fe40c3b28` retained dry-run semantics and verification `verification-fa835e303c9eca5f` remained `PROTOCOL-VERIFIED`, `hardwareVerified = false`.
