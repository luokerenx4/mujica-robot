# Mujica CLI

```text
mujica help [--json]
mujica validate <project> [--json]
mujica inspect <project> [--json]
mujica component list <project> [--json]
mujica component inspect <project> --component ID [--json]
mujica assembly inspect|compile <project> --assembly ID [--json]
mujica assembly compare <project> --from ID --to ID [--json]
mujica simulate <project> --assembly ID --controller ID --task ID --scenario ID [--seed N]
mujica train <project> --training ID [--seed N]
mujica policies <project> [--json]
mujica policy inspect <project> --policy ID [--json]
mujica benchmark lock <project> --benchmark ID [--json]
mujica evaluate <project> --assembly ID --controller ID --benchmark ID [--json]
mujica candidate <project> --candidate ID [--apply] [--json]
mujica revisions <project> [--json]
mujica revision inspect <project> --revision ID [--json]
```

JSON mode emits one schema-versioned value on stdout. Validation/runtime failures use exit code 1; invalid CLI usage uses exit code 2. Artifact-producing commands identify each path and whether it is immutable.

