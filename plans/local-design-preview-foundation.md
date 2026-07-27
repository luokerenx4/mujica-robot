# Local design preview foundation

Status: completed

## Outcome

After cloning a Mujica project, a human or Coding Agent can generate and inspect
the compiled robot's standard physical views and machine-readable inventory
locally, without checking generated image assets into Git.

## Context

The quadruped loop entered RL optimization before the embodiment had received a
first-class visual design review. Studio can replay completed Runs, but a Run is
too late and conflates robot shape with Controller behaviour. The source model
already contains enough geometry to produce a deterministic pre-training
preview.

## Scope

In scope:

- one compiled-Assembly Design Preview command;
- deterministic home and resting-pose PNGs;
- machine-readable model facts and image integrity;
- content-addressed local caching;
- explicit Git ignore and authority boundary;
- one real quadruped generation and visual check.

Out of scope:

- browser-based source editing;
- claiming that a screenshot passes Design Readiness;
- joint-workspace, collision, torque, or stability analysis;
- blocking formal Training until the full Design Readiness contract exists;
- checking generated PNGs or videos into Git.

## Acceptance

- `mujica design render` succeeds from checked-in project/model source.
- The same source/settings reuse one complete content-addressed preview.
- A changed or missing image fails cache integrity verification.
- The preview includes standard home/resting views and structural facts.
- `git check-ignore` proves generated images are ignored.
- CLI discovery, Runtime tests, project validation, Assembly compilation, and
  the full test suite pass.
- A generated quadruped preview is inspected before this Plan is completed.

## Work

- [x] Define the source/derived-asset and authority boundaries.
- [x] Implement Runtime rendering and CLI orchestration.
- [x] Add ignore rules, tests, and public documentation.
- [x] Render and inspect the current articulated quadruped.
- [x] Run the complete verification loop and publish the change.

## Findings and decisions

- Design images are rebuildable projections, not immutable robot evidence.
- Preview generation starts from the compiled MJCF so it sees the same
  Component composition the Runtime will execute.
- Standard resting orientations are visual design probes; they do not replace a
  simulated settling or recovery test.
- The browser may display previews, but it does not own or mutate robot source.
- The current 640x480 standard views are bounded by the compiled model's
  offscreen framebuffer and avoid mutating MJCF solely for presentation.
- The quadruped preview makes the present long rectangular torso, split waist,
  and limited recovery contact geometry obvious before another policy search.

## Progress log

- 2026-07-27: Promoted pre-training embodiment inspection ahead of RL tuning and
  fixed `.mujica/design-previews/` as the ignored local artifact root.
- 2026-07-27: Generated and visually inspected
  `design-preview-85affb9e44979b38` with eight views, 15 joints, 14 actuators,
  and 6.16 kg compiled model mass. Front/left camera conventions were corrected
  from visual evidence.
- 2026-07-27: `git check-ignore` proved preview PNGs remain local. Project
  validation, Assembly compilation, 90 TypeScript tests, and 76 Python tests
  passed after evidence locks and dry-run bundles were refreshed fail-closed.
