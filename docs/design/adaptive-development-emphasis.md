# Adaptive Development Emphasis

## Decision

Mujica treats robot embodiment design, Program Controller development, and
Policy learning as one closed development loop. They are not equal-cost
operations and they do not occur in a fixed sequence. The Harness therefore
tracks a current development emphasis rather than declaring a permanent project
phase.

An emphasis controls where a human or Coding Agent should spend the next
bounded experiment budget. It does not alter Benchmark locks, Research Lab
source closures, Judge authority, or promotion rules.

## Emphasis modes

| Mode | Default budget | Evidence sought |
| --- | --- | --- |
| `design-heavy` | Embodiment and cheap feasibility probes | Whether geometry, joints, actuation, sensing, contacts, and task transitions can support the proposition |
| `balanced` | Small discriminating design and behavior experiments | Whether the current blocker belongs to the plant, Controller, Policy, or their interface |
| `behavior-heavy` | Controller and bounded RL work on a fixed plant | Whether an available physical mechanism can be made reliable across the locked scenario distribution |
| `design-reassessment` | New embodiment hypotheses; minimal additional Training | Whether a behavior plateau is caused by an absent or badly conditioned physical mechanism |

The modes are reversible. `design-reassessment` normally returns to
`design-heavy` for candidate generation, then to `balanced` for comparative
probes. It is not a failure state.

## Default project trajectory

At project creation, the default is `design-heavy`:

1. bind the proposition, operational domain, capability stages, and north star
   in the Development Charter;
2. compile candidate Assemblies and inspect locally regenerated Design
   Previews;
3. run inexpensive deterministic checks and short simple scenarios;
4. use a readable Program Controller to prove task plumbing and a plausible
   physical mechanism;
5. compare candidate embodiments under the same locked inputs;
6. increase Controller or RL budget only after the plant has a credible route
   through the required state transitions.

This is not permission to accept a robot from appearance. A preview produces a
hypothesis. Executable design constraints, MuJoCo state, contacts, events,
metrics, and locked scenario outcomes supply evidence.

## Switching toward behavior

Design confidence is provisional, not a one-time sign-off. Moving to
`balanced` or `behavior-heavy` requires:

- the compiled design envelope has no known blocking violation;
- required joint workspace, contact opportunities, actuator authority,
  observations, and clearances exist in the model;
- at least one simple Controller or bounded probe demonstrates the intended
  mechanism, even if it is not robust;
- remaining failures vary meaningfully with Controller or Policy behavior;
- the Plan names the fixed Assembly and the evidence that justifies holding it
  fixed.

RL is then an implementation method, not the definition of development. A
frozen Policy is evaluated by the same locked Judge as a Program Controller.

## Switching back toward design

The Agent enters `design-reassessment` when a bounded behavior batch stops
being informative. Strong signals include:

- repeated REVERT outcomes retain the same worst locked cases and physical
  failure mode;
- more optimizer steps improve Training reward, action smoothness, or
  reference-policy agreement without changing the required state transition;
- distinct safe Controllers or Policies saturate at the same contact,
  workspace, torque, sensing, or stability boundary;
- recovery depends on a contact or reachable pose the plant cannot create;
- failures are insensitive to algorithm choice but sensitive to morphology or
  plant parameters.

No single experiment count is universal. A Plan must bound its behavior batch
in advance and name the plateau signal. Once that signal is met, spending more
Training budget requires new evidence, not optimism.

## Planning contract

Every new or materially updated capability Plan records:

- `Mode`: one of the four emphasis modes;
- `Evidence`: why this mode is appropriate now;
- `Budget bias`: which lane receives most work and which probes remain allowed;
- `Exit condition`: evidence needed to change emphasis;
- `Switch-back condition`: evidence that invalidates the current assumption.

Development Reviews remain authoritative measurements of an exact subject.
Development Work Orders remain deterministic lists of eligible governed lanes.
The Plan chooses emphasis among eligible lanes and explains why. It cannot
invent an ineligible lane, widen editable source, or override a Judge.

## Human–Agent loop

Humans contribute visual and operational judgement: implausible proportions,
awkward contacts, dangerous motion, or a hypothesis that two failures look
physically equivalent. Agents bind that observation to exact Assembly, Run,
frame, and locked case identities, then select a discriminating experiment.

Studio and local Design Previews should expose the current emphasis and its
evidence in future product work. Until then, the Plan and CLI artifacts are the
canonical coordination surface.
