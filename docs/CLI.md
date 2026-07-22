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
mujica studio <project> [--run ID] [--json]
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
mujica research <project> --research ID [--iterations N] [--agent-command CMD] [--json]
mujica revisions <project> [--json]
mujica revision inspect <project> --revision ID [--json]
```

JSON mode emits one schema-versioned value on stdout. Validation/runtime failures use exit code 1; invalid CLI usage uses exit code 2. Artifact-producing commands identify each path and whether it is immutable.

`controller list` exposes each Program or Policy Controller and the Assemblies it can legally execute against. `controller inspect` includes the complete Program Controller interface or frozen Policy pointer plus structured incompatibility reasons. Program Controller Observation requirements are a named subset; produced Action channels must exactly match the compiled Assembly in order, size, and bounds. Incompatible pairs fail before Python Runtime invocation.

`diagnose` evaluates the requested robot and the locked Benchmark baseline without publishing artifacts. It reports every enforced gate as a signed margin, ranks failing cases by normalized violation severity, preserves measured findings as `kind: evidence`, and labels possible intervention surfaces as `kind: hypothesis`. Its next action persists the worst case through `simulate` so events and trajectory can be inspected without confusing a heuristic with proof.

`studio` creates a content-addressed projection under `<project>/.mujica/studio/`. It never edits robot source or immutable artifacts and never evaluates a Candidate. `--run` selects one completed Simulation Run for event and trajectory replay; without it, the deterministic last run id is selected. The output `index.html` is self-contained and can be opened offline.

`hardware export` freezes one Hardware Target, kept Robot Revision, Controller, Observation/Action contracts, safety envelope, and `stdio-jsonl-v1` handshake into an immutable bundle. `hardware verify` validates separately collected driver Evidence and publishes an immutable verification. A `dry-run` can only become `PROTOCOL-VERIFIED`; only passing `hil` or `real` Evidence with a required device serial can become `HARDWARE-VERIFIED`.

`policy requalify` is a narrow metadata-migration operation, not training. It requires the old content-addressed Assembly cache, byte-identical old/new MJCF, and identical Observation/Action contract hashes. Success creates a new immutable Policy with an explicit `requalification.json` proof and leaves the source Policy untouched. Any executable difference fails closed and requires training.

`research` is intentionally mutating. Without `--agent-command`, it uses the deterministic bounded proposer. An external command receives one JSON object on stdin and must return one proposal on stdout. Core validates the proposal, runs the complete locked Benchmark, records an immutable experiment, and advances the controller plus Revision lineage only for KEEP.

`train-research` applies the same protocol to one Training JSON definition. Every candidate creates or reuses an immutable Training Run and Policy; only a frozen-policy KEEP advances the Training file, promoted policy Controller, and Policy Revision lineage. `policy-revisions` and `policy-revision inspect` expose that lineage without conflating it with whole-robot Revisions.
