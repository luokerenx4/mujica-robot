# Project inception prior-art study

Status: completed
Updated: 2026-07-28

## Outcome

Before Mujica commits a new robot project to iterative embodiment or behavior
development, a Coding Agent produces a source- and license-verified Prior Art
Study, inspects plausible open architectures, and makes an explicit
adapt/fork/original-design decision. The current quadruped uses that process to
replace its Harness-demo embodiment with a credible design starting point.

## Context

The first quadruped successfully exercised the Harness from compilation through
Studio, but iteration treated that test fixture as though it were a considered
robot architecture. Repeated self-righting work exposed that the project had
never established what the robot should physically be, nor searched existing
open hardware and simulation models that already encode years of design work.

## Scope

- Search primary repository, project, paper, and license sources for reusable
  quadruped architectures.
- Inspect the most relevant repositories locally without vendoring them into
  Mujica.
- Record source identity, license evidence, available hardware/simulation
  assets, task fit, customization surface, and important reuse risks.
- Decide whether the next quadruped should adapt an upstream architecture,
  combine separately licensed references, or justify an original design.
- Add the validated project-inception rule to `AGENTS.md` and a durable design
  document.
- Do not import third-party code or assets, create a GitHub fork, or claim
  license compatibility until the selected source boundary and attribution
  obligations are explicitly reviewed.

## Development emphasis

- Mode: `design-heavy`.
- Evidence: the current self-righting candidates lack a credible external
  moment path and the project began without an architecture study.
- Budget bias: spend no new Controller or Training budget; prefer source review,
  license verification, mechanical architecture comparison, and human-visible
  design decisions.
- Exit condition: the checked-in study identifies a preferred upstream
  reference strategy and a bounded next design brief with traceable evidence.
- Switch-back condition: if no candidate has verifiable reuse rights or matches
  the mission envelope, explicitly choose original design and preserve the
  rejected-source evidence rather than silently copying fragments.

## Acceptance

- At least four materially different quadruped references are checked against
  their primary repositories and license files.
- At least two high-value repositories are shallow-cloned outside the workspace
  and inspected for actual CAD/model/control asset boundaries.
- The study distinguishes open software, open simulation assets, and open
  hardware; one does not imply the others.
- The quadruped receives a checked-in, machine-readable source ledger and a
  human-readable recommendation.
- `AGENTS.md` requires prior-art research before a new robot's first capability
  Plan or substantial design iteration, with a small-project escape hatch that
  must be written down.
- The durable design document defines when an Agent may fork, vendor, adapt, or
  use a project as reference only.
- Repository tests and documentation checks pass.
- The project manifest declares real research or demo-only intent, and the CLI
  enforces that boundary before autonomous development work is generated.

## Work

1. Inventory the current project-start path and freeze the study contract.
2. Search and verify candidate source and license evidence.
3. Inspect high-value candidate repositories locally.
4. Publish the quadruped Prior Art Study and architecture decision.
5. Update Agent and durable Harness rules from what the real study exposed.
6. Verify, commit, and push.

## Findings and decisions

- Six references were checked at exact upstream commits. ODRI Solo12 is the
  strongest physical starting point because its open 12-DoF mechanics,
  actuator/electronics build evidence, calibration material, and separately
  licensed URDF/mesh repository form one traceable architecture stack.
- The Unitree Go2 model in MuJoCo Menagerie is licensed and useful at the model
  directory boundary, but it does not establish open hardware. It remains a
  simulation-quality reference.
- Stanford Doggo contributes quasi-direct-drive and dynamic powertrain lessons,
  but its planar 2-DoF legs do not fit the omnidirectional mission. Pupper v1 is
  an end-of-life educational Controller reference. mjbots is a strong
  whole-system integration reference, but its “most files” wording requires
  path-level license review before reuse.
- The selected route is `adapt`, not an immediate fork: implement a clean,
  parameterized, Solo12-informed Mujica Assembly. Copy no upstream asset until
  path-level provenance and attribution are recorded.
- The existing quadruped remains a `demo-fixture` and regression comparator. It
  is no longer the morphology north star, and RL remains paused until the new
  design passes static feasibility and human visual review.
- The Solo12-informed project now passes a typed Stage 0 gate with six source
  ledgers and six exact repository inspections. Newly created hexapods are
  explicitly demo-only and cannot receive a Development Work Order until they
  complete the same gate.

## Progress log

- 2026-07-28: Started after human review identified that the existing
  quadruped's form had never been treated as a first-class design decision.
- 2026-07-28: Shallow-cloned and inspected ODRI hardware, ODRI Solo properties,
  MuJoCo Menagerie Go2, mjbots quad, Stanford Doggo, and Stanford Pupper outside
  the workspace; recorded commits and license boundaries.
- 2026-07-28: Published the machine-readable source ledger and human
  recommendation, and moved the resulting Stage 0 rules into `AGENTS.md` and
  `docs/design/project-inception-research.md`.
- 2026-07-28: Verified JSON syntax and repository whitespace checks; the
  executable-gate follow-up now passes 98 TypeScript and 80 Python/MuJoCo
  tests.
- 2026-07-28: Follow-up made the research boundary executable in
  `mujica.json`, Core validation, project inspection, Workspace listing, and
  Development Work Order generation.
