# Mujica CLI

```text
mujica help [--json]
mujica project list <workspace> [--json]
mujica project inspect <workspace-or-project> [--project ID] [--json]
mujica project create <workspace> --id ID --name NAME --template hexapod [--json]
mujica project review <workspace-or-project> [--project ID] [--assembly ID] [--controller ID] [--json]
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
mujica design render <project> --assembly ID [--json]
mujica design analyze <project> --assembly ID [--samples N] [--json]
mujica design study <project> --study ID [--json]
mujica design probe <project> --study ID --candidate ID [--json]
mujica simulate <project> --assembly ID --controller ID --task ID --scenario ID [--seed N]
mujica studio <workspace> [--json]
mujica studio <project> ([--run ID] [--compare-run ID] | --research-lab ID [--session ID [--experiment ID]] | --capture ID --episode ID | --twin-audit ID | --authority-counterfactual ID [--case ID]) [--json]
mujica twin audit <project> --capture ID --episode ID [--json]
mujica twin inspect <project> --audit ID [--transition N] [--json]
mujica evidence inspect <project> (--run ID --time S [--compare-run ID] | --capture ID (--event N | --episode ID --time S)) [--json]
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
mujica policy counterfactual <project> --assembly ID --controller ID --policy ID --benchmark ID --profile ID [--json]
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

`project list|inspect|create` is the Workspace lifecycle boundary. Creation is
confined to the Workspace projects directory, refuses overwrite, copies one
complete executable template, substitutes only project identity, validates the
Charter and all source definitions, and publishes atomically. The initial
`hexapod` template is intentionally concrete rather than an invalid blank
framework.

`project review` joins the Charter to one compiled Assembly/Controller subject.
It checks the declared design resource envelope, evaluates every unique locked
Benchmark named by the capability stages, records per-case gates and
reproduction commands, and publishes an immutable north-star Review. Authored
stage status remains project intent; observed PASS/FAIL remains derived
evidence.

`controller list` exposes each Program or Policy Controller and the Assemblies it can legally execute against. `controller inspect` includes the complete Program Controller interface or frozen Policy pointer plus structured incompatibility reasons. Program Controller Observation requirements are a named subset; produced Action channels must exactly match the compiled Assembly in order, size, and bounds. Incompatible pairs fail before Python Runtime invocation.

`design render` compiles one Assembly and locally generates deterministic home
and resting-pose views plus machine-readable joints, actuator ranges, model
mass, home bounds, and centre of mass. The content-addressed result lives under
ignored `<project>/.mujica/design-previews/`; cloning the repository and running
the command reconstructs it from checked-in MJCF and Component source. The
preview is a derived visual projection, not a Design Review, physical test,
Training authorization, or promotion result. See
[Local Design Previews](design/local-design-previews.md).

`design analyze` applies the same deterministic sampled kinematic screen to one
compiled Assembly. It checks authored-home foot clearance and four frozen
resting orientations, records collision-free contact opportunities and related
machine measurements, and emits an ignored local JSON/Markdown/HTML artifact.
`design study` loads a checked-in candidate-family definition, runs that same
probe and sample budget for every Assembly, evaluates the declared falsification
thresholds, and emits one local comparison gallery. A passing screen is not
dynamic recovery, Design acceptance, promotion, or physical evidence. See
[Embodiment Feasibility Studies](design/embodiment-feasibility-studies.md).

`design probe` selects a candidate from that Study, regenerates the static gate,
and refuses to simulate a candidate that is not `SUPPORTED_WITHIN_SCREEN`. It
runs the declared readable Program Controller across the frozen Scenario set,
preserves every immutable Run, evaluates self-righting, collision, and
joint-margin checks per Scenario, and emits a local aggregate with the next
development emphasis. Partial success is mechanism evidence only; it does not
authorize Training, accept a capability, or promote a Revision.

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

`studio <workspace>` creates an offline project home with Charter summaries,
project switching, embedded project Studios, and a form that emits the exact
`project create` command. It remains read-only; running that CLI command is the
explicit write boundary.

`studio <project>` creates or reuses an immutable MuJoCo replay under `<project>/.mujica/replays/`, then copies it into a content-addressed offline projection under `<project>/.mujica/studio/`. It never edits robot source or immutable artifacts and never evaluates a Candidate. `--run` selects one completed Simulation Run; without it, the deterministic last run id is selected. The Runtime loads the Run's frozen `model.xml`, reconstructs every recorded `qpos`, and renders PNG frames. The browser only synchronizes those frames with trajectory, Events, health, attitude, command, measured motion, contact force, and Action telemetry.

`studio --capture ID --episode ID` instead verifies one completed Hardware
Capture episode and its exact frozen Hardware Bundle before rendering
device-reported `qpos`. It does not select an unrelated Simulation Run. Studio
shows device health and proposed/commanded/applied Action, which makes Shadow
commissioning explicit. The image is a kinematic digital-twin projection, not
camera/motion-capture/contact truth, and it cannot change hardware verification,
Calibration, safety, or actuation authority. The command reports an immutable
`hardware-replay` plus the derived `studio-snapshot`.

`twin audit --capture ID --episode ID` verifies that same Capture/Bundle boundary,
then resets the frozen MuJoCo model from every device row, applies the
device-reported `appliedAction`, and predicts exactly one control interval. It
publishes immutable per-transition measured/predicted state, base/joint
residuals, named per-joint RMSE, maximum magnitudes, and worst-transition
selectors. The Audit binds the Hardware State ABI hash; `twin inspect` returns
the same named joints shown by Studio.
It is derived model-fit evidence, not Calibration or hardware verification.
`twin inspect --transition N` is the exact Agent/headless selector.
`studio --twin-audit ID` renders device state and one-step prediction side by
side; a human observation may bind to that exact transition without changing
the Audit or Judge authority.

The generated Studio directory can be opened directly or served by any static file server. Its controls support play/pause, previous/next frame, `0.25×`–`2×` speed, scrubbing, keyboard stepping, and Event seeking. The attention queue ranks measured Run/Capture failures before human hypotheses. “Copy frame context for Agent” includes a directly executable `evidence inspect` argv. Studio may copy or download an observation draft, but it cannot write project state. The command reports both the immutable `simulation-replay` and derived `studio-snapshot` artifacts in JSON mode; renderer source participates in snapshot identity.

`evidence inspect` is the Agent/headless side of the same workspace. Run mode
returns the exact row at or before `--time`, nearby Events, metrics, score, file
hashes, optional comparison and quality deltas. Capture mode first verifies the
immutable Capture, then returns transcript event `--event` with two neighboring
events on each side. Capture episode mode requires `--episode` and `--time`,
verifies the governed episode hash, and returns the row at or before that time
with two neighboring rows, `qpos/qvel`, device health,
proposed/commanded/applied Action, and artifact hashes. Every mode returns a
`contextHash`.

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
the locked verdict. `studio --research-lab ...` opens the Lab as a read-only
Training Cockpit and packages every available Review in the selected scope.
`--session` and `--experiment` progressively narrow that scope; Experiment
requires Session. The Timeline shows legacy iterations as metrics-only and
opens reviewed iterations as synchronized accepted/candidate Run pairs. It
cannot be mixed with explicit `--run` selectors.

`hardware export` freezes one Hardware Target, source Revision, Controller,
optional Policy, selected Driver Package, Observation/Action contracts,
MuJoCo-derived Hardware State ABI, safety envelope, and
`stdio-jsonl-v1` handshake into an immutable bundle. Robot Revision Bundles may
actuate. A Target may explicitly name a Judge-kept Policy Revision, but its
Bundle is derived as `maximumCaptureMode=shadow`; a Plan cannot widen that
authority. New exports require a Driver Package whose protocol, environment,
device identity, and declared capabilities satisfy the Target. They also require
a bounded command lease and maximum expiration overrun supplied by the frozen
Driver.

Bundle v2 writes `state-contract.json`. It names every `qpos` and `qvel`
coordinate, unit, frame, joint index group, quaternion convention, and actuator
transmission. The Driver must declare `state-abi-v1`, normalize its native
encoder order/sign/zero/unit/frame into that contract, and echo the exact
`stateContractHash` during hello. New Captures and Verification Evidence bind
that hash. Legacy Bundles remain readable through an explicitly labelled ABI
derived from their frozen model.

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

`policy requalify` is a narrow metadata-migration operation, not training. It
requires byte-identical old/new MJCF and identical Observation/Action contract
hashes. The old model identity comes from the local content-addressed Assembly
cache when present; after a clean clone it may instead follow an already
published requalification proof bound to the exact source Policy hash. The new
proof records which source was used. Success creates a new immutable Policy and
leaves the source Policy untouched. Any missing proof or executable difference
fails closed and requires restoration of evidence or retraining.

`policy counterfactual` is a causal authority experiment, not training or
promotion. It executes one immutable Policy twice across every locked Benchmark
case with byte-identical weights, normalizer, Assembly, physical plant, Task,
Scenario, and seed. The baseline uses the gate frozen in the Policy
architecture; the candidate uses one typed `authority-profiles/*.authority.json`
residual gate. Both sides publish ordinary immutable Runs, while the
content-addressed Authority Counterfactual records invariants, per-case Run ids,
score and gate deltas, and an `EQUIVALENT`, `IMPROVED`, `DEGRADED`, or `MIXED`
causal assessment. Its `promotionVerdict` is always null: only the locked Judge
may promote a robot or Policy. `studio --authority-counterfactual` opens any
named case on one synchronized A/B clock and copies the exact headless
reproduction command.

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

Training may declare `warmStart` with an immutable parent Policy, a frozen
normalizer, and a `reverse-kl-to-frozen-policy` trust region. The CLI verifies
the parent model, contracts, architecture, normalizer, integrity, and
originating Training Run before invoking Runtime; a Research Lab stages that
lineage into its isolated workspace. Runtime begins from byte-identical parent
weights, collects a fixed set of active parent states from the deterministic
complete-Mission progression, and rolls back both model and optimizer after
any update whose mean reverse KL on that set exceeds `maximumMeanKl`. `train`
reports the parent Policy and maximum accepted KL. Frozen Policy metrics retain
the anchor distribution/count, maximum attempted KL, and accepted/rolled-back
optimizer-step counts. This bound applies only to the declared Mission anchor;
the unchanged locked Judge remains the promotion authority.

For a Program-residual Trainer, Training v3 may set
`deterministicCheckpoint.includeInitialProgramPolicy: true`. Runtime then
freezes step 0 as an executable Policy candidate and proves that its maximum
raw actor mean is exactly zero, so deployed Actions are exactly the frozen
Program prior. Learned checkpoints compete with that baseline only on the
same complete no-reset Mission. `train` reports
`program_equivalent_initial_policy=true` when every learned checkpoint loses
and step 0 is restored. A learned checkpoint must improve at least one
bilateral worst-case end-to-end Mission outcome without regressing completion,
stable recovery, relapse, timeout, or recovery progress; actor intervention or
local target entry alone remains diagnostic. This option rejects warm-start
weights and non-Program action transforms because neither can prove
zero-residual equivalence.

The same Training may add a `programReference` contract:

```json
{
  "scope": "complete-mission-active-states",
  "maximumSamples": 512,
  "coefficient": 0.1,
  "maximumAppliedResidualRms": 0.05
}
```

Runtime collects the physical Observations where the step-0 Program-equivalent
Policy actually receives residual authority in deterministic complete
Missions. These samples remain Training-only and consume no Training budget.
During PPO, the actor is softly pulled toward zero residual on that fixed
physical distribution. After every optimizer step, Runtime measures the
Action-scaled, gate-scaled residual RMS over all retained samples and rolls
back both model and optimizer state when the declared bound is exceeded.
`train` reports `program_reference_maximum_applied_residual_rms`; Policy
evidence preserves sample/case/phase coverage, attempted drift, and
accepted/rolled-back optimizer-step counts. This trust region preserves known
Program behavior but does not promote a Policy—the locked Judge remains the
only release authority.
