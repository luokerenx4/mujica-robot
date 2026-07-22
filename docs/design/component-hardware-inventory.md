# Component hardware inventory and Policy migration

Status: implemented and migrated.

Every Component is self-describing. Its manifest records mass, center of mass, diagonal inertia, geometry and collision intent, joints, actuators and control ranges, sensors and whether they originate in MJCF or Runtime, contract channels, dependencies, configuration schema, cost, license, and attribution. Empty arrays are meaningful declarations rather than missing knowledge.

Core validates configuration keys/types, per-inventory name uniqueness, Sensor-to-Observation coverage, and the presence of every MJCF-backed inventory name in the Component fragment. MuJoCo remains the final authority for composed joint, actuator, sensor, and referenced-site validity.

## Identity split

`assemblyHash` covers complete source provenance, so all Component metadata participates. `executionHash` covers only composed `model.xml`, Observation Contract, and Action Contract. This prevents descriptive edits from erasing provenance while giving Policy compatibility an exact executable boundary.

The migration changed all five example Assembly hashes. Their MJCF hashes remained exactly:

- baseline: `6c6a2bc933bb437c59375e40726319e24e757f52483e7ece1ca8f13d849f9f6b`;
- force sensing: `fdcd22aa107acac77e7ca6f6ce917f666bfab2dc6dd744e3503c7f4d4fb8ae89`;
- spatial 3-DOF: `9690d57de5ea56e19d3c970b2acdda352a69e42a95bbe19797f963b8131ff0ea`;
- bounded history: `5433c9eca695980694a51e121a2888f1e52d7c7280c37ec72815cffaf9d9f5c0`;
- actuator telemetry: `07799572c79da13767cfcafbb8679be79fe3c03d67f63ec177fdb77aca52dca9`.

## Frozen Policy migration

`mujica policy requalify` reads the old Assembly model from its content-addressed cache and refuses migration unless old/new MJCF bytes and both contracts match. It copies model weights into a new immutable Policy directory, updates current Assembly/catalog/execution identities, and writes `requalification.json` containing source Policy hash and both sides of the proof. The original artifact is never edited.

Six controller-facing Policies were requalified. Deterministic frozen evaluation proves the promoted spatial result is unchanged at `63.03496530081226`, including survival `1.0` in every case and actuator-delay progress `0.6940670682`.
