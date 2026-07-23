# Mujica project format

Every project contains `mujica.json` and owns all robot assets it references.

```text
project/
  mujica.json
  development-charter.json
  morphology.json
  robots/<id>/robot.json + model.xml
  components/<id>/component.json + model.xml
  assemblies/<id>.robot.json
  controllers/<id>/controller.json + controller.py
  trainers/<id>/trainer.json + trainer.py + model.py
  training/<id>.training.json
  domain-profiles/<id>.domain.json
  calibrations/<id>.calibration.json
  training-research/<id>.training-research.json
  tasks/<id>.task.json
  scenarios/<id>.scenario.json
  objectives/<id>.objective.json
  benchmarks/<id>.benchmark.json + <id>.lock.json
  candidates/<id>/candidate.json
  research/<legacy-id>.research.json
  research/<lab-id>/research.json + program.md
  AUTORESEARCH.md
  research-runs/<legacy-research-id>/results.tsv + <immutable-experiment>/...
  research-runs/<lab-id>/sessions/<immutable-session>/...
  policies/<immutable-id>/...
  policy-revisions/<immutable-id>/manifest.json
  revisions/<immutable-id>/manifest.json
  hardware-targets/<id>.hardware.json
  hardware-drivers/<id>/driver.json + executable + package files
  hardware-bundles/<immutable-id>/...
  capture-plans/<id>.capture.json
  hardware-captures/<immutable-id>/...
  hardware-verifications/<immutable-id>/...
  human-observations/<immutable-id>/manifest.json + draft.json + context.json
  research-briefs/<immutable-id>/manifest.json + brief.json
  runs/<immutable-id>/...
  calibration-runs/<immutable-id>/...
  training-runs/<immutable-id>/...
  training-research-runs/<research-id>/results.tsv + <immutable-experiment>/...
```

IDs use lowercase letters, digits, and hyphens and must match their directory or filename. Relative paths are confined beneath the project or package that owns them. Unknown JSON keys fail validation so typos cannot silently change a robot.

`development-charter.json` freezes the project's proposition, operational
domain, exclusions, capability stages, and the exact Benchmark cases that
witness each stage. `morphology.json` names the base body and contact sites for
Runtime diagnosis independently of any four-leg naming convention. Morphology
is carried in compiled output but excluded from executable Assembly identity,
so an observability-only metadata improvement does not invalidate compatible
Policies.

A Human Observation is a separate immutable hypothesis, never part of a Run,
Capture, or Judge result. Its draft selects one Run time (and optional comparison
Run), one verified Hardware Capture transcript event, or one completed Capture
episode time by exact Capture, Bundle, and episode hashes.
Recording reconstructs and freezes the complete evidence context, then binds
observer, timestamp, category, triage severity, confidence, summary, optional
detail/next action, draft hash, and context hash. See [Human–AI debugging
workspace](design/human-ai-debugging-workspace.md).

Every Component manifest explicitly declares center of mass, diagonal inertia, geometry/collision inventory, joints, actuators, sensors, Observation/Action channels, dependencies, configuration schema, mass/cost proxies, license, and attribution. Empty inventories are explicit—for example a Runtime-only telemetry component has no geometry or MJCF joint. Core validates instance configuration, inventory uniqueness, Sensor-to-Observation coverage, and that MJCF-backed inventory names exist in the fragment.

V1 Component configuration uses a closed primitive JSON schema and explicit `{{config.<key>}}` bindings in the MJCF fragment. Defaults are resolved into the compiled Component. Unknown, missing, non-finite, out-of-range, unresolved, or unused values fail compilation, and strings are XML-escaped. This keeps an Assembly parameter edit both agent-readable and executable; see [Typed Component configuration](design/component-configuration.md).

A Component may use top-level `fragment`, structural `mountFragment`, or both. Robot Base MJCF exposes an intentional structural slot with `<!-- MUJICA_MOUNT:<mount-id> -->`; the compiler inserts a selected Component's mount fragment there and rejects missing, duplicate, unknown, incompatible, or multiply occupied exclusive slots. See [Structural Mount slots](design/structural-mount-slots.md).

Every Program Controller declares an `interface.requiredObservations` named subset and a complete ordered `interface.actionChannels` output contract. Each entry fixes its flat size; Action entries also fix numeric bounds. Core checks the interface against a compiled Assembly before Runtime invocation and across project defaults, Benchmark baselines, Candidates, Research definitions, and Hardware Targets. Policy Controllers retain the stronger exact contract hashes stored in their immutable Policy Artifact. See [Program Controller interface contract](design/program-controller-interface.md).

Task v2 carries one explicit constant episode `motionCommand`: world-frame planar linear velocity in metres per second and body-frame yaw rate in radians per second. Task v3 carries 1–16 control-grid-aligned command segments and exposes only the active segment through the same Observation channel. A Controller receives it only when its Assembly includes the zero-mass `motion-command-input` Runtime Component. Trajectory evidence records the command beside measured motion, and the evaluator compares yaw against free-joint angular velocity rather than the unrelated vertical linear velocity. See [Motion command contract](design/motion-command-contract.md).

Scenarios may define seeded initial joint-position and joint-velocity noise in addition to observation noise, friction, payload, lateral push, and actuator delay. Scenario sliding friction is applied to every MuJoCo contact geometry so a low-friction case cannot become inert through geom-pair combination. Objectives may score clipped forward progress while independently gating signed target-direction progress, maximum backward displacement, signed backward pitch, absolute pitch, and absolute pitch rate; a surviving robot that slides or tumbles backward therefore cannot pass as stationary. They may also gate maximum drift, planar/yaw tracking, transition terminal error, settling, braking-only settling, overshoot, and unsettled-transition counts. Trajectory rows retain commanded/measured motion, signed pitch/pitch rate, and an optional per-foot contact-force vector for deployable diagnosis. Benchmark cases default to `gating: true`; `gating: false` keeps a known challenge in aggregate scoring without claiming it as a release gate. See [Traction recovery](design/traction-recovery.md).

A Domain Profile bounds body-mass, joint-damping, actuator-strength, contact
friction, added observation-noise, and actuator-delay uncertainty for Training.
It declares `synthetic`, `hil`, or `real` provenance; physical profiles require
a confined evidence path, and the evidence bytes participate in identity.
Samples use a dedicated deterministic episode seed and are frozen into Training
and Policy artifacts. Benchmark evaluation remains fixed-Scenario and never
receives a random profile. See [Sim-to-real Domain
Profiles](design/sim-to-real-domain-profiles.md).

A Calibration definition binds an Assembly and neutral base Scenario to at least
two content-hashed Simulation Run v3, external NDJSON, or governed Hardware
Capture episode sources. It
declares synthetic, HIL, or real provenance, bounded plant parameters, a
whole-source validation count, deterministic search budget, and maximum
validation loss. HIL/real definitions require serialized device identity, cannot
consume simulated Runs or loose external paths, and accept only an eligible
Hardware Capture with matching environment and device. The immutable Calibration
Run records the search and proposes a Domain Profile; `calibration promote`
separately revalidates all identities and copies the proposal into source. See
[System-identification captures](design/system-identification-captures.md).

A Research definition names one locked Benchmark, one Assembly, one program Controller, one Markdown instruction program, and one exact controller JSON file. V1 editable parameters are finite numeric `/config/<key>` values with explicit bounds, step size, and search order. Benchmark, task, scenario, objective, assembly, controller source, and runtime files are never delegated to the proposer.

A Training Research definition similarly names one Training JSON file and promoted policy Controller. Candidate Training Runs and Policies are immutable even on REVERT. KEEP advances both mutable pointers and publishes an immutable Policy Revision. Policy identity includes Runtime and Harness source, dependency locks, Trainer, contracts, seed, budget, and model content.

A V2 Research Lab lives at `research/<id>/research.json` beside its human-owned `program.md`. It selects one `controller`, `policy`, or `development` execution lane; one locked primary Benchmark; zero or more locked regression Benchmarks; exact editable files or trailing-`/**` directory closures; experiment, wall-clock, and optional training-transition budgets; minimum improvement; and an evidence, Policy Revision, or Robot Revision promotion rule. The Agent owns only the declared source closure. Runtime, Harness, Benchmarks, locks, objectives, tasks, scenarios, generated artifacts, and every undeclared project path remain fixed.

Each V2 invocation creates an immutable Session under `research-runs/<lab-id>/sessions/`. Its `results.tsv` is compact Agent memory; every Experiment directory contains proposal metadata, an authoritative source patch, before/after hashes, execution references, frozen evaluation evidence, verdict, manifest, and—when KEEP or REVERT completed successfully—a `review.json`. Candidate work occurs in a disposable project copy. REVERT and CRASH cannot modify source. KEEP uses stale-source checks and a rollback-capable source transaction before publishing the declared Revision. Large content-addressed Runs, Training Runs, Policies, Revisions, and the accepted/candidate Simulation Runs referenced by a Research Review stay in their normal top-level stores.

A Research Review selects one deterministic primary-Benchmark witness after the
Judge decision, while the isolated candidate still executes. It binds complete
Lab/Brief/Session/Experiment/Judge lineage to two integrity-checked immutable
Runs. The Experiment manifest records `AVAILABLE`, `UNAVAILABLE`, or
`NOT_APPLICABLE`; the Session counts successful and failed captures. Review
failure cannot change KEEP/REVERT, and one selected case cannot represent the
full Judge suite. See [Human-reviewed Research
Outcomes](design/human-reviewed-research-outcomes.md).

A Research Brief lives at `research-briefs/brief-<hash>/`. It deterministically
binds one Lab/program/primary-Benchmark-lock identity to 1–16 immutable Human
Observations and their complete evidence contexts. It is a derived,
`research-prioritization` handoff—not source, measured evidence, or a verdict.
Brief and Observation artifact roots are excluded from the Researcher's source
snapshot; the verified Brief travels in the Agent request and is copied into the
Session. `research run --brief` fails closed when the current Lab, program, lock,
Brief, or referenced Observation bytes differ.

Compiled Assemblies have two identities. `assemblyHash` covers the complete Base/Component package provenance; `executionHash` covers the composed MJCF bytes and ordered Observation/Action contracts. A metadata edit therefore changes provenance even when execution is identical. `policy requalify` may derive a new immutable Policy only when the old content-addressed MJCF and both contracts exactly match the new Assembly; otherwise retraining is mandatory.

A Candidate contains a strict `changes` declaration for components, Observation channels, Action channels, Controller files, optional Trainer/training files, and an optional frozen Policy transition. Mujica compiles both Assemblies and rejects the Candidate when this declaration differs from the semantic diff. Controller and Trainer files declared as changed must also appear in `allowedChanges`. `trainer: null` and `policy: null` are explicit evidence that a Candidate did not change those surfaces.

Candidate preview computes a content-derived proposed Robot Revision hash before apply. Selection is feasibility-first: a zero-violation Candidate may KEEP by eliminating locked baseline violations even when its aggregate score is lower, provided every per-case regression gate still passes; when both sides are feasible, aggregate score must improve. A KEEP Revision records component-package hashes, Observation/Action contract hashes, Controller identity, optional Policy identity, the verified semantic change set, exact changed files, fixed Benchmark identity, full evaluation evidence, and the selection reason. Policy-backed Revisions copy the referenced immutable Policy Artifact into their own snapshot so replay does not depend on a mutable pointer.

A Hardware Target binds a kept Robot Revision, or explicitly a Judge-kept Policy
Revision, to one `dry-run`, `hil`, or `real` environment, a driver protocol,
one project Driver Package, control rate, explicit device identity,
latency/deadline, a command lease with bounded expiration overrun, optional
state-age gates, and a contract-sized
emergency-stop Action. It may require typed device health and must then declare
motor-temperature/current ceilings and a valid bus-voltage interval. Device
health includes one `ready|derated|faulted|offline` state per Action channel.
Optional required post-stop checking binds a healthy sample count and minimum
duration; the resulting recovery candidate always requires a new session.
The Driver Package manifest fixes one confined regular executable, protocol,
supported environments, device vendor/model, and explicit capability set.
Project validation requires the Target and package to agree and checks that the
package supplies every capability implied by Target safety and Policy shadow
operation. Export hashes and copies the complete package and separately hashes
its entry; new exports cannot omit this binding.

Exported bundles and verification records are immutable. The Bundle identity
includes the Driver package, its whole-package hash, its executable hash, and
the Harness source/dependency hashes. Capture always launches the frozen copy,
rejects overrides, and fails if the currently executing Harness differs from
the authorized Bundle. External Evidence must carry exact bundle and contract
hashes, Driver package and executable hashes,
device serial, timestamps, sample count, timing measurements, emergency-stop
count and acknowledgements, and operator identity. A Target with a state-age
gate also requires maximum observed device state age; a Target requiring
decision deadlines also requires Evidence of a Driver-local rejection. Required
command leases require one expiration whose measured silence is no shorter than
the lease and no longer than lease plus overrun, plus a Driver-autonomous stop.
Required
device health adds health sample and exercised-trip evidence. Required
post-stop checking additionally requires an isolated-actuator trip, a complete
stop-latched health window, and at least one recovery candidate; none of those
protocol-only facts grant actuation authority.

`revisionKind` defaults to `robot`. A `policy` Target is exported with
`sourceKind=policy-revision` and a derived `maximumCaptureMode=shadow`. The
Bundle freezes the Policy Revision, neural Policy, Controller pointer, compiled
model, and locked Judge evidence. Authored files cannot raise that ceiling.

A Capture Plan binds one such Bundle to 1–32 finite episodes, explicitly in
`shadow` or `actuate` mode. Each episode has an ID, seed, and bounded step count;
Plan safety may only tighten authority with
Action scale/slew, an optional `maximumDecisionLatencyMs`, maximum joint
velocity, and optional free-base height/tilt gates. The Plan deadline cannot
exceed the Target's `maximumLatencyMs`. A Target may require the
`decision-deadline` capability, which makes both host pre-dispatch and
Driver-local pre-application rejection mandatory. Additional per-session driver
inputs are content-hashed and frozen but cannot replace or modify the Bundle
Driver Package.
A Plan may name one `hostLossTest` episode and state. That is an intentional
negative commissioning test: after the selected state the host withholds both
control and stop requests until the Driver independently expires its frozen
lease. The resulting artifact is necessarily aborted and calibration-ineligible.
HIL/real execution additionally requires a separate expiring authorization with
the exact Plan/Bundle/operator/device identity and episode ceiling. Shadow mode
transmits only non-authoritative Controller proposals and is never
calibration-eligible. Capture artifacts preserve the byte-exact transcript,
proposed/commanded/applied Actions, state age, typed stop acknowledgements,
per-episode capture data, timing, interventions, stops, executable identity, and
authorization. See
[Hardware capture protocol](design/hardware-capture-protocol.md).

Simulation Run v3 freezes the exact compiled `model.xml` and initial `qpos`/`qvel`
beside its compiled Assembly, Controller, Task, Scenario, and Objective inputs.
Every trajectory row distinguishes the Controller's commanded Action from the
delayed Action actually applied by MuJoCo. Its manifest records all content
hashes, making the same Run suitable for visual replay and synthetic calibration.
Derived PNG replays live under ignored `.mujica/replays/<content-id>/`; their
identity covers the Run result, frozen model, trajectory bytes, Runtime/MuJoCo
renderer, camera, resolution, and stride. Legacy Runs can be replayed only while
their matching content-addressed Assembly cache is still available.

Completed Hardware Capture episodes use the same renderer only after Capture
and Bundle integrity verification. Their v2
`mujica-hardware-capture-replay` identity covers Capture, Bundle, episode,
frozen model, Runtime/MuJoCo renderer, and settings. The frames project
device-reported kinematics through Bundle geometry; they are not camera,
motion-capture, physical-contact, Calibration, or hardware-verification
evidence.

`mujica-workspace.json` contains only a name, one projects directory, and an
optional default project. Workspaces never provide shared components or
policies. `mujica project create` publishes a fully validated project atomically
inside that directory; `mujica studio <workspace>` packages a read-only project
switcher over the independently owned projects.
