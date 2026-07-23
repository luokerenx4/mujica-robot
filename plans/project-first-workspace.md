# Project-first Workspace

Status: completed

## Outcome

A human or Coding Agent can create a governed six-legged robot project inside a
Mujica Workspace, understand its proposition and scenario portfolio before
optimization begins, run it through the same CLI/Runtime as the quadruped, and
move between both projects from one Workspace Studio.

## Context

Mujica already resolves a project directory directly or through
`mujica-workspace.json`, but project creation is manual and Studio packages only
one selected project. The quadruped project also began without a durable mission
and scenario contract. Runtime contact evidence names four feet directly, so a
second legged morphology exposes a real boundary rather than merely adding a
second folder.

## Scope

- Add an explicit Development Charter to every project.
- Add headless project list, inspect, and create operations.
- Ship one executable `hexapod` starter template; do not clone the quadruped
  research history or manufacture empty framework packages.
- Add a read-only Workspace Studio that discovers projects, links their
  individual Studio views, and prepares the exact project-create CLI request.
- Carry project morphology contact-point metadata through compiled
  Assembly into Runtime motion-quality evidence.
- Preserve shape-specific controller algorithms as explicitly shape-specific;
  this slice does not pretend that one gait prior fits every leg count.

## Authority

Robot source is still created or changed through the public CLI and files.
Workspace Studio remains a static, read-only projection and never receives
filesystem write authority. Its New Project panel produces the same
`mujica project create` command a Coding Agent invokes. Completed Runs and
Policies remain immutable.

## Acceptance

- [x] `mujica project list <workspace>` reports every safe project and its
      Charter summary.
- [x] `mujica project create <workspace> --id hexapod --name ... --template
      hexapod` atomically creates a new, schema-valid project and refuses
      overwrite, unsafe destinations, and duplicate IDs.
- [x] Project validation fails when the Charter is missing, belongs to another
      project, or names a Task/Scenario pair absent from its Benchmark.
- [x] `mujica studio <workspace>` produces one offline Workspace home with
      project cards, Charter/capability context, project links, and a copyable
      create command.
- [x] Runtime foot position/force evidence follows compiled morphology metadata
      and works for both four and six contact points.
- [x] The checked-in hexapod project compiles, simulates, evaluates, and renders
      an authoritative MuJoCo replay in Studio.
- [x] Existing quadruped tests and project validation remain green.

## Work

1. Freeze project lifecycle, Charter, Workspace Studio, and morphology
   boundaries in the design document.
2. Add Core schemas, loaders, reference validation, and safe Workspace
   discovery.
3. Add CLI project lifecycle commands and an executable hexapod template.
4. Add Workspace Studio packaging and project navigation.
5. Replace Runtime four-foot discovery with compiled contact-point metadata.
6. Create, run, evaluate, render, and inspect the hexapod acceptance project.
7. Run the full suite, refresh governed identities affected by Harness source,
   and record immutable evidence.

## Findings and decisions

- A Workspace owns only discovery and UI projection. Robot assets, Charters,
  Runs, Policies, and research history stay inside one project.
- Browser-side filesystem mutation would add a privileged local service and
  break Studio's read-only evidence boundary. The conservative first workflow
  is a form that emits the exact tested CLI command.
- Contact evidence is morphology metadata, not a convention inferred from
  `fl/fr/rl/rr` names. Shape-specific gait priors may remain explicit because
  their names and contracts already declare that specialization.
- Morphology is project-level diagnostic metadata rather than part of Robot
  package or executable Assembly identity. This lets Runtime discover six feet
  without forcing a byte-identical Policy through needless requalification.

## Progress log

- 2026-07-24: Audited Workspace routing, Studio packaging, and Runtime. Core
  already selects independent projects; missing surfaces are project
  bootstrap, Workspace-level Studio, Development Charter, and configurable
  contact-point metadata.
- 2026-07-24: Implemented the Workspace lifecycle, executable Hexapod template,
  Charter validation, Workspace Studio, and morphology-driven Runtime. The
  final Hexapod Run `run-d7305300508ff5c0` survived 4 seconds, advanced
  0.188 m, achieved signed progress 0.235, and scored 14.613 with six-foot
  contact evidence.
- 2026-07-24: Refreshed all 14 Benchmark locks, exported current Harness
  Bundles `hardware-8485d33327abeae8` and
  `hardware-76c139429c785eed`, published protocol/shadow verifications, passed
  72 TypeScript and 43 Python tests, and browser-verified project switching,
  the 325-frame quadruped Research Timeline, and the 200-frame Hexapod replay.
