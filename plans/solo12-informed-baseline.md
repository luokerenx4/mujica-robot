# Solo12-informed quadruped baseline

Status: completed
Updated: 2026-07-28

## Outcome

Mujica contains a traceable, locally rendered, Solo12-informed 12-DoF
quadruped candidate and can use its existing workbench to compile, statically
screen, dynamically probe, inspect, and iterate that design. The exercise also
produces an explicit Harness gap ledger and fixes the gaps that would otherwise
make this real development cycle misleading or unnecessarily manual.

## Context

The Prior Art Study selected ODRI Solo12 as the physical architecture reference
and kept the current quadruped as a Harness demo fixture. The existing
workbench has extensive behavior evidence but has never onboarded an adapted
robot with source-level dimensions, mass properties, hardware actuation limits,
and unresolved design assumptions.

## Scope

In scope:

- a clean-room primitive-geometry MJCF based on traceable upstream engineering
  facts, without copying meshes, CAD, images, code, or model files;
- source, revision, license, parameter, and hypothesis provenance preserved
  through compilation and Runtime inputs;
- one static comparison against the old demo and bounded deterministic dynamic
  probes beginning with passive settling and standing;
- locally generated previews and Studio evidence for human review;
- a checked-in requirement/gap ledger derived from using the workbench on the
  candidate;
- implementation of blocking or high-leverage Harness fixes exposed by this
  cycle.

Out of scope:

- claiming an exact Solo12 digital twin;
- importing upstream binary assets before path-level attribution approval;
- carrying old capability acceptance onto the new plant;
- substantial RL before standing, contact, torque, collision, and Controller
  compatibility are established.

## Development emphasis

- Mode: `design-heavy`.
- Evidence: Stage 0 selected a new architecture, while no locked capability
  evidence exists for its compiled plant.
- Budget bias: source-grounded embodiment, static screening, passive dynamics,
  simple standing control, and workbench usability.
- Exit condition: the candidate has traceable compiled evidence, passes the
  declared static screen, and either produces a bounded stable-standing witness
  or an exact plant/Controller blocker that determines the next design change.
- Switch-back condition: do not enter behavior-heavy work until a readable
  Controller demonstrates the physical mechanism under the documented 2.5 Nm
  action envelope.

## Acceptance

- The model compiles to 12 actuators and an approximately 2.5 kg source-grounded
  plant without upstream binary assets.
- Compiled and frozen Runtime inputs preserve design sources, revisions,
  licenses, derived assumptions, and open hypotheses.
- Local preview and static Design Study compare the demo fixture and modern
  candidate under identical authored expectations.
- Passive initial-state stepping and one readable standing Controller are
  exercised in MuJoCo; failures remain inspectable evidence.
- Existing capability status is not presented as proof for the new Assembly.
- The gap ledger distinguishes missing product requirements, missing evidence,
  usability problems, and defects, and records resolution or a bounded next
  action.
- Relevant TypeScript and Python/MuJoCo tests pass.

## Work

1. Add compiled design provenance and the clean-room Solo12-informed source.
2. Render, inspect, and statically compare the candidate.
3. Establish passive and readable standing probes under the physical action
   envelope.
4. Audit how Studio and project requirements represent an unqualified new
   Assembly.
5. Implement blocking workbench improvements and record remaining requirements.
6. Verify, commit, and push.

## Findings and decisions

- The first compiled plant is 2.501304 kg with 12 actuators and a source-backed
  ±2.5 Nm torque envelope. Static analysis found authored four-foot support and
  collision-free contact opportunities from all four resting orientations.
- A 500 Hz/RK4 standing attempt failed too quickly to distinguish control from
  plant setup. Moving the lightweight plant to a recorded 1 kHz implicit-fast
  hypothesis removed the numerical explosion but exposed four 49 mm
  torso/upper-leg assembly contacts at the initial pose.
- Those contacts were legal hip-package overlap represented incorrectly as
  collision surfaces. Explicit MJCF assembly exclusions—not higher gain or
  Training—made the source-gain PD Controller stand for 2.0 seconds with zero
  disallowed contacts and 0.623 Nm peak actuation.
- Fixed 2.2 m design cameras, project-default Controller next actions, and
  project-global accepted capability labels were all misleading on a new plant.
  The workbench now auto-frames robot bounds, supports declared Controller smoke
  tests, and requires Assembly-qualified accepted-capability evidence.
- Cross-plant Task applicability and named dynamic contact-pair summaries remain
  bounded requirements in `examples/quadruped/HARNESS_REQUIREMENTS.md`.

## Progress log

- 2026-07-28: Began from the completed project-inception study; no Controller
  or Training evidence from the demo fixture is inherited.
- 2026-07-28: `run-41c9db67beefc4be` completed the final stable-standing probe:
  2,000/2,000 steps, no fall, zero disallowed collision steps, 0.623 Nm peak
  actuator, and 0.000286 rad maximum body tilt.
