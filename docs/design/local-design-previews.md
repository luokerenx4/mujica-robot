# Local Design Previews

## Decision

Robot embodiment is a first-class development input. A human and a Coding
Agent must be able to inspect the compiled robot before policy optimization,
without turning screenshots into repository source or design-acceptance
evidence.

`mujica design render <project> --assembly ID` compiles one Assembly and asks
the MuJoCo Runtime to produce a content-addressed Design Preview under:

```text
<project>/.mujica/design-previews/design-preview-<hash>/
```

The preview contains deterministic PNG projections of:

- the authored home keyframe from isometric, front, side, and top cameras;
- left-side, right-side, prone, and supine resting orientations when the plant
  has a free root joint;
- a manifest with compiled Assembly/model identity, renderer identity and
  settings, per-image hashes, joints, limits, actuators, control ranges, body
  and geometry counts, home bounds, mass, and centre of mass.

## Source and Git boundary

MJCF, Assembly/Component definitions, renderer source, and tests are checked
in. Generated PNGs, preview manifests, and future derived videos are local
cache products. The repository ignores `**/.mujica/design-previews/`; cloning
the repository and running the command reconstructs them from the checked-in
model source.

This avoids storing rebuildable binary assets in GitHub while keeping the
generation contract executable. The preview identity covers the exact compiled
model, Assembly hash, Runtime source, MuJoCo version, camera settings, and
renderer version. Repeated generation reuses only a complete,
integrity-checked cache.

## Authority boundary

A Design Preview is a derived visual projection:

- it does not edit MJCF or Assembly source;
- it does not pass the Development Charter design envelope;
- it does not prove collision clearance, stability, reachability, actuator
  adequacy, recovery, or real-world appearance;
- it does not authorize Training, promotion, deployment, or hardware action.

Visual inspection may produce a human or Agent hypothesis. Design acceptance
still requires executable constraints, morphology studies, capability tests,
and a Development Review.

## Product direction

The first project surface should present embodiment before optimization.
Design Preview is the headless/local artifact foundation for a later Studio
Design Workbench: candidate galleries, static A/B morphology views, joint
workspace sweeps, contact and centre-of-mass overlays, and Design Readiness
gates. Those features must consume the same generated artifact rather than
introducing a browser-owned robot editor.
