# Plant-compatible calibration

Mujica carries two deliberately different MuJoCo identities.

- `modelHash` hashes the exact composed MJCF bytes. It remains part of `executionHash` and therefore governs exact replay, Policy execution compatibility, and requalification.
- `plantHash` hashes the composed MJCF after removing XML comments and whitespace between tags. It governs whether a calibrated physical Domain Profile may be used with an Assembly.

This separation is needed because runtime-only observation Components can add comments to the composed MJCF without adding bodies, joints, actuators, sensors, attributes, or other MuJoCo semantics. Those Components change the Observation Contract and must force Policy retraining, but they must not invalidate physical system-identification evidence for an unchanged plant.

The canonicalization is intentionally narrow. It does not reorder attributes, normalize numbers, remove elements, or ignore attribute values. Any authored MJCF semantic edit therefore changes `plantHash`. Mujica also keeps the exact `modelHash`; `plantHash` never permits an old Policy to bypass execution or Observation Contract checks.

Calibration Runs created after this contract record `plantHash` in their identity, manifest, and Profile proposal. Training fails closed when a Domain Profile declares a different `plantHash` than the selected Assembly. Profiles without `plantHash` remain readable as historical evidence, but do not gain a new compatibility claim.

For Policy Research Labs, physical compatibility is necessary but not sufficient. A Lab may declare a frozen program `referenceController`. Every learned candidate is then judged against that reference on the primary Benchmark and every regression Benchmark, in addition to being compared with the current learned Policy. A neural Policy cannot be promoted merely because it improves on a worse neural predecessor.
