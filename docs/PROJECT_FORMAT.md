# Mujica project format

Every project contains `mujica.json` and owns all robot assets it references.

```text
project/
  mujica.json
  robots/<id>/robot.json + model.xml
  components/<id>/component.json + model.xml
  assemblies/<id>.robot.json
  controllers/<id>/controller.json + controller.py
  trainers/<id>/trainer.json + trainer.py + model.py
  training/<id>.training.json
  training-research/<id>.training-research.json
  tasks/<id>.task.json
  scenarios/<id>.scenario.json
  objectives/<id>.objective.json
  benchmarks/<id>.benchmark.json + <id>.lock.json
  candidates/<id>/candidate.json
  research/<id>.research.json
  AUTORESEARCH.md
  research-runs/<research-id>/results.tsv + <immutable-experiment>/...
  policies/<immutable-id>/...
  policy-revisions/<immutable-id>/manifest.json
  revisions/<immutable-id>/manifest.json
  hardware-targets/<id>.hardware.json
  hardware-bundles/<immutable-id>/...
  hardware-verifications/<immutable-id>/...
  runs/<immutable-id>/...
  training-runs/<immutable-id>/...
  training-research-runs/<research-id>/results.tsv + <immutable-experiment>/...
```

IDs use lowercase letters, digits, and hyphens and must match their directory or filename. Relative paths are confined beneath the project or package that owns them. Unknown JSON keys fail validation so typos cannot silently change a robot.

Every Component manifest explicitly declares center of mass, diagonal inertia, geometry/collision inventory, joints, actuators, sensors, Observation/Action channels, dependencies, configuration schema, mass/cost proxies, license, and attribution. Empty inventories are explicit—for example a Runtime-only telemetry component has no geometry or MJCF joint. Core validates instance configuration, inventory uniqueness, Sensor-to-Observation coverage, and that MJCF-backed inventory names exist in the fragment.

V1 Component configuration uses a closed primitive JSON schema and explicit `{{config.<key>}}` bindings in the MJCF fragment. Defaults are resolved into the compiled Component. Unknown, missing, non-finite, out-of-range, unresolved, or unused values fail compilation, and strings are XML-escaped. This keeps an Assembly parameter edit both agent-readable and executable; see [Typed Component configuration](design/component-configuration.md).

A Component may use top-level `fragment`, structural `mountFragment`, or both. Robot Base MJCF exposes an intentional structural slot with `<!-- MUJICA_MOUNT:<mount-id> -->`; the compiler inserts a selected Component's mount fragment there and rejects missing, duplicate, unknown, incompatible, or multiply occupied exclusive slots. See [Structural Mount slots](design/structural-mount-slots.md).

Every Program Controller declares an `interface.requiredObservations` named subset and a complete ordered `interface.actionChannels` output contract. Each entry fixes its flat size; Action entries also fix numeric bounds. Core checks the interface against a compiled Assembly before Runtime invocation and across project defaults, Benchmark baselines, Candidates, Research definitions, and Hardware Targets. Policy Controllers retain the stronger exact contract hashes stored in their immutable Policy Artifact. See [Program Controller interface contract](design/program-controller-interface.md).

Task v2 carries one explicit constant episode `motionCommand`: world-frame planar linear velocity in metres per second and body-frame yaw rate in radians per second. Task v3 carries 1–16 control-grid-aligned command segments and exposes only the active segment through the same Observation channel. A Controller receives it only when its Assembly includes the zero-mass `motion-command-input` Runtime Component. Trajectory evidence records the command beside measured motion, and the evaluator compares yaw against free-joint angular velocity rather than the unrelated vertical linear velocity. See [Motion command contract](design/motion-command-contract.md).

Scenarios may define seeded initial joint-position and joint-velocity noise in addition to observation noise, friction, payload, lateral push, and actuator delay. Scenario sliding friction is applied to every MuJoCo contact geometry so a low-friction case cannot become inert through geom-pair combination. Objectives may score clipped forward progress while independently gating signed target-direction progress, maximum backward displacement, signed backward pitch, absolute pitch, and absolute pitch rate; a surviving robot that slides or tumbles backward therefore cannot pass as stationary. They may also gate maximum drift, planar/yaw tracking, transition terminal error, settling, braking-only settling, overshoot, and unsettled-transition counts. Trajectory rows retain commanded/measured motion, signed pitch/pitch rate, and an optional per-foot contact-force vector for deployable diagnosis. Benchmark cases default to `gating: true`; `gating: false` keeps a known challenge in aggregate scoring without claiming it as a release gate. See [Traction recovery](design/traction-recovery.md).

A Research definition names one locked Benchmark, one Assembly, one program Controller, one Markdown instruction program, and one exact controller JSON file. V1 editable parameters are finite numeric `/config/<key>` values with explicit bounds, step size, and search order. Benchmark, task, scenario, objective, assembly, controller source, and runtime files are never delegated to the proposer.

A Training Research definition similarly names one Training JSON file and promoted policy Controller. Candidate Training Runs and Policies are immutable even on REVERT. KEEP advances both mutable pointers and publishes an immutable Policy Revision. Policy identity includes Runtime and Harness source, dependency locks, Trainer, contracts, seed, budget, and model content.

Compiled Assemblies have two identities. `assemblyHash` covers the complete Base/Component package provenance; `executionHash` covers the composed MJCF bytes and ordered Observation/Action contracts. A metadata edit therefore changes provenance even when execution is identical. `policy requalify` may derive a new immutable Policy only when the old content-addressed MJCF and both contracts exactly match the new Assembly; otherwise retraining is mandatory.

A Candidate contains a strict `changes` declaration for components, Observation channels, Action channels, Controller files, optional Trainer/training files, and an optional frozen Policy transition. Mujica compiles both Assemblies and rejects the Candidate when this declaration differs from the semantic diff. Controller and Trainer files declared as changed must also appear in `allowedChanges`. `trainer: null` and `policy: null` are explicit evidence that a Candidate did not change those surfaces.

Candidate preview computes a content-derived proposed Robot Revision hash before apply. Selection is feasibility-first: a zero-violation Candidate may KEEP by eliminating locked baseline violations even when its aggregate score is lower, provided every per-case regression gate still passes; when both sides are feasible, aggregate score must improve. A KEEP Revision records component-package hashes, Observation/Action contract hashes, Controller identity, optional Policy identity, the verified semantic change set, exact changed files, fixed Benchmark identity, full evaluation evidence, and the selection reason. Policy-backed Revisions copy the referenced immutable Policy Artifact into their own snapshot so replay does not depend on a mutable pointer.

A Hardware Target binds a kept Robot Revision to one `dry-run`, `hil`, or `real` environment, a driver protocol, control rate, explicit device identity, latency/deadline gates, and a contract-sized emergency-stop Action. Exported bundles and verification records are immutable. External Evidence must carry exact bundle and contract hashes, driver hash, device serial, timestamps, sample count, timing measurements, emergency-stop count, and operator identity.

`mujica-workspace.json` contains only a name, one projects directory, and an optional default project. Workspaces never provide shared components or policies.
