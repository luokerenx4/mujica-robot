# Driver command-lease watchdog

Status: completed

## Outcome

Every newly exported Hardware Bundle carries a bounded command lease enforced
inside its frozen Driver. Starting an episode arms the lease; each accepted
control message renews it. If the host, Runtime, IPC path, or Coding Agent stops
delivering commands, the Driver independently applies the emergency-stop Action,
latches the stop, and publishes a typed expiration event without waiting for a
host stop request.

## Context

Mujica now freezes the complete Driver Package and executing Harness identity,
but the stdio Driver still blocks indefinitely in `readline()`. The current
`watchdogHealthy` telemetry can report a pre-existing fault, yet it does not
prove that loss of the host causes an autonomous stop. A real actuator boundary
must not retain the last command merely because the process responsible for
supervising it disappeared.

## Scope

- Add a bounded Target command lease and require a `command-lease` Driver
  capability for every new Bundle.
- Carry the exact lease through hello, episode start, and every control message;
  the Driver may not accept a caller-selected wider value.
- Make the example MuJoCo Driver wait on input with an independent monotonic
  deadline, apply the Bundle emergency-stop Action on expiry, latch the stop,
  and emit `lease-expired`.
- Add an explicit Capture Plan host-loss test that withholds the next command
  and waits for the Driver-originated stop event.
- Record expiration timing, last accepted step, autonomous-stop count, stop
  latch, and post-stop health evidence in immutable Capture identity.
- Require separately collected Verification Evidence to exercise the command
  lease when the Target declares it.

Out of scope:

- pretending a Python process timer is a substitute for a production motor
  controller or firmware watchdog;
- automatically rearming after host recovery;
- accepting an ordinary Action after lease expiry in the same session;
- vendor-specific CAN/EtherCAT transports without selected hardware.

## Acceptance

- [x] Target and Driver validation bind one positive command lease and the
  `command-lease` capability.
- [x] Normal Program and learned-Policy Captures renew the lease and retain
  their current safety authority.
- [x] A host-loss test contains no host control or stop message after the
  selected state and receives one valid Driver-originated `lease-expired`.
- [x] The Driver applies the exact emergency-stop Action, remains stop-latched,
  rejects later control, and supports the existing post-stop health window.
- [x] Capture identity/report expose bounded expiration timing and autonomous
  stop evidence; the resulting Capture is `ABORTED`, never calibration-eligible,
  and never a recovery candidate.
- [x] Verification rejects Evidence that does not exercise the required lease
  while legacy Bundles and Evidence remain readable.
- [x] Project validation, historical/new Capture inspection, TypeScript/Python
  tests, source-format checks, commit, and push pass without staging the
  preserved user Run.

## Work

1. Extend Target, Driver capability, Plan, Evidence, and protocol schemas.
2. Implement independent Driver expiry and Runtime event validation.
3. Add host-loss fixtures, tests, docs, and conformance evidence.
4. Re-lock Judges, regenerate Bundles/Captures/verifications, audit, commit, and
   push.

## Findings and decisions

- 2026-07-23 — The existing `watchdogHealthy` bit is device telemetry, not a
  host-loss guarantee. Evidence of an autonomous stop needs a Driver-originated
  event containing the lease bound and measured silence.
- 2026-07-23 — The test Harness will withhold a command after a declared state
  rather than asking the Driver to fake a timeout after receiving one. The raw
  transcript can therefore prove that no host Action or stop caused expiry.
- 2026-07-23 — A command lease trip is not a device-health recovery candidate.
  Healthy stop-latched samples prove containment only; a new authorized session
  remains mandatory.
- 2026-07-23 — Expiration must be upper-bounded as well as eventually observed.
  Targets therefore bind a maximum overrun, and both Capture and Verification
  reject silence outside `lease..lease+overrun`.
- 2026-07-23 — Stop latch is part of the public protocol, not merely Driver
  state. The frozen message set declares `control-rejected`, and a direct
  subprocess test proves that an Action after lease expiry cannot rearm the
  session.

## Progress log

- 2026-07-23 — Audited the synchronous Driver `readline()` loop, Capture
  command/stop sequence, device watchdog telemetry, post-stop window, Evidence
  verifier, and immutable identity. Confirmed that host disappearance currently
  leaves no executable transition.
- 2026-07-23 — Published Robot Bundle `hardware-4e461b759f1533d5` and
  Policy-shadow Bundle `hardware-12ba10be31d7dfcc`, both freezing Driver Package
  `a11faeba3d4cd6d8b1422763425f5063b325eb982ebcaf176673513e012123d0`.
- 2026-07-23 — Regenerated learned-Policy normal Capture
  `capture-1e17c57a735d5d07`, isolated-fault Capture
  `capture-7ad9ef82325a0fec`, recovery-candidate Capture
  `capture-392da695a42f1a31`, and Program identification Capture
  `capture-a5c00590f8862fbc`; all ordinary sessions renewed the lease without an
  expiration.
- 2026-07-23 — Host-loss Capture `capture-91a394ba19589331` accepted one
  Action, then received no host control or stop. The Driver autonomously applied
  the zero emergency Action and latched at `103.694042 ms` against a `100 ms`
  lease and `25 ms` overrun. Three healthy locked samples produced no recovery
  candidate; the artifact is `ABORTED`, real-time-unqualified, and
  calibration-ineligible.
- 2026-07-23 — Published conformance records
  `verification-bfa022546084886a` (`PROTOCOL-VERIFIED`) and
  `verification-14f332fe7db2ad3e` (`SHADOW-VERIFIED`) with an exercised lease
  expiration and Driver-autonomous stop.
- 2026-07-23 — Re-locked all 13 Benchmarks, validated 7 Capture Plans, 1 Driver
  Package, and 9 executable MuJoCo Assemblies, then passed TypeScript typecheck,
  59 TypeScript/Studio tests with 498 expectations, 40 Python Runtime tests, and
  source-format checks. The direct Driver test also proves post-expiry Action
  rejection and stop-latched health.
