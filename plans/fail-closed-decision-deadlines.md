# Fail-closed decision deadlines

- Status: `completed`
- Updated: `2026-07-23`
- Related design: [Hardware capture protocol](../docs/design/hardware-capture-protocol.md), [Hardware verification boundary](../docs/design/hardware-verification-boundary.md)

## Outcome

Mujica now prevents an expired Controller or Policy result from becoming a robot
command. The host rejects late computation before dispatch, and a negotiated
Driver watchdog independently rejects late transport before applying the Action.
Both paths publish immutable negative evidence and require an acknowledged
emergency stop.

## Context

Capture previously measured the Controller-to-Driver latency only after writing
the Action. A missed deadline could therefore be visible in the report while the
simulated or physical Driver had already applied it. Policy preheating reduced
the observed latency but did not close that safety race.

## Scope

### In scope

- A Target-level requirement for Driver decision-deadline support.
- A Plan-level deadline that can only tighten Target authority.
- A host pre-dispatch gate around program and learned Controllers.
- A Driver-local monotonic watchdog before plant or hardware advancement.
- Separate host/Driver miss counters, transcript messages, and rejection proofs.
- Compatibility with immutable Captures and Bundles created before negotiation.

### Out of scope

- Hard real-time operating-system guarantees.
- Clock synchronization between host and Driver.
- Replacing firmware current, temperature, joint, or physical E-stop limits.
- Claiming dry-run timing as HIL or physical-device qualification.

## Acceptance

- [x] A late host decision emits no `action` or `shadow-action`.
- [x] An on-time host send delayed before Driver receipt is rejected before plant advancement.
- [x] Both failures require an exact emergency-stop acknowledgement.
- [x] Any miss sets `realTimeQualified=false` and prevents Calibration.
- [x] Plan deadlines cannot exceed the Hardware Target limit.
- [x] Required capability and rejection evidence fail closed when absent.
- [x] Existing historical Capture identities remain verifiable.
- [x] Full TypeScript and Python tests, locks, docs, artifacts, commit, and push pass.

## Findings and decisions

- 2026-07-23 — Host and Driver use their own monotonic clocks. This covers
  inference plus host processing on one side and transport plus Driver scheduling
  on the other without depending on synchronized wall clocks.
- 2026-07-23 — One expired message aborts the synchronous episode. Continuing
  would require inventing a state transition that was either not applied or was
  applied outside the declared control contract.
- 2026-07-23 — `maximumConsecutiveMisses` remains a ceiling for separately
  collected verification evidence; it does not authorize Capture to apply stale
  Actions.
- 2026-07-23 — Historical Bundles do not retroactively gain a capability. New
  Targets explicitly require it, while the Capture verifier conditionally
  reconstructs old identities without the new deadline fields.

## Evidence

- Final Robot Bundle: `hardware-2b9109aa14a3dd27`.
- Final Policy Revision shadow Bundle: `hardware-ff0d8c77d41216b6`.
- Normal learned-Policy Capture `capture-cc85b7527b49517f` completes ten shadow
  decisions with `0.815875 ms` maximum host decision latency, zero misses, and
  `realTimeQualified=true`.
- Host proof `capture-b29db00bde3f4cc1` trips at `0.878834 ms` against an
  intentionally impossible `0.001 ms` Plan deadline. Its transcript contains no
  Action or shadow Action, then an acknowledged emergency stop.
- Driver proof `capture-1c01258e8a888ad8` sends one ordinary Action within the
  host's `10 ms` limit. The Driver observes `30.080625 ms`, returns
  `deadline-rejected`, advances no MuJoCo step, and acknowledges emergency stop.
- Robot conformance `verification-12841ad27fbbf6c9` is
  `PROTOCOL-VERIFIED`; Policy conformance `verification-9265e73b72571fc4` is
  `SHADOW-VERIFIED`. Both remain `hardwareVerified=false` and
  `actuationQualified=false`.
- All 13 Benchmark locks use Harness hash
  `a088e3e3e812700f5f4d4165ece0afb3ad45678a4869aa529971f3947c7c44fe`
  and Runtime hash
  `b9ee539cfc75a350a451d11f50f383e9a834597cca1cf3c70adf90a87c10b3bd`.
  TypeScript/Core/CLI/Studio has 55 passing tests and Python Runtime has 37.
