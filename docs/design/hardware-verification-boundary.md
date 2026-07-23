# Hardware verification boundary

Status: protocol boundary implemented; no physical-device claim.

A Hardware Target binds a kept Robot Revision, Assembly, and Controller to a `dry-run`, `hil`, or `real` environment. It fixes `stdio-jsonl-v1`, control frequency, device identity requirements, maximum latency, tolerated consecutive deadline misses, and the exact emergency-stop Action.

`mujica hardware export` publishes a content-addressed Hardware Bundle containing the immutable Revision snapshot, Controller, Observation/Action contracts, Target, and handshake. `mujica hardware verify` re-hashes every Bundle surface before accepting separately collected Evidence. Evidence records device serial, driver source hash, exact bundle/contract hashes, timestamps, samples, latency, deadline misses, emergency stops, operator, and notes.

`mujica capture run` closes the executable half of this boundary without
weakening verification semantics. A Capture Plan fixes finite episodes and a
stricter host safety envelope. Mujica launches one exact hashed executable,
checks an explicit handshake, runs the frozen Bundle Controller, records the raw
bidirectional transcript, and sends best-effort emergency stop on every
protocol, Controller, deadline, or state violation. It never upgrades status to
`HARDWARE-VERIFIED`; Capture evidence and conformance verification remain
different claims.

Physical authority is external. HIL/real Capture Plans require an unexpired
authorization naming the exact Plan, Bundle, Target, environment, operator,
device serial, and episode ceiling. This prevents project source edits by a
Coding Agent from granting real actuation authority.

The status vocabulary is intentionally strict:

- `FAILED`: driver failure or any identity/safety gate violation.
- `PROTOCOL-VERIFIED`: a passing `dry-run`; proves serialization, shapes, sequence handling, and emergency-stop conformance only.
- `HARDWARE-VERIFIED`: passing `hil` or `real` Evidence with the Target's physical device identity requirements.

The example dry-run includes both a separately verified conformance trace and a
MuJoCo-backed executable protocol driver. The completed three-episode Capture is
synthetic and calibration-eligible; a second Capture intentionally trips the
body-tilt gate, emits an emergency stop, and is ineligible. Both retain
`hardwareVerified=false`. No MuJoCo run and no simulated device can satisfy a
physical verification claim.
