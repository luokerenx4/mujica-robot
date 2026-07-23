# Project-first Workspace

## Project boundary

A Mujica project is the complete source and evidence boundary for one robot
development proposition. It owns its Robot and Component packages, Assemblies,
Controllers, Tasks, Scenarios, Objectives, Benchmarks, Research Labs, Runs,
Policies, and hardware evidence.

A Workspace is only a safe index over sibling project directories. It owns no
robot assets and supplies no inherited Controller, Component, Policy, or
Benchmark. Selecting another project therefore cannot silently change the
source or evidence behind the current robot.

## Development Charter

Every project points from `mujica.json` to one
`development-charter.json`. The Charter is executable governance rather than
introductory prose. It fixes:

- the proposition and intended stakeholders;
- the operational design domain and explicit exclusions;
- the robot morphology class and limb count;
- ordered capability stages;
- the Task, Scenario, and Benchmark witness for each stage;
- human-readable exit criteria and non-goals.

Core validates that the Charter belongs to the project and that each declared
Task/Scenario pair is an actual case in the named Benchmark. A Research program
may narrow work within this portfolio but cannot make an unrelated test look
like project success.

## Project creation

`mujica project create` is the canonical creation protocol for both humans and
Coding Agents. Creation is atomic, confined to the Workspace project directory,
refuses an existing destination, and copies a complete executable template.
Template substitution is limited to the project ID and display name.

The initial template registry contains one concrete `hexapod` lifecycle. New
templates are added only when they contain an executable Robot, Assembly,
Controller, Task, Scenario, Objective, Benchmark, and Charter. Mujica does not
ship invalid “blank” projects or empty abstraction packages.

## Workspace Studio

`mujica studio <workspace>` packages a deterministic, offline Workspace home.
It discovers safe child projects, verifies their manifests and Charters, and
embeds one read-only project Studio for each project. Users can move between
projects without conflating their artifacts.

Workspace Studio does not run an ambient write-capable web service. Its New
Project panel validates a prospective kebab-case ID in the browser and produces
the exact `mujica project create` command. Running that command is the explicit
mutation boundary; regenerating Workspace Studio discovers the new project.
Each explicit project-level `mujica studio` invocation updates a derived
`current.json` pointer, so the Workspace embeds the view the human or Agent most
recently selected instead of guessing from content-addressed IDs.

## Morphology and Runtime

The project-level `morphology.json` declares a morphology class, base body,
limb count, and named contact points. Each contact point binds an end-effector
site and optional contact sensor in MJCF. The compiler carries this diagnostic
metadata into the compiled Assembly while keeping it outside the executable
Assembly identity: adding better observability must not invalidate compatible
Policies. Runtime uses only this compiled list when collecting foot position,
force, slip, and impact evidence.

This makes motion-quality evidence independent of quadruped naming. It does not
make every Controller morphology-independent: algorithms such as
`spatial-gait-residual` remain intentionally specialized and must declare an
interface compatible with the selected Assembly. A hexapod supplies its own
readable gait Controller and can later develop its own ML prior under the same
Research/Judge protocol.
