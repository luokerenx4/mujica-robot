# Mujica CLI

```text
mujica help [--json]
mujica validate <project> [--json]
mujica inspect <project> [--json]
mujica component list <project> [--json]
mujica component inspect <project> --component ID [--json]
mujica controller list <project> [--json]
mujica controller inspect <project> --controller ID [--json]
mujica assembly inspect|compile <project> --assembly ID [--json]
mujica assembly compare <project> --from ID --to ID [--json]
mujica simulate <project> --assembly ID --controller ID --task ID --scenario ID [--seed N]
mujica studio <project> [--run ID] [--compare-run ID] [--json]
mujica hardware export <project> --target ID [--json]
mujica hardware verify <project> --bundle ID --evidence PATH [--json]
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
mujica research run <project> --lab ID --agent-command CMD [--iterations N] [--json]
mujica research status <project> --lab ID [--json]
mujica research <project> --research ID [--iterations N] [--agent-command CMD] [--json]
mujica revisions <project> [--json]
mujica revision inspect <project> --revision ID [--json]
```

JSON mode emits one schema-versioned value on stdout. Validation/runtime failures use exit code 1; invalid CLI usage uses exit code 2. Artifact-producing commands identify each path and whether it is immutable.

`controller list` exposes each Program or Policy Controller and the Assemblies it can legally execute against. `controller inspect` includes the complete Program Controller interface or frozen Policy pointer plus structured incompatibility reasons. Program Controller Observation requirements are a named subset; produced Action channels must exactly match the compiled Assembly in order, size, and bounds. Incompatible pairs fail before Python Runtime invocation.

`diagnose` evaluates the requested robot and the locked Benchmark baseline without publishing artifacts. It reports every enforced gate as a signed margin, ranks failing cases by normalized violation severity, preserves measured findings as `kind: evidence`, and labels possible intervention surfaces as `kind: hypothesis`. Its next action persists the worst case through `simulate` so events and trajectory can be inspected without confusing a heuristic with proof.

`studio` creates or reuses an immutable MuJoCo replay under `<project>/.mujica/replays/`, then copies it into a content-addressed offline projection under `<project>/.mujica/studio/`. It never edits robot source or immutable artifacts and never evaluates a Candidate. `--run` selects one completed Simulation Run; without it, the deterministic last run id is selected. The Runtime loads the Run's frozen `model.xml`, reconstructs every recorded `qpos`, and renders PNG frames. The browser only synchronizes those frames with trajectory, Events, health, attitude, command, measured motion, contact force, and Action telemetry.

The generated Studio directory can be opened directly or served by any static file server. Its controls support play/pause, previous/next frame, `0.25×`–`2×` speed, scrubbing, keyboard stepping, and Event seeking. “Copy frame context for Agent” places structured Run identity and exact frame evidence on the clipboard. The command reports both the immutable `simulation-replay` and derived `studio-snapshot` artifacts in JSON mode.

`hardware export` freezes one Hardware Target, kept Robot Revision, Controller, Observation/Action contracts, safety envelope, and `stdio-jsonl-v1` handshake into an immutable bundle. `hardware verify` validates separately collected driver Evidence and publishes an immutable verification. A `dry-run` can only become `PROTOCOL-VERIFIED`; only passing `hil` or `real` Evidence with a required device serial can become `HARDWARE-VERIFIED`.

`policy requalify` is a narrow metadata-migration operation, not training. It requires the old content-addressed Assembly cache, byte-identical old/new MJCF, and identical Observation/Action contract hashes. Success creates a new immutable Policy with an explicit `requalification.json` proof and leaves the source Policy untouched. Any executable difference fails closed and requires training.

`research list|inspect|run|status` is the V2 source-research interface. A Lab names one human `program.md`, a controller/policy/development execution lane, exact files or recursive `/**` directories the Agent owns, locked primary and regression Benchmarks, fixed budgets, and a promotion target. `run` executes the Agent command in a disposable project copy. The command receives JSON on stdin, edits files in its working directory, and returns only `strategy`, `hypothesis`, and `expectedEffect` metadata. Mujica derives the authoritative diff, rejects every undeclared write, then runs the fixed Judge.

Every V2 attempt creates an immutable Experiment containing the proposal, patch, before/after hashes, execution references, evaluations, and verdict. Policy attempts retain their immutable Training Run and frozen Policy even on REVERT. KEEP rechecks source hashes before atomically copying the candidate source and publishing the appropriate Revision. `status` reads completed Session ledgers without starting work.

The legacy `research <project> --research ID` command remains intentionally mutating and available during migration. Without `--agent-command`, it uses the deterministic bounded numeric proposer. An external command returns one bounded-value proposal; Core runs the complete locked Benchmark and advances the controller plus Revision lineage only for KEEP.

`train-research` applies the same protocol to one Training JSON definition. Every candidate creates or reuses an immutable Training Run and Policy; only a frozen-policy KEEP advances the Training file, promoted policy Controller, and Policy Revision lineage. `policy-revisions` and `policy-revision inspect` expose that lineage without conflating it with whole-robot Revisions.

Training definitions may optionally declare non-negative `qualityReward` weights for `jointAcceleration`, `bodyAngularAcceleration`, `actionSlew`, `actuatorSaturation`, `footSlip`, and `footImpact`. Omission is exactly neutral. These normalized terms shape training only; immutable Training evidence records base reward, total quality penalty, each weighted term, and fixed reference magnitudes. Frozen Benchmark scores and KEEP/REVERT decisions never consume the shaped training reward.
