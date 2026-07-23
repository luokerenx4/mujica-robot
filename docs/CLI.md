# Mujica CLI

```text
mujica help [--json]
mujica validate <project> [--json]
mujica inspect <project> [--json]
mujica component list <project> [--json]
mujica component inspect <project> --component ID [--json]
mujica domain list <project> [--json]
mujica domain inspect <project> --domain ID [--json]
mujica calibration list <project> [--json]
mujica calibration inspect <project> --calibration ID [--json]
mujica calibration promote <project> --run ID [--json]
mujica calibrate <project> --calibration ID [--json]
mujica controller list <project> [--json]
mujica controller inspect <project> --controller ID [--json]
mujica assembly inspect|compile <project> --assembly ID [--json]
mujica assembly compare <project> --from ID --to ID [--json]
mujica simulate <project> --assembly ID --controller ID --task ID --scenario ID [--seed N]
mujica studio <project> ([--run ID] [--compare-run ID] | --research-lab ID --session ID --experiment ID) [--json]
mujica evidence inspect <project> (--run ID --time S [--compare-run ID] | --capture ID --event N) [--json]
mujica observation list <project> [--json]
mujica observation inspect <project> --observation ID [--json]
mujica observation record <project> --input PATH --observer NAME [--json]
mujica hardware export <project> --target ID [--json]
mujica hardware verify <project> --bundle ID --evidence PATH [--json]
mujica driver list <project> [--json]
mujica driver inspect <project> --driver ID [--json]
mujica capture list <project> [--json]
mujica capture inspect <project> (--plan ID | --capture ID) [--json]
mujica capture run <project> --plan ID --operator NAME [--driver-arg ARG] [--driver-input PATH] [--authorization PATH] [--json]
mujica train <project> --training ID [--seed N]
mujica train-research <project> --research ID [--iterations N] [--agent-command CMD] [--json]
mujica policies <project> [--json]
mujica policy inspect <project> --policy ID [--json]
mujica policy requalify <project> --policy ID --assembly ID [--json]
mujica policy-revisions <project> [--json]
mujica policy-revision inspect <project> --revision ID [--json]
mujica benchmark lock <project> --benchmark ID [--json]
mujica evaluate <project> --assembly ID --controller ID --benchmark ID [--json]
mujica diagnose <project> --assembly ID --controller ID --benchmark ID [--json]
mujica candidate <project> --candidate ID [--apply] [--json]
mujica research list <project> [--json]
mujica research inspect <project> --lab ID [--json]
mujica research brief <project> --lab ID --observation ID [--observation ID] [--json]
mujica research brief inspect <project> --brief ID [--json]
mujica research run <project> --lab ID [--brief ID] --agent-command CMD [--iterations N] [--json]
mujica research status <project> --lab ID [--json]
mujica research review inspect <project> --lab ID --session ID --experiment ID [--json]
mujica research <project> --research ID [--iterations N] [--agent-command CMD] [--json]
mujica revisions <project> [--json]
mujica revision inspect <project> --revision ID [--json]
```

JSON mode emits one schema-versioned value on stdout. Validation/runtime failures use exit code 1; invalid CLI usage uses exit code 2. Artifact-producing commands identify each path and whether it is immutable.

`controller list` exposes each Program or Policy Controller and the Assemblies it can legally execute against. `controller inspect` includes the complete Program Controller interface or frozen Policy pointer plus structured incompatibility reasons. Program Controller Observation requirements are a named subset; produced Action channels must exactly match the compiled Assembly in order, size, and bounds. Incompatible pairs fail before Python Runtime invocation.

`domain list|inspect` exposes each Domain Profile's physical uncertainty ranges,
provenance, optional evidence-file hash, and combined identity. A `synthetic`
Profile may omit evidence but makes no calibration claim; `hil` and `real`
Profiles require confined captured evidence. Domain Profiles are Training inputs
only and are never sampled by `evaluate`.

`calibration list|inspect` exposes the capture sources, device provenance,
bounded fit parameters, whole-source validation split, and promotion threshold.
`calibrate` deterministically fits MuJoCo one control interval at a time and
writes an immutable Calibration Run with source hashes, search trace, fit and
validation metrics, and a proposed Domain Profile. `calibration promote` is the
only source-mutating step. It rechecks Runtime, Harness, model, definition,
Scenario, every source, proposal identity, and maximum validation loss before
writing the Profile. Simulation Runs can only support `synthetic` provenance;
`hil` and `real` captures require a serialized device identity.

`diagnose` evaluates the requested robot and the locked Benchmark baseline without publishing artifacts. It reports every enforced gate as a signed margin, ranks failing cases by normalized violation severity, preserves measured findings as `kind: evidence`, and labels possible intervention surfaces as `kind: hypothesis`. Its next action persists the worst case through `simulate` so events and trajectory can be inspected without confusing a heuristic with proof.

`studio` creates or reuses an immutable MuJoCo replay under `<project>/.mujica/replays/`, then copies it into a content-addressed offline projection under `<project>/.mujica/studio/`. It never edits robot source or immutable artifacts and never evaluates a Candidate. `--run` selects one completed Simulation Run; without it, the deterministic last run id is selected. The Runtime loads the Run's frozen `model.xml`, reconstructs every recorded `qpos`, and renders PNG frames. The browser only synchronizes those frames with trajectory, Events, health, attitude, command, measured motion, contact force, and Action telemetry.

The generated Studio directory can be opened directly or served by any static file server. Its controls support play/pause, previous/next frame, `0.25×`–`2×` speed, scrubbing, keyboard stepping, and Event seeking. The attention queue ranks measured Run/Capture failures before human hypotheses. “Copy frame context for Agent” includes a directly executable `evidence inspect` argv. Studio may copy or download an observation draft, but it cannot write project state. The command reports both the immutable `simulation-replay` and derived `studio-snapshot` artifacts in JSON mode; renderer source participates in snapshot identity.

`evidence inspect` is the Agent/headless side of the same workspace. Run mode
returns the exact row at or before `--time`, nearby Events, metrics, score, file
hashes, optional comparison and quality deltas. Capture mode first verifies the
immutable Capture, then returns transcript event `--event` with two neighboring
events on each side. Both return a `contextHash`.

`observation record` accepts only a closed
`mujica-human-observation-draft`, re-resolves its Run/Capture source, rejects a
changed result/capture hash, and publishes an immutable
`human-observations/observation-<hash>/` artifact. Its manifest fixes
`authority=human` and `claimKind=hypothesis`; severity and confidence are triage
metadata, never measured evidence. `observation list|inspect` gives Agents the
ledger and verifies artifact bytes before returning it.

`research brief` explicitly binds 1–16 unique, verified Human Observations to
one Research Lab. It publishes deterministic `research-briefs/brief-<hash>/`
bytes containing the complete source contexts, Lab definition/hash, program
hash, primary Benchmark lock, and a closed hypothesis/Judge authority boundary.
`research brief inspect` re-verifies the Brief and every referenced
Observation. A Brief prioritizes investigation; it cannot change source,
budgets, regressions, or promotion.

Every completed KEEP/REVERT Research Experiment attempts to publish a
`mujica-research-review`. `research review inspect` verifies Lab, program,
Benchmark lock, optional Brief/Observation, Session, Experiment, Judge decision,
and every byte of its accepted/candidate Runs before returning the exact Studio
argv. The Review is `derived-human-review` / `visual-witness`; it cannot alter
the locked verdict. `studio --research-lab ... --session ... --experiment ...`
requires all three selectors and opens that verified Run pair with the Review
lineage. It cannot be mixed with explicit `--run` selectors.

`hardware export` freezes one Hardware Target, source Revision, Controller,
optional Policy, selected Driver Package, Observation/Action contracts, safety envelope, and
`stdio-jsonl-v1` handshake into an immutable bundle. Robot Revision Bundles may
actuate. A Target may explicitly name a Judge-kept Policy Revision, but its
Bundle is derived as `maximumCaptureMode=shadow`; a Plan cannot widen that
authority. New exports require a Driver Package whose protocol, environment,
device identity, and declared capabilities satisfy the Target. They also require
a bounded command lease and maximum expiration overrun supplied by the frozen
Driver.

`driver list|inspect` exposes each project-owned `hardware-drivers/<id>/`
package, its closed manifest, whole-package hash, executable entry point, and
entry hash. The package may contain helper modules and static configuration;
hashing only the entry file is deliberately insufficient.

`hardware verify` validates separately collected driver Evidence and publishes
an immutable verification. A normal `dry-run` can only become
`PROTOCOL-VERIFIED`; a Policy Revision Bundle becomes `SHADOW-VERIFIED` and is
never `actuationQualified`; only passing `hil` or `real` Evidence for an
actuate-capable Robot Revision Bundle can become `HARDWARE-VERIFIED`.

Targets that declare `maximumStateAgeMs` require verification Evidence to report
the maximum observed device state age and enough acknowledgements to cover every
emergency stop. Missing, stale, or unacknowledged evidence fails verification.
Targets with a command lease additionally require an exercised expiration, a
Driver-autonomous stop, and observed silence inside the exact
`lease..lease+overrun` interval.

`capture list|inspect|run` is the executable device-session boundary. A Capture
Plan binds a finite episode set to one Bundle and may only reduce its authority
with Action scaling, slew limiting, and tighter state gates. `run` launches the
Bundle-frozen Driver entry and rejects `--driver` overrides for new Bundles. It
re-hashes both the package and entry, verifies that the current Harness source
and dependency lock equal the Bundle identity, freezes any repeated
`--driver-input` files, checks the Bundle/contract/environment/device handshake,
and executes only the Bundle-frozen Controller. `--driver PATH` remains accepted
only when replaying a legacy Bundle without a frozen Driver Package. A completed
artifact contains raw protocol bytes,
driver stderr, proposed/commanded/applied Actions, state-age telemetry, typed
stop acknowledgements, per-episode calibration NDJSON, timing, safety
interventions, and all source hashes.

A Plan may declare one `hostLossTest` episode/state. At that state Capture sends
no next control or stop message and waits for the Driver-originated
`lease-expired`. The event must report the exact frozen lease, last accepted
step, measured silence within the Target overrun bound, locked stop, and exact
emergency-stop Action. Post-stop checks remain read-only and cannot rearm.

Frozen Policy networks execute two stateless warm-up passes before the driver is
started. Capture reports preserve the warm-up count and strict
`realTimeQualified` evidence; any missed Controller-to-driver deadline makes the
capture ineligible for Calibration.

Targets with `requireDecisionDeadline=true` require the Driver capability
`decision-deadline`. A Plan may set a tighter `maximumDecisionLatencyMs`. The
host rejects late inference before dispatch; every dispatched control message
carries the same limit so the Driver can independently return
`deadline-rejected` before applying an expired Action. Either path aborts and is
reported separately.

Targets with `requireDeviceHealth=true` require `device-health` and explicit
temperature, current, and bus-voltage limits. Each state reports per-Action
channel motor temperature/current and `ready|derated|faulted|offline` state,
plus bus voltage, fault codes, E-stop state, and watchdog health. Unsafe or
malformed health stops the episode before Controller evaluation and before
either Action message kind. Capture manifests expose exact affected channel
indices, health extrema, and fault/E-stop/watchdog sample counts.

Targets with `requirePostStopHealthCheck=true` also bind
`postStopHealthySamples` and `postStopMinimumHealthyDurationMs`. After the
Driver acknowledges emergency stop, Capture sends only `health-check` and
accepts only matching `health-state { stopLatched: true }` responses. A fully
healthy window sets `recoveryEligible=true` and `requiresNewSession=true`; it
does not change `ABORTED`, send a rearm message, or authorize a later Action.

Every Plan explicitly selects `actuate` or `shadow`. Shadow commissioning sends
Controller output only as a non-authoritative `proposedAction`; the driver
reports its independently applied Action. Shadow artifacts set
`actuationAuthorized=false`, never send an ordinary `action` message, and cannot
be Calibration sources.

`dry-run` Capture Plans do not accept physical authorization and produce only
synthetic evidence. `hil` and `real` Plans require `--authorization`; that
external JSON must be unexpired and name the exact Plan hash, Bundle hash,
Target, environment, operator, device identity, and maximum episode count.
Protocol, freshness, deadline, Controller, or state-safety failures trigger
emergency stop and publish an ineligible `ABORTED`/`FAILED` artifact rather than
discarding the evidence. The driver must acknowledge the exact episode and stop
kind; writing a stop request alone is not success.

`policy requalify` is a narrow metadata-migration operation, not training. It requires the old content-addressed Assembly cache, byte-identical old/new MJCF, and identical Observation/Action contract hashes. Success creates a new immutable Policy with an explicit `requalification.json` proof and leaves the source Policy untouched. Any executable difference fails closed and requires training.

`research list|inspect|brief|run|status` is the V2 source-research interface. A
Lab names one human `program.md`, a controller/policy/development execution
lane, exact files or recursive `/**` directories the Agent owns, locked primary
and regression Benchmarks, fixed budgets, and a promotion target. `run`
executes the Agent command in a disposable project copy. The version-3 request
contains the Lab, current evidence/history, and an optional verified
`researchBrief`; the Agent edits files in its working directory and returns only
`strategy`, `hypothesis`, and `expectedEffect` metadata. `--brief` rejects a
Brief for another or changed Lab. Mujica derives the authoritative diff, rejects
every undeclared write, then runs the fixed Judge. Session/Experiment manifests
retain the Brief id and hash.

Every V2 attempt creates an immutable Experiment containing the proposal, patch, before/after hashes, execution references, evaluations, and verdict. Policy attempts retain their immutable Training Run and frozen Policy even on REVERT. KEEP rechecks source hashes before atomically copying the candidate source and publishing the appropriate Revision. `status` reads completed Session ledgers without starting work.

The legacy `research <project> --research ID` command remains intentionally mutating and available during migration. Without `--agent-command`, it uses the deterministic bounded numeric proposer. An external command returns one bounded-value proposal; Core runs the complete locked Benchmark and advances the controller plus Revision lineage only for KEEP.

`train-research` applies the same protocol to one Training JSON definition. Every candidate creates or reuses an immutable Training Run and Policy; only a frozen-policy KEEP advances the Training file, promoted policy Controller, and Policy Revision lineage. `policy-revisions` and `policy-revision inspect` expose that lineage without conflating it with whole-robot Revisions.

Training definitions may optionally declare non-negative `qualityReward` weights for `jointAcceleration`, `bodyAngularAcceleration`, `actionSlew`, `actuatorSaturation`, `footSlip`, and `footImpact`. Omission is exactly neutral. These normalized terms shape training only; immutable Training evidence records base reward, total quality penalty, each weighted term, and fixed reference magnitudes. Frozen Benchmark scores and KEEP/REVERT decisions never consume the shaped training reward.

Training may also name one Domain Profile. The Runtime samples one domain per
episode from a dedicated seed stream and records its exact parameters, consumed
steps, completion state, and aggregate coverage. The Policy freezes the Profile,
evidence hash, combined identity, and Training metrics. Omitting the field
preserves the existing fixed-Scenario behavior.
