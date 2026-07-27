# Embodiment-first quadruped design cycle

Status: active

## Outcome

Replace the current "articulated brick with legs" assumption with a small set of
explicit quadruped embodiment candidates, reject physically weak concepts using
cheap reproducible probes, and identify one design with a credible nominal and
self-recovery mechanism before returning substantial budget to Controller or
RL optimization.

## Development emphasis

- Mode: `design-heavy`
- Evidence: the current local Design Preview exposes a long rectangular body
  and limited recovery contact geometry; the locked inverted-recovery Judge
  remains at 43 violations after bounded residual-policy work, including a
  program-reference trust region that preserved the reference behavior.
- Budget bias: morphology, joint topology, contact geometry, actuator/sensor
  adequacy, standard Design Previews, and cheap Program-Controller probes.
  Small behavior experiments are allowed only when they distinguish competing
  embodiment hypotheses.
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
- [ ] Define the first candidate family and falsifiable physical hypotheses.
- [ ] Add the smallest executable feasibility probes required to compare it.
- [ ] Compile, render, and inspect every candidate locally.
- [ ] Exercise short shared scenarios with readable Program Controllers.
- [ ] Select or reject candidates through governed evidence.
- [ ] Update emphasis and create the next bounded Plan.

## Findings and decisions

- The existing three Work Order lane kinds are sufficient; this Plan changes
  their priority, not their authority.
- Program-reference-constrained RL was valuable negative evidence: it showed
  that preserving known behavior did not create the missing inverted recovery
  transition.
- Design Preview is a hypothesis surface. MuJoCo contacts, state transitions,
  and locked gates must decide feasibility.

## Progress log

- 2026-07-27: Declared the first explicit `design-heavy` cycle after
  `articulated-inverted-escape-d47ea392e29fa22d` retained 512 reference states
  within a 0.05 residual RMS bound but left the locked recovery result at 43
  violations.
- 2026-07-27: Bound the cycle to locally regenerated Design Previews; generated
  images and videos remain under ignored `.mujica/design-previews/`.
