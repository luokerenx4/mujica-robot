# Digital Twin Residual Audit

## Purpose

Device Telemetry Replay answers “what state did the device report?” Digital Twin Residual Audit answers the next development question: “if the exact frozen MuJoCo model starts from that state and receives the Action the device actually applied, where does its next state disagree with the device?”

The result is an immutable diagnostic Artifact shared by the headless CLI and Studio. It is deliberately narrower than Calibration: an Audit measures model disagreement, while only the governed Calibration path may fit parameters and promote a Domain Profile.

## One-step semantics

For each consecutive pair of rows `t` and `t+1` in one completed Hardware Capture episode, the Runtime:

1. loads `model.xml` from the Hardware Bundle named by the Capture's `bundleHash`;
2. resets MuJoCo `qpos` and `qvel` to the device-reported values at row `t`;
3. applies row `t`'s device-reported `appliedAction`;
4. advances exactly one frozen control interval;
5. compares predicted `qpos` and `qvel` with device row `t+1`.

Capture records `appliedAction` on row `t` after the Driver response for that control exchange. `commandedAction` is therefore not a substitute: it may differ because of Shadow mode, device clamps, deadline rejection, or another Driver intervention.

Each transition resets from device state. Mujica does not feed a previous prediction into the next transition. This prevents accumulated rollout drift from obscuring local dynamics error. A cumulative open-loop audit would be a separate Artifact with different interpretation.

The control interval must divide the frozen MuJoCo timestep exactly. Device steps must be zero-based and contiguous, and device times must equal `step / controlHz`. The Runtime rejects any non-finite or dimensionally inconsistent `qpos`, `qvel`, or `appliedAction`.

## Artifact contract

`mujica twin audit <project> --capture ID --episode ID` writes:

```text
twin-audits/twin-audit-<hash>/
  manifest.json
  request.json
  transitions.ndjson
  prediction.ndjson
  summary.json
  report.md
```

The content identity includes the auditor implementation, Runtime and Harness source, MuJoCo version, Capture and episode hashes, Bundle hash, Assembly and model hashes, trajectory hash, control frequency, and physics-step count. The manifest hashes every output file. `mujica twin inspect` re-verifies those bytes before returning a summary or exact `--transition N`.

`transitions.ndjson` records:

- from/to device step and time;
- device `appliedAction`;
- measured and predicted next `qpos`/`qvel`;
- base position vector/norm;
- quaternion-sign-invariant base orientation angle;
- base linear/angular velocity residuals;
- every joint position and velocity residual;
- device health at the measured next state when available.

`summary.json` reports component RMSE, maximum vector magnitude and worst transition for each residual family, plus per-joint position and velocity RMSE. Quaternion orientation uses the absolute normalized dot product, so `q` and `-q` represent the same attitude.

`prediction.ndjson` is a visual projection: frame zero is the common measured initial state; each later frame is the corresponding one-step prediction. It must not be interpreted as a cumulative simulated trajectory.

## Studio and human–Agent handoff

`mujica studio <project> --twin-audit ID` independently verifies the Audit, Capture, episode, Bundle, model, both trajectories, and both rendered replay caches. Studio places device-reported kinematics on the left and frozen-twin prediction on the right under one device-time clock.

At each predicted frame Studio shows the exact transition residual. “Copy exact residual transition for Agent” emits `mujica twin inspect ... --transition N` with the same Audit/Capture/Bundle hashes. A human observation at that frame uses `digital-twin-audit-transition`; `observation record` re-verifies the Audit and stores the complete transition context before accepting the hypothesis.

The human statement remains `authority=human`, `claimKind=hypothesis`. The numerical Audit remains `derived-model-fit-evidence`.

## Authority boundary

A Digital Twin Audit:

- may diagnose a likely mismatch and motivate a Calibration or source experiment;
- may use completed Actuate or Shadow telemetry;
- does not require `calibrationEligible=true`;
- does not change Hardware Verification;
- does not grant or widen actuation;
- does not certify contact, camera, or motion-capture truth;
- does not fit or promote physical parameters;
- does not alter the Capture, Bundle, or Controller.

The protocol simulator's hidden Scenario is intentionally not applied to the frozen twin. The Bundle model is the deployed model under audit; injecting hidden device parameters would erase the discrepancy the Artifact is supposed to measure.
