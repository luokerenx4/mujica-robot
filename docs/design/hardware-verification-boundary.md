# Hardware verification boundary

Status: protocol boundary implemented; no physical-device claim.

A Hardware Target binds a kept Robot Revision, Assembly, and Controller to a `dry-run`, `hil`, or `real` environment. It fixes `stdio-jsonl-v1`, control frequency, device identity requirements, maximum latency, tolerated consecutive deadline misses, and the exact emergency-stop Action.

`mujica hardware export` publishes a content-addressed Hardware Bundle containing the immutable Revision snapshot, Controller, Observation/Action contracts, Target, and handshake. `mujica hardware verify` re-hashes every Bundle surface before accepting separately collected Evidence. Evidence records device serial, driver source hash, exact bundle/contract hashes, timestamps, samples, latency, deadline misses, emergency stops, operator, and notes.

The status vocabulary is intentionally strict:

- `FAILED`: driver failure or any identity/safety gate violation.
- `PROTOCOL-VERIFIED`: a passing `dry-run`; proves serialization, shapes, sequence handling, and emergency-stop conformance only.
- `HARDWARE-VERIFIED`: passing `hil` or `real` Evidence with the Target's physical device identity requirements.

The example dry-run exercises 250 Observation/Action JSONL round trips for the kept 3-DOF quadruped Revision. It is committed as protocol evidence with `hardwareVerified=false`. No MuJoCo run and no simulated device can satisfy a physical verification claim.
