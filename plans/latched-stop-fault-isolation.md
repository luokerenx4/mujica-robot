# Latched-stop fault isolation

Status: completed

## Outcome

When a device or actuator health fault occurs, Mujica identifies the affected
Action channels, stops before Controller or learned-Policy dispatch, verifies
that the Driver remains stop-latched while collecting a bounded health window,
and publishes whether health has recovered enough to justify a new
operator-authorized session. It never resumes actuation in the tripped session.

## Context

The device-health slice makes temperature, current, bus voltage, Driver faults,
physical E-stop, and watchdog state fail closed. Its evidence still has two
real-robot gaps:

1. global fault strings and vector extrema do not identify which actuator is
   unavailable or derated;
2. the protocol closes immediately after an emergency-stop acknowledgement, so
   it cannot prove the device stayed stop-latched or that health stabilized
   before an operator considers recovery.

Automatically scaling a position-like Action is not a valid generic derating
strategy, and automatically rearming from host telemetry would silently widen
authority. This slice therefore improves diagnosis and recovery evidence
without inventing controller semantics or granting re-enable authority.

## Scope

- Extend required device health with one typed state per Action channel:
  `ready`, `derated`, `faulted`, or `offline`.
- Treat every non-ready actuator as unsafe and report exact affected indices.
- Add a negotiated stop-latched health-check exchange after acknowledged
  emergency stop.
- Require a configured number and duration of continuously healthy samples
  before publishing `recoveryEligible=true`.
- Keep the episode `ABORTED`; require a new Capture session and, for HIL/real,
  freshly revalidate a matching external authorization before any Action can be
  sent.
- Preserve legacy immutable Capture verification through conditional identity
  fields.
- Exercise the boundary with a single-actuator fault against the learned Policy,
  both persistent-fault and cleared-while-latched cases.

Out of scope:

- automatic rearm or same-session actuation recovery;
- generic Action-vector scaling as torque/current derating;
- claiming that dry-run or protocol evidence proves physical stop hardware;
- learning a fault-tolerant gait before a real robot topology and actuator
  authority contract exist.

## Acceptance

- [x] Hardware Target validation binds post-stop sample count and minimum
  duration whenever stop-latched health checking is required.
- [x] Bundle/Driver capability negotiation requires per-actuator health and
  stop-latched health messages.
- [x] A non-ready actuator aborts before program or RL Policy evaluation and
  immutable evidence names the exact affected Action-channel indices.
- [x] An acknowledged emergency stop is followed only by health-check messages;
  every response proves the Driver is still latched.
- [x] Persistent unhealthy samples publish `recoveryEligible=false`.
- [x] A continuously healthy bounded window publishes
  `recoveryEligible=true`, while the Capture remains `ABORTED`,
  calibration-ineligible, and unable to send an Action.
- [x] Protocol conformance exercises one isolated actuator trip and one
  stop-latched recovery candidate without claiming physical hardware.
- [x] Historical Captures still inspect, project validation passes, TypeScript
  and Python tests pass, and source-format checks are clean.
- [x] Durable protocol/verification decisions are documented and the completed
  slice is committed and pushed without staging the preserved user Run.

## Work

1. Extend schemas, Bundle protocol, device health parsing, and structured fault
   assessment.
2. Implement the stop-latched health window and immutable state-transition
   evidence.
3. Extend the MuJoCo protocol simulator, conformance driver, and learned-Policy
   fault-injection tests.
4. Regenerate content-addressed Bundles, Captures, verification evidence, and
   Benchmark locks.
5. Run the complete validation matrix, record evidence, commit, and push.

## Findings and decisions

- 2026-07-23 — Recovery is an authority transition, not a boolean inferred from
  one healthy sample. Mujica may publish a recovery *candidate* after a bounded
  stop-latched window, but only a new session can regain ordinary Action
  authority.
- 2026-07-23 — `derated` is unsafe at this generic protocol boundary. Position,
  velocity, torque, and normalized residual Actions cannot share a correct
  host-side scaling rule; derating must eventually be expressed by an
  actuator-specific Driver/firmware contract.

## Progress log

- 2026-07-23 — Audited the current Target, Bundle, Capture Runtime, learned
  Policy shadow path, conformance Driver, simulator, and immutable identity.
  Confirmed that the existing protocol stops on health faults but has neither
  per-actuator status nor post-stop health evidence.
- 2026-07-23 — Exported Robot Bundle `hardware-97efd7a11a8a19c4` and shadow-only
  Policy Bundle `hardware-ebceda3e231f082f`. Both negotiate
  `latched-stop-health`, enumerate typed actuator states, declare
  `automaticRearm=false`, and require a new session.
- 2026-07-23 — Learned-Policy Capture `capture-270d3df1b56e3484`
  isolated `7:faulted`, dispatched no proposal or Action, acknowledged emergency
  stop, observed three persistent unhealthy latched samples, remained
  `ABORTED`, and published `recoveryEligible=false`.
- 2026-07-23 — Learned-Policy Capture `capture-bd251119f0f57df6`
  isolated the same channel and observed three continuously healthy
  `stopLatched=true` samples across `23.8525 ms` against a `20 ms` requirement.
  It published a new-session-only recovery candidate while remaining
  `ABORTED`, non-actuating, and Calibration-ineligible.
- 2026-07-23 — Normal Policy shadow Capture `capture-a5e276df01083470`
  completed 10 control steps after two warm-ups with 11 ready-health samples,
  no deadline miss, and no actuation authority. Identification Capture
  `capture-cfa4ad0216a5f897` completed 3 × 50 steps with 153 ready-health
  samples and remains synthetic.
- 2026-07-23 — Conformance records `verification-70af5e200821a92a`
  (`PROTOCOL-VERIFIED`) and `verification-7a3acc072464ab79`
  (`SHADOW-VERIFIED`) each exercise an isolated trip and recovery candidate;
  both remain `hardwareVerified=false` and `actuationQualified=false`.
- 2026-07-23 — Historical Captures `capture-0fa51ea22fa54009` and
  `capture-1c01258e8a888ad8` still reconstruct under conditional identity.
  `mujica validate` passes; TypeScript/Core/CLI/Studio has 57 passing tests
  (465 expectations), Python has 38 passing tests, typecheck and
  `git diff --check` pass. All 13 Benchmark locks bind harness
  `7ca428e70f0a1fdca9084b84c2c4a048c2742470dac2c34281fa9be6615df015`
  and Runtime
  `51f5e8c37bac4068784ea06992015d9a1613f45078c413ecc37a48d0d2826cab`.
