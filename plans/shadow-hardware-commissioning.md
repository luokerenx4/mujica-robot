# Shadow hardware commissioning

- Status: `completed`
- Updated: `2026-07-23`
- Related design: [Hardware capture protocol](../docs/design/hardware-capture-protocol.md), [Hardware verification boundary](../docs/design/hardware-verification-boundary.md)

## Outcome

Mujica can connect a frozen robot Controller to a new driver in observe-only
shadow mode, prove what the device actually applied, fail closed on stale state,
and audit every stop acknowledgement before any ordinary Action is authorized.

## Context

Capture already constrains Actions, checks robot state, and emits emergency
stops. First-time commissioning still jumps directly from handshake to
actuation, treats sent Actions as if they were applied, accepts state without
freshness evidence, and does not make stop acknowledgement part of the final
verification gate. Those gaps are unsafe and make plant diagnosis ambiguous.

## Scope

### In scope

- Explicit `shadow` and `actuate` Capture Plan modes.
- Driver capabilities for shadow proposals, applied Action telemetry, state age,
  and typed stop acknowledgements.
- Fail-closed state-age and stop-acknowledgement gates.
- Immutable proposed/commanded/applied Action evidence.
- MuJoCo protocol proofs for successful shadow observation and stale-state abort.

### Out of scope

- Treating dry-run proof as HIL or physical-hardware verification.
- Live Policy learning or parameter updates during a device session.
- Replacing device firmware limits, a physical E-stop, or an operator.
- Network/ROS transports or autonomous authorization of real actuation.

## Acceptance

- [x] A shadow Plan never sends an ordinary `action` message and is never calibration-eligible.
- [x] Every required state reports finite `stateAgeMs` and contract-sized `appliedAction`.
- [x] State older than the Target limit aborts before Controller Action dispatch.
- [x] Safe-stop and emergency-stop responses must acknowledge the exact episode and stop kind.
- [x] Hardware verification rejects missing/stale state-age evidence and unacknowledged emergency stops.
- [x] Fresh and stale MuJoCo protocol sessions publish immutable, inspectable evidence.
- [x] Historical captures remain integrity-verifiable.
- [x] Full tests, refreshed locks/protocol evidence, docs, commit, and remote push pass.

## Work

- [x] Audit Capture, driver, verification, and calibration authority boundaries.
- [x] Implement explicit mode, telemetry, freshness, and acknowledgement schemas.
- [x] Add the commissioning Plan and normal/failure-path integration coverage.
- [x] Refresh Hardware Bundle, protocol verification, and Benchmark locks.
- [x] Complete docs, tests, commit, and push.

## Findings and decisions

- 2026-07-23 — Shadow mode transmits a `proposedAction` for comparison but never
  an ordinary `action`. Only the driver-reported `appliedAction` is recorded as
  commanded motion.
- 2026-07-23 — State age is device-authored telemetry and a hard pre-dispatch
  gate. Host round-trip latency cannot substitute for sensor/estimator freshness.
- 2026-07-23 — Stop messages are requests, not proof. A session is failed unless
  the driver acknowledges the exact episode and stop kind.
- 2026-07-23 — Historical artifacts keep their original identity. New
  commissioning fields enter capture identity only when the manifest declares a
  mode.
- 2026-07-23 — Millisecond floats were not cross-language content-addressable:
  Python serialized `0.0` while JavaScript serialized the parsed value as `0`.
  Capture identity therefore uses integer microseconds while reports retain
  millisecond measurements.

## Progress log

- Hardware Bundle `hardware-e82b7e4208600749` advertises applied-Action,
  shadow-Action, state-age, and stop-acknowledgement protocol capabilities.
- Shadow Capture `capture-808bca43270f08ba` completed 10 steps with 11 fresh
  states, 10 `shadow-action` proposals, zero ordinary Actions, and no
  calibration authority.
- Stale-state Capture `capture-3c588a462b0c2e3e` rejected the initial 50 ms
  state against a 20 ms Target limit before proposal dispatch and preserved one
  acknowledged emergency stop.
- Verification `verification-06f873ff96b07ce0` is `PROTOCOL-VERIFIED` and
  explicitly `hardwareVerified=false`; stale/unacknowledged variants fail.
- All 13 Benchmark locks were refreshed. TypeScript/Core/CLI/Studio has 53
  passing tests and Python Runtime has 36 passing tests.
