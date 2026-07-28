# Embodiment-first quadruped design cycle

Status: completed

## Outcome

Replace the current "articulated brick with legs" assumption with a small set of
explicit quadruped embodiment candidates, reject physically weak concepts using
cheap reproducible probes, and identify one design with a credible nominal and
self-recovery mechanism before returning substantial budget to Controller or
RL optimization.

## Development emphasis

- Mode: `balanced`
- Evidence: the corrected split-torso candidate established left/right
  recovery but lacked a back-support mechanism. A bounded over-centre
  four-foot candidate now preserves the static screen and creates four-foot
  support in every frozen fall. Front still crosses collision/joint gates and
  loses its stand; back loses a real four-foot plant during rise.
- Budget bias: plant-to-rise geometry and readable Controller sequencing as one
  co-design surface. No Training budget until front/back pass the declared
  safety and stable-stand gates.
- Exit condition: at least one candidate demonstrates an executable mechanism
  for nominal support and each required recovery transition without depending
  on substantial RL search.
- Switch-back condition: if candidates with materially different geometry
  reach the same failure while the outcome changes strongly with readable
  Controller logic, change to `balanced` or `behavior-heavy` and record the
  exact evidence.

## Context

Mujica began optimizing behavior before the quadruped itself had received a
complete system-design pass. Waist articulation improved the topology but did
not establish that the feet, body shell, mass distribution, joint workspace,
and actuator authority can generate the contacts needed to self-right. Further
RL work on the same plant is currently lower-information than comparative
design work.

## Scope

In scope:

- explicit embodiment hypotheses tied to the Development Charter;
- compiled candidate Assemblies with honest geometry, mass, joints, actuators,
  sensors, and source lineage;
- locally regenerated standard Design Previews;
- deterministic low-cost checks for workspace, ground contact opportunity,
  clearance, support, and recovery transition feasibility;
- short Program-Controller scenarios that distinguish plant feasibility from
  behavior quality;
- one follow-up Development Review after a candidate is governed through the
  existing development lane.

Out of scope:

- increasing RL budget on the unchanged plant without new discriminating
  evidence;
- choosing a design from appearance alone;
- relaxing locked self-righting or continuous-Mission gates;
- treating a successful isolated pose as a complete recovery capability;
- checking generated images or videos into Git.

## Acceptance

- Each candidate states which physical bottleneck it changes and what result
  would falsify the hypothesis.
- Each candidate compiles and produces an ignored local Design Preview.
- The same authored poses and simple scenarios compare all candidates.
- Feasibility probes report machine-readable evidence rather than visual-only
  conclusions.
- At least one readable Program Controller can exercise the proposed mechanism
  in MuJoCo, or the Plan records that no candidate is feasible and revises the
  design proposition.
- Any return to RL names the fixed Assembly, demonstrated mechanism, bounded
  Training budget, and switch-back plateau signal.

## Work

- [x] Switch the current development emphasis from behavior-heavy exploration
  to design-heavy reassessment using locked plateau and visual evidence.
- [x] Define the first candidate family and falsifiable physical hypotheses.
- [x] Add the smallest executable feasibility probes required to compare it.
- [x] Compile, render, and inspect every candidate locally.
- [x] Exercise short shared scenarios with readable Program Controllers.
- [x] Select or reject candidates through governed evidence.
- [x] Update emphasis and create the next bounded Plan.

## Findings and decisions

- The existing three Work Order lane kinds are sufficient; this Plan changes
  their priority, not their authority.
- Program-reference-constrained RL was valuable negative evidence: it showed
  that preserving known behavior did not create the missing inverted recovery
  transition.
- Design Preview is a hypothesis surface. MuJoCo contacts, state transitions,
  and locked gates must decide feasibility.
- The checked-in `embodiment-first-recovery` Design Study holds four inherited
  rigid/waist Assemblies to one 2,048-sample probe budget and the same authored
  home plus left/right/front/back expectations. Generated JSON, Markdown, HTML,
  and PNG evidence stays under ignored `.mujica/`.
- All four inherited Assemblies fail the first screen because their authored
  home keyframe places only the two front feet inside the 3 cm contact
  tolerance; both rear feet have approximately 6.13 cm surface clearance.
  This is a lineage-wide nominal-state defect that precedes locomotion or
  recovery optimization.
- Static Design Analysis and Runtime now share one kinematic-neighbour
  self-contact predicate. This corrected a second overgeneralization: all four
  resting poses of the inherited candidates contain valid two-foot contact
  opportunities under the same contact rule used at execution. Their static
  rejection is solely the authored two-of-four home-support defect.
- The `nominal-support-correction` Study adds two complete candidates. Both
  mirror the rear sagittal joint axes with the rear geometry and move the hip
  mounts outside the torso collision envelope. Their authored home now places
  all four feet within tolerance, and both pass all four 2,048-sample static
  screens. The articulated candidate adds bounded roll/pitch waist authority.
- A bounded readable Controller search establishes a real lateral recovery
  mechanism for the corrected articulated candidate. `fallen-left` and
  `fallen-right` reach stable standing at 3.60 s, retain 2.42 s stable dwell,
  finish near 0.383 m height and 0.190 rad body tilt, incur zero disallowed
  collision steps, and retain approximately 0.0205 rad joint-limit margin.
- The same Controller does not establish front/back recovery. Front reaches an
  almost upright instantaneous pose (minimum tilt approximately 0.002 rad) but
  cannot plant and rise, finishes at approximately 0.257 m, and exceeds the
  joint limit by approximately 0.0274 rad. Back finishes inverted. The
  first-class Dynamic Design Probe therefore records
  `PARTIAL_DYNAMIC_MECHANISM_OBSERVED` (2/4) and switches emphasis to
  `design-reassessment`; RL remains unauthorized.
- `SUPPORTED_WITHIN_SCREEN` is intentionally weak authority. Sampled kinematic
  opportunity is neither a mathematical reachability proof nor dynamic
  self-righting; a passing future candidate must still exercise the mechanism
  with a short readable Program Controller before behavior-heavy work resumes.
- The over-centre candidate is not selected or promoted, but it changes the
  causal diagnosis. `fallen-back` reaches four-foot support at 1.70 s with
  zero disallowed collision steps and positive joint margin, then retracts
  during rise and returns inverted. `fallen-front` also reaches four-foot
  support after reorientation but records three collision steps and a negative
  joint margin. Contact topology is no longer the missing mechanism; the next
  bounded surface is the safe plant-to-rise transition.
- Dynamic Probe diagnosis is now phase-aware. Terminal failure no longer erases
  transient mechanism evidence, and aggregate routing distinguishes absent
  support (`design-reassessment`) from complete support coverage with a failed
  transition (`balanced`). Training remains unauthorized in both cases.

## Progress log

- 2026-07-27: Declared the first explicit `design-heavy` cycle after
  `articulated-inverted-escape-d47ea392e29fa22d` retained 512 reference states
  within a 0.05 residual RMS bound but left the locked recovery result at 43
  violations.
- 2026-07-27: Bound the cycle to locally regenerated Design Previews; generated
  images and videos remain under ignored `.mujica/design-previews/`.
- 2026-07-28: Added `design analyze` and a first-class Design Study source
  format. The Runtime now emits integrity-checked machine evidence and
  collision-free best-pose renders; the CLI generates a human-readable
  multi-candidate comparison page from the same results.
- 2026-07-28: Ran and visually inspected all four candidate previews and the
  2,048-sample `embodiment-first-recovery` study. Rejected the inherited home
  state for all four candidates and retained the current emphasis as
  `design-heavy`; no additional RL budget is justified until a corrected
  nominal-state candidate is compiled and re-screened.
- 2026-07-28: Corrected rear-axis symmetry and hip clearance in rigid and
  split-torso candidates, unified static/runtime collision semantics, and
  passed the `nominal-support-correction` static Study.
- 2026-07-28: Added the static-gated `design probe` protocol and exercised the
  corrected split-torso candidate in all four frozen falls. Lateral recovery
  passed; front/back failed, so Studio and the Agent handoff now recommend
  `design-reassessment` instead of increasing RL budget.
- 2026-07-28: Added the over-centre four-foot candidate and phase-level Probe
  diagnosis. The candidate created four-foot support in all four frozen falls
  but retained stable standing only laterally, so work moved to `balanced`
  plant/Controller co-design while Training stayed closed.
- 2026-07-28: Closed this demo-family cycle after the Prior Art Study replaced
  the morphology proposition. Follow-on work moved to the source-grounded
  `solo12-informed-baseline` Plan; the old family remains regression evidence,
  not the robot-design north star.
