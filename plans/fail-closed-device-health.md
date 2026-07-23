# Fail-closed device health

- Status: `completed`
- Updated: `2026-07-23`
- Related design: [Hardware capture protocol](../docs/design/hardware-capture-protocol.md), [Hardware verification boundary](../docs/design/hardware-verification-boundary.md)

## Outcome

Mujica treats Driver health as a typed, negotiated safety input. A learned
Policy or program Controller cannot emit a control message when motor
temperature/current, bus voltage, Driver faults, physical E-stop state, or the
Driver watchdog is unsafe.

## Context

The Hardware Capture host already checks robot kinematics, state freshness,
Action authority, and dual-clock deadlines. A real drive can still be faulted
while those values look valid. If health exists only in a vendor console, a
Coding Agent can neither test the interlock nor preserve evidence explaining why
an otherwise valid Policy was stopped.

## Scope

### In scope

- Target limits for motor temperature/current and bus voltage.
- Negotiated `device-health` telemetry on every required state.
- Strict vector shape, numeric, fault-code, E-stop, and watchdog validation.
- A pre-Controller, pre-dispatch health gate.
- Health extrema and event counts in immutable Capture identity and reports.
- Normal and over-temperature MuJoCo Driver evidence.
- Separate Hardware Evidence gates for health samples and an exercised trip.

### Out of scope

- Replacing vendor firmware protections or a physical E-stop.
- Estimating winding temperature when the device does not measure it.
- Standardizing vendor fault-code meanings beyond safe machine-readable syntax.
- Claiming simulated telemetry is HIL or physical-device evidence.

## Acceptance

- [x] Required health telemetry has one temperature/current value per Action channel.
- [x] Missing, malformed, faulted, or out-of-bounds health fails closed.
- [x] Health is checked before Controller/Policy evaluation and control dispatch.
- [x] Capture identity and reports preserve health extrema and event counts.
- [x] Verification rejects required health Evidence without samples or a trip.
- [x] Normal and over-temperature immutable proofs are frozen.
- [x] Historical Captures remain integrity-verifiable.
- [x] Full tests, locks, docs, commit, and remote push pass.

## Findings and decisions

- 2026-07-23 — Health is Driver-authored because the Driver is the boundary that
  can read vendor motor/drive telemetry. The host validates and gates it but does
  not invent missing measurements.
- 2026-07-23 — Any active fault code is a hard stop. V1 does not embed
  vendor-specific severity policy that could accidentally downgrade a critical
  fault.
- 2026-07-23 — Current is compared by absolute magnitude; signed torque/current
  direction is not a safety exemption.
- 2026-07-23 — An engaged physical E-stop is reported as a stopped condition,
  not permission to continue shadow inference. The host still requests and
  verifies its protocol emergency-stop acknowledgement.
- 2026-07-23 — Fault codes accept only bounded alphanumeric `._:-` tokens so an
  external Driver cannot inject multiline report or ledger content.

## Evidence

- Robot Bundle `hardware-ef5a0b5f2415b990` and Policy shadow Bundle
  `hardware-276bc4f3e2b72321` require both device health and dual-clock deadline
  capabilities.
- Normal learned-Policy Capture `capture-ef9213d49206264e` records 11 healthy
  samples at `40 C`, `0 A`, and `24 V`, completes ten shadow decisions with two
  preheating passes, and remains correctly non-calibration-authoritative.
- Over-temperature Capture `capture-0603dd3214419b5e` records one `90 C` state
  against the `80 C` Target ceiling. It stops at episode step 0, contains no
  `action` or `shadow-action`, and preserves an exact emergency-stop
  acknowledgement.
- Actuated identification Capture `capture-8b5c29c565eb44c1` completes 153
  healthy state samples across three episodes and remains synthetic-only
  Calibration evidence.
- Robot Verification `verification-abff97fa0afc0a08` is
  `PROTOCOL-VERIFIED`; Policy Verification `verification-add296d27897c94a` is
  `SHADOW-VERIFIED`. Both exercise one health trip, remain
  `hardwareVerified=false`, and are not actuation-qualified.
- All 13 Benchmark locks use Harness hash
  `874a080ab0cb7405910a864ca14084b84967737a153ff4c90b75d4fafa704eec`
  and Runtime hash
  `3105e7ba45669f80e83d87b9e383adf9be354ff5f565e0855adb59352077d172`.
  TypeScript/Core/CLI/Studio has 56 passing tests and Python Runtime has 38.
