# Frozen Driver Package deployment

Status: completed

## Outcome

A Hardware Target names one inspectable Driver Package. Export freezes that
package and executable into the content-addressed Bundle; Capture launches the
frozen copy and rejects every executable override; Verification
rejects Evidence from any other Driver identity. Robot Revision, learned Policy,
safety protocol, operator authority, and actual device-I/O code therefore share
one deployment identity.

## Context

Mujica currently freezes the robot, Controller/Policy, contracts, Target, and
safety envelope. `capture run --driver PATH` may still select any executable at
session time. Capture records its hash, but the Bundle and external
authorization do not bind that hash, and `hardware verify` accepts any
well-formed Evidence `driverHash`.

That is acceptable for early protocol experiments but not real robot
deployment: an Agent could edit or substitute the code with direct actuator
access after the Robot and Policy were judged. Host-loss watchdogs and recovery
semantics are not trustworthy until the code enforcing them is itself frozen.

## Scope

- Add project Driver Packages with a closed manifest, executable entry, device
  identity, protocol, and declared capabilities.
- Add `mujica driver list|inspect` for human and Agent discovery.
- Let new Hardware Targets name a Driver Package while retaining read support
  for immutable legacy Bundles.
- Validate Driver protocol/device/capabilities against the Target before export.
- Snapshot and hash the complete Driver Package plus executable in the Bundle
  identity.
- Launch the Bundle-frozen executable for every new Bundle. Retain `--driver`
  only for immutable legacy Bundles and reject it for Driver-bound Bundles.
- Bind Driver Package and executable hashes into Capture request/manifest and
  external Verification Evidence.
- Migrate the MuJoCo protocol simulator into a real example Driver Package and
  regenerate current deployment artifacts.

Out of scope:

- vendor-specific CAN/EtherCAT implementation without selected hardware;
- signed binaries, code-signing trust roots, or remote package distribution;
- host-loss command leases, which become the next protocol slice on top of this
  trusted executable identity;
- weakening Policy Revision shadow-only authority.

## Acceptance

- [x] Project validation and `driver inspect` prove the package entry is a
  regular executable file and its device/protocol/capabilities match both
  Targets.
- [x] Hardware Bundle identity and integrity cover the complete Driver Package
  and exact executable bytes.
- [x] `capture run` succeeds without `--driver` by launching the frozen copy.
- [x] Any executable override of a Driver-bound Bundle fails before Driver
  connection or Controller/Policy evaluation.
- [x] Capture manifest and handshake expose the frozen package/executable hashes.
- [x] Verification rejects missing or mismatched Driver Package/executable
  identity for new Bundles while legacy verification remains readable.
- [x] Normal, isolated-fault, recovery-candidate, and identification Captures
  are regenerated from the frozen Driver Package with unchanged safety
  authority.
- [x] TypeScript/Python tests, project validation, historical Capture
  inspection, source-format checks, commit, and push all pass without staging
  the preserved user Run.

## Work

1. Implement schema, loader, validation, and public Driver discovery.
2. Extend Bundle identity/export/integrity and Capture launch rules.
3. Extend Evidence verification, example Driver Package, tests, and docs.
4. Regenerate locks and immutable deployment evidence; audit, commit, and push.

## Findings and decisions

- 2026-07-23 — Hashing only the executable is insufficient for script drivers:
  sibling modules and configuration can own actuator behavior. Bundle identity
  therefore covers the complete Driver Package and also exposes the entry-file
  hash for installed-binary equality.
- 2026-07-23 — Entry-byte equality cannot make a script override safe because
  imports may resolve against different sibling modules. New Bundles therefore
  always launch their frozen Package copy. `--driver` exists only to keep
  historical Bundles executable.
- 2026-07-23 — A frozen script can still import mutable Harness modules.
  Capture therefore re-hashes the currently executing Mujica Runtime, Core, CLI,
  and dependency locks and refuses to start when they differ from Bundle
  authority.

## Progress log

- 2026-07-23 — Audited Core Target validation, Bundle export/integrity,
  authorization binding, Capture launch, handshake, Evidence verification, and
  CLI discovery. Confirmed that Driver bytes are currently recorded only after
  selection and are absent from Bundle authority.
- 2026-07-23 — Published Robot Bundle `hardware-00490ec553adbba4` and
  Policy-shadow Bundle `hardware-e998df153171b306`, both binding Driver Package
  `54bab8860525715063cb63c02f57b0da1ef392d24245091073479d2297529c7a`
  and executable
  `007fdc5f8b331ca8959b50b394a7e042b39774b36f804c1ed80d08f71cb390d4`.
- 2026-07-23 — Regenerated normal Policy Capture
  `capture-50eb71a84335b6be`, isolated-fault Capture
  `capture-250f6f92f78573e5`, new-session-only recovery candidate
  `capture-fb99d79cb965b5cf`, and calibration-eligible identification Capture
  `capture-d13cf7f4289bc1d3`.
- 2026-07-23 — Published `PROTOCOL-VERIFIED`
  `verification-b94fa6be332fd55b` and `SHADOW-VERIFIED`
  `verification-ba87000a2d4a24ce`, re-locked all 13 fixed Judges, inspected the
  four preceding and four replacement Captures, and passed project validation,
  source-format checks, 58 TypeScript tests with 482 expectations, and 38
  Python Runtime tests.
