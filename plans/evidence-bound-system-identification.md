# Evidence-bound system identification

- Status: `complete`
- Updated: `2026-07-23`
- Related design: [System identification captures](../docs/design/system-identification-captures.md), [Sim-to-real Domain Profiles](../docs/design/sim-to-real-domain-profiles.md), [Hardware verification boundary](../docs/design/hardware-verification-boundary.md)

## Outcome

Mujica can take immutable commanded-Action and measured-state time series from
synthetic, HIL, or real captures; fit a bounded MuJoCo plant deterministically;
report train/validation error; and promote a provenance-bound Domain Profile
without allowing simulated evidence to masquerade as hardware calibration.

## Context

Domain Profiles now make uncertainty executable, but the checked-in quadruped
range is hand-authored and explicitly synthetic. Real robot development needs
the inverse path: excite a serialized device, capture what was commanded and
what moved, identify simulator mismatch, then feed a versioned result back into
Training. The current trajectory stores only applied Action and omits the exact
pre-step state, so delay and one-step dynamics cannot yet be reconstructed from
Run evidence.

## Scope

### In scope

- Record commanded and applied Action plus exact initial state in new Simulation Runs.
- Define file-native Calibration definitions and an external NDJSON capture contract.
- Fit global body mass/inertia, joint damping, actuator strength, friction, and integer actuator delay using deterministic one-step MuJoCo prediction.
- Split calibration and validation by episode/source and preserve both errors.
- Publish immutable Calibration Runs and separately promote their proposed Domain Profile.
- Verify the complete path on independent synthetic plant Runs with hidden parameters.

### Out of scope

- Claiming synthetic recovery is HIL or real calibration.
- Online adaptation or changing Policy weights during evaluation.
- Per-joint high-dimensional identification before the global estimator is proven.
- Force/torque sensor bias, backlash, thermal drift, battery sag, or deformable contact.
- Treating a low trajectory error as hardware safety certification.

## Acceptance

- [x] New Runs preserve exact initial state and distinguish commanded from applied Action.
- [x] Calibration sources are content-hashed, confined, dimension-checked, and carry explicit provenance/device identity.
- [x] HIL and real calibration require serialized-device evidence; synthetic sources cannot produce a hardware provenance label.
- [x] The Runtime fits only declared bounded parameters and is deterministic for identical evidence.
- [x] Train and validation episode errors are reported independently; promotion fails when validation is missing or excessive.
- [x] A promoted Domain Profile binds the immutable Calibration Run manifest as evidence.
- [x] An independent synthetic trace recovers known plant parameters within declared tolerance.
- [x] At least one Training/Policy cycle consumes the promoted calibrated Profile and is judged only on locked held-out Scenarios.
- [x] Validation, full tests, Benchmark locks, protocol-only hardware evidence, docs, commit, and remote push pass.

## Work

- [x] Audit current Run, Hardware, Domain Profile, and original harness constraints.
- [x] Implement capture evidence, schemas, Runtime fitting, CLI, and immutable artifacts.
- [x] Generate three hidden synthetic plant episodes and verify held-out recovery.
- [x] Promote the synthetic Profile, train/evaluate one frozen Policy, and diagnose the result.
- [x] Verify, document, commit, and push.

## Findings and decisions

- 2026-07-23 — System identification is a first-class robot-development operation, not a training reward or Benchmark shortcut.
- 2026-07-23 — The first estimator uses teacher-forced one-control-step prediction. This avoids chaotic long-horizon contact divergence while still testing local plant dynamics and integer command delay.
- 2026-07-23 — Body mass scaling must also scale body inertia. Scaling mass alone creates a physically inconsistent Domain Profile.
- 2026-07-23 — Calibration and validation split by whole capture episode/source. Adjacent time steps from the same rollout are too correlated to count as held-out evidence.
- 2026-07-23 — Profile promotion has an explicit maximum validation loss in addition to immutable identity checks. A completed fit is evidence, not automatic authority.
- 2026-07-23 — Calibrated delay is represented in the Domain Profile, so the first Training uses the neutral base Scenario rather than stacking another fixed delay Scenario on top.

## Progress log

- 2026-07-23 — Simulation Runs `run-36391fc5109e6d38`, `run-ef2286a393b0a997`, and `run-3c89a0ebe1617558` froze forward, lateral, and yaw command traces from an independently configured synthetic plant.
- 2026-07-23 — Calibration Run `calibration-0953f26819aff930` recovered body mass `1.125`, damping `0.9`, actuator strength `1.175`, and delay `2` exactly. Fit loss is `0.0031793`; the untouched yaw source has validation loss `0.0022687`, below the `0.01` promotion threshold.
- 2026-07-23 — Promoted synthetic Profile `quadruped-synthetic-calibrated-v1` binds the Calibration manifest and spans mass `1.035–1.2`, damping `0.828–0.972`, strength `1.081–1.269`, and delay `1–3`.
- 2026-07-23 — Training Run `training-38b822869d9318b9` produced frozen Policy `calibrated-residual-locomotion-3acdd04e0b238dfc` from 4096 PPO steps. The locked held-out audit scored `44.0662`, above the prior learned Policy's `43.2528` but below the program baseline's `44.3864`; no Controller superiority is claimed.
- 2026-07-23 — All 13 Benchmark locks were refreshed for the corrected mass/inertia Runtime. Verification `verification-7057b9c821d7c958` is deliberately `PROTOCOL-VERIFIED`, never hardware-verified. TypeScript `45/45` and Python `33/33` tests pass.
