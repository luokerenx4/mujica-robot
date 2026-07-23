# Safe hardware capture sessions

- Status: `completed`
- Updated: `2026-07-23`
- Related design: [Hardware capture protocol](../docs/design/hardware-capture-protocol.md), [Hardware verification boundary](../docs/design/hardware-verification-boundary.md), [System identification captures](../docs/design/system-identification-captures.md)

## Outcome

Mujica can execute a frozen Hardware Bundle Controller against a driver, enforce
host-side action and state safety gates, preserve the full protocol transcript,
and publish immutable episode captures that can enter system identification
without a hand-written evidence file.

## Context

Hardware export and verification currently freeze deployment inputs and verify
separately supplied evidence, but Mujica does not execute the device protocol.
Calibration accepts external NDJSON, yet cannot prove which Bundle, Controller,
driver, device, or safety envelope produced it. That gap prevents a trustworthy
simulation-to-HIL-to-real development loop.

## Scope

### In scope

- File-native Capture Plans bound to one Hardware Target and frozen Bundle.
- Exact executable-driver hashing and a versioned stdin/stdout JSONL protocol.
- Multi-episode Controller execution with action scaling, slew limiting, dispatch
  deadline accounting, joint-velocity, base-height, and body-tilt gates.
- Best-effort emergency stop on every protocol, Controller, deadline, or state
  violation.
- Independent, expiring operator authorization for HIL and real sessions.
- Immutable transcripts, reports, manifests, and calibration-compatible episode files.
- A MuJoCo protocol simulator proving capture → calibration → Profile → Training.

### Out of scope

- Claiming the protocol simulator is HIL or real hardware.
- Bypassing a robot vendor's independent motor, current, temperature, or E-stop safety.
- Network drivers, ROS 2 transports, fleet orchestration, or unattended real actuation.
- Online Policy updates during a device session.

## Acceptance

- [x] Capture Plans validate against the target Assembly, Action contract, and stricter safety envelope.
- [x] The host hashes the exact executable and fails closed on Bundle, contract, environment, or device handshake mismatch.
- [x] HIL/real sessions require an external, unexpired authorization naming Bundle, Plan, operator, device serial, and episode ceiling.
- [x] Actions remain within the frozen contract and declared slew/scale limits; deadline and state violations emit emergency stop and an ineligible artifact.
- [x] Completed artifacts preserve raw transcript, per-episode initial/final state, commanded Action, timing, safety interventions, and source hashes.
- [x] Calibration accepts only eligible capture episodes whose immutable identity, Assembly, environment, provenance, and device match.
- [x] A three-episode MuJoCo driver session recovers a hidden plant on a held-out episode and promotes only synthetic evidence.
- [x] One frozen RL Policy consumes the capture-calibrated Profile and is judged on a locked Benchmark without online adaptation.
- [x] Full validation/tests, refreshed locks/protocol evidence, docs, commit, and remote push pass.

## Work

- [x] Audit the current Hardware Bundle, verification, Calibration, and Runtime boundaries.
- [x] Implement schemas, project discovery, driver host, CLI, and immutable capture artifacts.
- [x] Implement the MuJoCo protocol driver and three-episode synthetic proof.
- [x] Feed captures through Calibration and one governed Training/evaluation cycle.
- [x] Verify, document, commit, and push.

## Findings and decisions

- 2026-07-23 — Capture is a deployment operation, not a Simulation Run variant:
  its authority comes from a Bundle/device handshake and safety transcript.
- 2026-07-23 — HIL/real authorization is a separate external artifact. A Coding
  Agent may prepare the Plan but cannot manufacture operator authority by editing
  project source.
- 2026-07-23 — Host safety is additive. It does not replace device firmware
  limits, physical E-stop, current/temperature protection, or an operator.
- 2026-07-23 — The synthetic estimator recovered delay exactly but selected
  mass `1.05`/strength `1.175` for a `1.10`/`1.20` plant. Short, safety-bounded
  episodes leave mass and strength partially confounded; the held-out loss
  (`0.01491`) is authoritative, not parameter-rounding theater.
- 2026-07-23 — Capture-calibrated PPO improves aggregate score
  `60.4130 → 60.6407` over the prior Policy but remains a failed candidate:
  low-friction progress still fails and strong-push survival regresses. Freeze
  the Policy as evidence; do not promote it.

## Progress log

- Capture `capture-1d9b7732f70b779e` completed three 50-step dry-run episodes:
  maximum host dispatch latency `1.05575 ms`, zero deadline misses, zero
  emergency stops, and calibration eligibility.
- Capture `capture-14a9552ea209a31f` crossed the `1.5 rad` body-tilt gate at
  step 63, emitted one emergency stop, and is calibration-ineligible.
- Calibration `calibration-727dc76775d22881` used two whole episodes for fit and
  one for validation. Fit loss is `0.00970`; held-out loss is `0.01491`.
- Training Run `training-1ca49f02f693e5b2` froze Policy
  `capture-calibrated-spatial-residual-locomotion-9539500c844b2ddc`.
- Conformance Verification `verification-87d1dc717fb6ecb5` is
  `PROTOCOL-VERIFIED`, explicitly not hardware-verified.
- `mujica validate` resolves 2 Capture Plans, 2 Calibrations, 3 Domain Profiles,
  11 Training definitions, and 13 locked Benchmarks. TypeScript/Studio/CLI has
  48 passing tests; Python Runtime has 34 passing tests.
