# System identification captures

## Authority

Calibration estimates simulator parameters; it does not certify a robot. The
raw time series, serialized-device identity, model identity, optimizer bounds,
Runtime identity, fitted result, and validation error are all separate evidence.

Source provenance is monotonic:

- Simulation Runs can produce only `synthetic` Calibration Runs and Profiles.
- `hil` requires an external capture with a non-empty device serial.
- `real` requires an external capture with a non-empty device serial.

Changing a label never upgrades evidence. Capture bytes and the resulting
Calibration Run manifest participate in downstream Profile identity.

## Capture contract

An external capture is NDJSON. Every row represents the state at the beginning
of one control interval:

```json
{
  "episode": "lifted-chirp-01",
  "step": 0,
  "time": 0.0,
  "qpos": [],
  "qvel": [],
  "commandedAction": []
}
```

Rows are ordered by episode and step. Each episode starts at step zero, uses the
Calibration definition's fixed control rate, has at least two rows, and keeps
state and Action dimensions equal to the compiled Assembly. The Action on row
`n` is applied over the interval ending at row `n + 1`. A Run source exposes
the same contract from its frozen initial state and trajectory.

External collection should record the command accepted by the device boundary,
not a desired high-level motion command. Applied torque may be added later when
hardware exposes it, but it is not assumed observable.

## Estimator

The first estimator intentionally has a small global parameter surface:

- body mass and inertia scale;
- joint damping scale;
- actuator strength scale;
- contact friction scale;
- integer actuator delay steps.

For each observed interval, the Runtime resets MuJoCo to the measured `qpos` and
`qvel`, selects the delayed command from that episode's command history, advances
one control interval, and compares predicted state with the next measured row.
The objective combines unitful joint position/velocity and base
position/orientation/velocity errors with fixed reference scales.

A deterministic bounded coordinate search enumerates delay and refines only the
declared continuous ranges. No fitted value may escape its definition. Entire
episodes are assigned to fit or validation; validation never influences the
selected parameters.

## Artifact and promotion

`mujica calibrate` writes an immutable Calibration Run containing:

- source hashes and provenance;
- frozen Calibration definition;
- parameter search trace;
- selected parameters;
- fit and validation metrics;
- proposed Domain Profile;
- Runtime/Harness/model identity.

The proposal is not project source until `mujica calibration promote` copies it
to `domain-profiles/`. Promotion requires a complete immutable artifact and a
non-empty validation split whose loss does not exceed the definition's explicit
promotion threshold. It also rechecks the current Runtime, Harness, Assembly,
model, Calibration definition, base Scenario, source hashes, and proposal hash.
The Profile points back to that artifact's manifest.
Training then treats it like any other Domain Profile; fixed locked Benchmarks
remain the only Policy authority.
