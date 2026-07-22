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
  tasks/<id>.task.json
  scenarios/<id>.scenario.json
  objectives/<id>.objective.json
  benchmarks/<id>.benchmark.json + <id>.lock.json
  candidates/<id>/candidate.json
  research/<id>.research.json
  AUTORESEARCH.md
  research-runs/<research-id>/results.tsv + <immutable-experiment>/...
  policies/<immutable-id>/...
  revisions/<immutable-id>/manifest.json
  runs/<immutable-id>/...
  training-runs/<immutable-id>/...
```

IDs use lowercase letters, digits, and hyphens and must match their directory or filename. Relative paths are confined beneath the project or package that owns them. Unknown JSON keys fail validation so typos cannot silently change a robot.

A Research definition names one locked Benchmark, one Assembly, one program Controller, one Markdown instruction program, and one exact controller JSON file. V1 editable parameters are finite numeric `/config/<key>` values with explicit bounds, step size, and search order. Benchmark, task, scenario, objective, assembly, controller source, and runtime files are never delegated to the proposer.

`mujica-workspace.json` contains only a name, one projects directory, and an optional default project. Workspaces never provide shared components or policies.
