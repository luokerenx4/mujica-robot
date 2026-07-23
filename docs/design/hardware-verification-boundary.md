# Hardware verification boundary

Status: protocol boundary implemented; no physical-device claim.

A Hardware Target normally binds a kept Robot Revision, Assembly, and Controller
to a `dry-run`, `hil`, or `real` environment. It may instead name a Judge-kept
Policy Revision for observe-only learned-policy testing. It fixes
`stdio-jsonl-v1`, control frequency, device identity requirements, maximum
latency, tolerated consecutive deadline misses, and the exact emergency-stop
Action. It also names one project Driver Package with a confined executable,
device identity, supported environments, and explicit capabilities.

`mujica hardware export` publishes a content-addressed Hardware Bundle containing
the immutable source Revision snapshot, Controller, optional Policy, contracts,
Target, complete Driver Package, and handshake. Both the package hash and entry
executable hash participate in Bundle identity. A Robot Revision Bundle records
`maximumCaptureMode=actuate`. A Policy Revision Bundle derives
`maximumCaptureMode=shadow`; neither the Target nor a Capture Plan may widen it.
Export rechecks the locked `KEEP` decision, frozen model and contract hashes,
Controller-to-Policy pointer, and Policy bytes.

`mujica hardware verify` re-hashes every Bundle surface before accepting
separately collected Evidence. Evidence records device serial, Driver package
and executable hashes, exact bundle/contract hashes, timestamps, samples, latency, deadline
misses, driver-local deadline rejections, emergency stops, operator, and notes.
When a Target requires the decision-deadline capability, Evidence without at
least one exercised Driver rejection fails verification.
When it requires device health, Evidence must also contain health samples and at
least one exercised health trip; a nominal-only trace does not prove the
interlock.
When it requires post-stop health checking, Evidence must additionally exercise
one isolated actuator trip, the configured stop-latched sample window, and one
new-session-only recovery candidate.

`mujica capture run` closes the executable half of this boundary without
weakening verification semantics. A Capture Plan fixes finite episodes and a
stricter host safety envelope. Mujica launches one exact hashed executable,
from the Bundle-frozen package and rejects a caller-selected replacement. Before
launch it also proves that the current Harness source and dependency lock equal
the versions authorized by the Bundle. It checks an explicit handshake, runs
the frozen Bundle Controller, records the raw
bidirectional transcript, and sends an acknowledged emergency stop on every
protocol, Controller, deadline, or state violation. It never upgrades status to
`HARDWARE-VERIFIED`; Capture evidence and conformance verification remain
different claims.

Targets may require a `decision-deadline` Driver capability. The host rejects a
late Controller result before writing it, while the Driver independently rejects
an expired message before applying it. These checks use separate monotonic
clocks, so transport delay is covered without clock synchronization. An expired
message always aborts the episode; tolerated consecutive misses remain a
verification-evidence ceiling, not permission to apply stale control.

Targets may also require `device-health`. Every state then carries per-motor
temperature/current and typed actuator state, bus voltage, fault codes, physical
E-stop state, and Driver watchdog state. Missing or unsafe health aborts before
Controller evaluation. Capture records exact affected Action-channel indices
and separate health intervention evidence; this remains additive to, never a
replacement for, firmware and physical safety.

Post-stop health is deliberately one-way. After acknowledgement, the Driver
must prove it remains latched while Mujica observes a bounded healthy window.
The result may be called a recovery candidate only; the tripped Capture stays
aborted, no rearm message exists, and HIL/real authority can return only through
a new externally authorized session.

Physical authority is external. HIL/real Capture Plans require an unexpired
authorization naming the exact Plan, Bundle, Target, environment, operator,
device serial, and episode ceiling. This prevents project source edits by a
Coding Agent from granting real actuation authority.

The status vocabulary is intentionally strict:

- `FAILED`: driver failure or any identity/safety gate violation.
- `PROTOCOL-VERIFIED`: a passing `dry-run`; proves serialization, shapes, sequence handling, and emergency-stop conformance only.
- `SHADOW-VERIFIED`: passing Evidence for a shadow-only Policy Revision Bundle;
  proves the frozen learned stack and protocol can be observed, never that it may actuate.
- `HARDWARE-VERIFIED`: passing `hil` or `real` Evidence with the Target's physical device identity requirements.

`actuationQualified` is true only for an actuate-capable Bundle with passing
HIL/real Evidence. It is false for every dry-run and every Policy Revision
Bundle, independent of score or operator authorization.

The example dry-run includes both a separately verified conformance trace and a
MuJoCo-backed executable protocol driver. The completed three-episode Capture is
synthetic and calibration-eligible; a second Capture intentionally trips the
body-tilt gate, emits an emergency stop, and is ineligible. Both retain
`hardwareVerified=false`. Two additional negative proofs show that a learned
Policy late on the host produces no control message, and that a delayed ordinary
Action is rejected by the Driver without advancing MuJoCo. No MuJoCo run and no
simulated device can satisfy a physical verification claim.
