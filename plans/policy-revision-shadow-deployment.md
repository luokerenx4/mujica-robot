# Policy Revision shadow deployment

- Status: `completed`
- Updated: `2026-07-23`
- Related design: [Hardware capture protocol](../docs/design/hardware-capture-protocol.md), [Policy training research](../docs/design/policy-training-research.md)

## Outcome

Mujica can put a Judge-kept experimental Policy Revision into an immutable,
observe-only Hardware Bundle and execute its frozen neural policy against device
telemetry without pretending that the Policy is the promoted robot or granting
it actuation authority.

## Context

Policy research produces immutable, locally improved Policy Revisions even when
they remain weaker than the promoted program Controller. Hardware export accepts
only whole-robot Revisions, while shadow commissioning accepts only exported
Bundles. The missing bridge forces a false choice: skip HIL evidence for learned
Policies, or misrepresent an experimental Policy as the robot head.

## Scope

### In scope

- Hardware Targets that explicitly name an immutable Policy Revision.
- Integrity checks across the frozen model, contracts, Controller pointer,
  Policy bytes, locked Judge decision, and Policy Revision identity.
- A Bundle-level `shadow` authority ceiling that Capture Plans cannot widen.
- Frozen Policy inference through the existing device protocol.
- Protocol and capture evidence that remain explicitly non-actuating.

### Out of scope

- Promoting the learned Policy to the whole-robot Revision.
- Letting a Policy Revision Bundle execute ordinary Actions.
- Online learning, weight updates, or normalization updates on a device.
- Claiming a dry-run simulator is HIL or physical hardware.

## Acceptance

- [x] Only a Judge-kept Policy Revision with matching frozen contracts can export.
- [x] The Bundle records `sourceKind=policy-revision` and `maximumCaptureMode=shadow`.
- [x] An actuate Plan against that Bundle fails before Runtime or driver launch.
- [x] Shadow Capture runs the frozen neural Policy and sends no ordinary Action.
- [x] Verification cannot label a shadow-only Bundle actuation-qualified.
- [x] Existing Robot Revision Bundles and historical Captures remain verifiable.
- [x] Full tests, refreshed locks/evidence, docs, commit, and remote push pass.

## Work

- [x] Audit the Policy Revision, Hardware Bundle, and Capture authority boundaries.
- [x] Implement Policy Revision export and immutable authority enforcement.
- [x] Run learned-Policy shadow and forbidden-actuation evidence.
- [x] Refresh durable design, tests, locks, verification, commit, and push.

## Findings and decisions

- 2026-07-23 — A Policy Revision is a legitimate experimental deployment source
  because it freezes the compiled robot, Controller pointer, Policy bytes,
  training identity, and locked Judge evidence. It is not a Robot Revision.
- 2026-07-23 — Authority is derived from source kind, not authored by the Target:
  every Policy Revision Bundle is unconditionally shadow-only.
- 2026-07-23 — A locally kept Policy may still have locked violations relative
  to the program Controller. Shadow deployment collects device evidence without
  weakening whole-robot promotion governance.
- 2026-07-23 — The first learned-policy shadow exposed a real deployment defect:
  lazy PyTorch initialization made the first proposal miss its 10 ms deadline.
  Two stateless network passes now execute before driver launch; they do not
  mutate weights, normalization, history inputs, or the program prior.
- 2026-07-23 — `realTimeQualified` is strict evidence, separate from session
  completion and the Target's tolerated consecutive misses. Any miss also makes
  an actuated Capture ineligible for Calibration.

## Progress log

- Policy Revision `quadruped-p-ed7ad2ff20dd` freezes the capture-calibrated
  bounded-history GRU Policy and a `KEEP` decision for fewer violations, while
  still retaining three locked violations; it is therefore the intended
  negative-control deployment source.
- Cold Bundle `hardware-03485ea13dbfca88` and Capture
  `capture-bec937ffaa364397` preserve the discovered defect: zero warm-up passes,
  `18.316833 ms` maximum dispatch latency, one deadline miss, and
  `realTimeQualified=false`.
- Preheated Bundle `hardware-113d1063cfc83f6b` and Capture
  `capture-0fa51ea22fa54009` run the same frozen Policy with two warm-up passes,
  `1.042625 ms` maximum dispatch latency, zero deadline misses, and
  `realTimeQualified=true`.
- The preheated transcript contains ten `shadow-action` proposals and zero
  ordinary `action` messages. Applied Action remains the driver's zero safe
  behavior and the Capture is never calibration-eligible.
- Verification `verification-4dea5fa5d25af550` is `SHADOW-VERIFIED`,
  `hardwareVerified=false`, and `actuationQualified=false`. The refreshed Robot
  Revision protocol boundary remains `PROTOCOL-VERIFIED` as
  `verification-9932d5610ead7a7d`.
- All 13 Benchmark locks were refreshed. TypeScript/Core/CLI/Studio has 54
  passing tests and Python Runtime has 37 passing tests.
