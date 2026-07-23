# Device Telemetry Replay

Status: completed

## Outcome

A human and a Coding Agent can inspect the same integrity-checked Hardware
Capture episode as synchronized device telemetry and a 3D projection through
the exact frozen Bundle digital twin, without representing that projection as
camera footage or independent physical truth.

## Context

Hardware Capture already requires device-reported `qpos`, `qvel`, Observation,
applied Action, freshness, and health on every state message. Completed episodes
freeze those rows and hashes. CLI can inspect transcript protocol events, but
Studio currently says no renderable Capture state exists and only lets a human
bind an observation to one attention event. This leaves valuable HIL/real
kinematic evidence invisible even though the authoritative bytes are present.

## Scope

- Add a strict Capture-episode-frame evidence selector and human observation
  source.
- Render completed Capture episode `qpos` through the exact model frozen in the
  Capture's Hardware Bundle.
- Add a `studio --capture ... --episode ...` entry point and a matching
  `evidence inspect --capture ... --episode ... --time ...` headless entry point.
- Project device health, proposed/commanded/applied Action, mode, environment,
  device identity, source hashes, and authority boundary into Studio.
- Keep Simulation Run and Research Review behavior unchanged.

Out of scope:

- claiming that digital-twin geometry is measured camera or motion-capture
  evidence;
- inferring contact forces, terrain, occlusion, or unreported body state;
- accepting an incomplete/aborted episode without completed episode bytes;
- replaying transcript state messages when no governed episode artifact exists;
- changing Capture authorization, actuation, safety, Calibration, or Judge
  authority;
- comparing hardware and simulation until their timing and coordinate contracts
  have an explicit alignment artifact.

## Acceptance

- [x] Runtime replay identity distinguishes Simulation Runs from Hardware
  Capture episodes and verifies frozen model/episode hashes.
- [x] CLI independently verifies Capture and Bundle integrity before rendering.
- [x] `evidence inspect --capture ... --episode ... --time ...` returns the
  exact row at or before time with neighboring rows and artifact hashes.
- [x] Human Observations can bind to that same frame and re-verify it on record.
- [x] Studio opens a Capture episode without silently selecting an unrelated
  Simulation Run and labels the digital-twin projection boundary.
- [x] Studio exposes health and Action differences relevant to shadow/actuate
  commissioning and copies an exact Agent selector.
- [x] Core, CLI, Studio, Runtime, browser, full repository, docs, commit, and
  push validation pass while preserving the user-owned untracked Run.

## Work

1. Define Capture frame evidence and replay identities.
2. Generalize the renderer without changing existing Simulation replay
   addresses.
3. Add verified CLI rendering and Studio snapshot inputs.
4. Build the device-telemetry HCI and observation handoff.
5. Validate against current dry-run Capture evidence, document, and publish.

## Findings and decisions

- 2026-07-24 — Governed episode NDJSON already contains complete `qpos/qvel`,
  device health, proposed/commanded/applied Action, step, and time. No pose
  synthesis is required.
- 2026-07-24 — The 3D image is a projection of device-reported kinematics
  through the Bundle-frozen digital twin. It is not visual ground truth and
  cannot increase `hardwareVerified`, Calibration eligibility, or actuation
  authority.
- 2026-07-24 — Only completed episodes with verified hashes are renderable.
  Safety-aborted Captures remain inspectable through transcript events unless
  they also published a completed episode.

## Progress log

- 2026-07-24 — Audited Capture Runtime, immutable artifacts, Evidence CLI, and
  Studio. Confirmed the missing capability is projection and selection, not
  telemetry collection.
- 2026-07-24 — Added the v2
  `mujica-hardware-capture-replay` Runtime identity while preserving legacy
  Simulation replay addresses, plus strict Capture-frame evidence and Human
  Observation sources.
- 2026-07-24 — Replayed `capture-5c09b673d06e0385` episode
  `learned-policy-shadow` as 11 synchronized 640×480 frames in
  `studio-1c3656bf0e3f7d86`. Browser stepping resolved frame 2 to device time
  `0.020 s`, displayed proposed peak `8.000` beside zero commanded/applied
  Action, loaded the exact PNG, and reported no console errors.
- 2026-07-24 — Published current Bundles `hardware-4b117b3574fdc8fa`
  (actuate-capable dry-run) and `hardware-6d0dedb5e3d7f6aa` (Policy Revision,
  Shadow maximum), with `PROTOCOL-VERIFIED` record
  `verification-a8ce1f27f7ec9096` and `SHADOW-VERIFIED` record
  `verification-7a4db11e96b03c94`. These remain dry-run, not physical evidence.
- 2026-07-24 — Final validation passed 67 TypeScript tests / 601 assertions,
  40 Python Runtime tests, TypeScript type checking, project validation, and
  browser replay/selector checks. The user-owned untracked
  `run-7638fa709b5f1a78` remained untouched.
