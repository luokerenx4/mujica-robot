# Device telemetry replay

Mujica can project one completed Hardware Capture episode into Studio:

```text
device qpos/qvel ──> exact frozen Hardware Bundle model ──> MuJoCo RGB frames
        │                                                    │
        └──────── immutable episode row + health/Actions ─────┘
```

This is a kinematic digital-twin projection, not a recording of the physical
scene. The pose comes from device-reported `qpos`; geometry comes from the
Capture's content-addressed Bundle. The view does not infer unreported contact,
terrain, occlusion, deformation, camera appearance, or motion-capture truth.
Opening it cannot change `hardwareVerified`, Calibration eligibility, safety
state, or actuation authority.

## Integrity chain

`mujica studio --capture ID --episode ID` fails closed unless all of these
identities agree:

1. the Hardware Capture manifest, transcript, and completed episode bytes pass
   Capture verification;
2. exactly one locally available frozen Hardware Bundle has the Capture's
   `bundleHash`, and every Bundle byte passes verification;
3. Capture, Bundle, compiled Assembly, and `model.xml` hashes agree;
4. Runtime replay identity includes the Capture, Bundle, episode, model,
   trajectory, Runtime source, MuJoCo version, and render settings;
5. Studio re-hashes the Capture episode and every replay PNG before publishing
   its offline snapshot.

Simulation replay keeps its existing v1 content identity. Device replay uses the
separate v2 `mujica-hardware-capture-replay` identity, so the same model and
trajectory bytes cannot be confused with a Simulation Run.

## Shared human/Agent selector

Studio shows device health and all three Action stages:

- `proposedAction`: what the Controller or Policy wanted;
- `commandedAction`: what the governed host was allowed to send;
- `appliedAction`: what the Driver reports was actually applied.

That distinction makes Shadow commissioning legible: a non-zero proposal beside
zero commanded/applied Action is expected behavior, not hidden actuation.

At every displayed frame Studio copies:

```text
mujica evidence inspect <project> \
  --capture <capture-id> --episode <episode-id> --time <seconds>
```

The headless command independently resolves the row at or before that time,
returns two neighboring rows on each side, device health, Actions, and artifact
hashes. A Human Observation may bind the same
`hardware-capture-frame` source. Recording it reconstructs the context instead
of trusting browser state, and the result remains a human hypothesis.

## Deliberate non-feature

Mujica does not yet compare a Hardware Capture episode with a Simulation Run.
That needs a governed alignment artifact defining clocks, coordinate frames,
initial state, and sampling policy. Guessing nearest frames would create a
convincing but scientifically ambiguous comparison.
