# Mujica contributor guide

Mujica is an AI-native robot development harness. Domain correctness, reproducible evidence, and a complete executable loop take priority over compatibility while the project is pre-alpha.

## Product invariants

- A robot is a folder. A workspace discovers projects but owns no robot assets.
- Assemblies are hardware programs; components are self-described packages.
- Robot development includes embodiment design, Controller development, and Policy learning. Mujica does not assume that the robot is already designed when optimization begins.
- Robot source compiles before it executes. Raw assembly JSON never runs directly.
- Controllers and trainers are programs. Tasks are tests. Objectives are benchmarks.
- Program Controllers declare their required Observation subset and complete produced Action contract; incompatible Assembly pairs fail before Runtime invocation.
- Training and evaluation are separate operations. Evaluation consumes a frozen Policy Artifact.
- Events are the debugging protocol. Completed runs and policies are immutable artifacts.
- Capability gates outrank aggregate score. Research preserves every passing gate, then compares violation count, normalized violation severity, and finally score.
- A Coding Agent edits files and invokes the same CLI as a human; it does not manipulate a 3D scene as source state.
- A kept Development Candidate creates a new Robot Revision with explicit lineage.

## Project inception research

A real robot project starts with a Prior Art Study, before its first capability
Plan or substantial morphology iteration. Search primary repositories, project
documentation, and papers for existing robots that already address the mission.
Inspect promising repositories with shallow clones outside the workspace and
record the upstream URL and exact commit.

The study must say plainly what is actually open. Verify software, firmware,
electronics, CAD, meshes, simulation models, trained weights, and documentation
as separate asset layers; a public repository or licensed MJCF does not prove
that the hardware is open. Read model-directory and submodule licenses instead
of assuming the root license covers them. Do not fork, vendor, or copy an asset
until its source boundary, attribution, and redistribution obligations have
been recorded.

End the study with one explicit route: adapt a licensed upstream architecture,
fork a selected source while preserving its history, combine separately
licensed references behind clear boundaries, or design from scratch with a
reason the available work does not fit. A human reviews the candidate forms
before one becomes the design baseline. Generated previews and research images
remain local; third-party source assets enter Git only as an intentional,
licensed dependency with provenance.

An explicitly labelled `demo-fixture` may skip the full comparison when its
only purpose is exercising the Harness. It cannot become a robot's north-star
baseline or receive substantial Controller/RL optimization without completing
the study. If an existing project reaches repeated structural failures without
one, stop behavior spending and perform the study retroactively.

## Adaptive development emphasis

Robot development is an evidence-driven loop, not a design-then-RL waterfall and
not an RL-first optimization problem. Design, Controller, and Policy lanes may
all remain available, but the Agent must deliberately choose where the next
bounded development budget goes.

Every new or materially updated capability Plan declares a `Development
emphasis`:

- `design-heavy`: iterate morphology, geometry, joints, actuators, sensors,
  Assembly composition, and task feasibility; use cheap deterministic probes
  and simple Controllers before substantial Training.
- `balanced`: co-design the plant and behavior when both remain plausible
  bottlenecks; prefer experiments that distinguish them.
- `behavior-heavy`: keep the compiled plant fixed while Controller/RL work has
  a credible path and locked evidence shows behavior—not embodiment—is the
  limiting surface.
- `design-reassessment`: stop increasing Controller or Training budget and
  revisit embodiment assumptions after a behavior plateau or repeated
  physically equivalent failures.

At project start, default to `design-heavy`. Before allocating substantial RL
budget, inspect the compiled Design Preview, validate the design envelope, run
low-cost scenarios with a readable Program Controller, and establish that the
required contacts, reach, actuation, sensing, and state transitions are
physically available. These probes are feasibility evidence, not capability
claims.

When two or more embodiment candidates are plausible, encode the family as a
checked-in Design Study: name one baseline, give every candidate a falsifiable
physical hypothesis, hold the sampled probe budget and required poses constant,
and inspect both the machine-readable result and locally generated comparison
page. Do not commit the generated HTML or image assets. A passing static screen
only authorizes the next bounded dynamic probe; it does not authorize RL or
accept the design.

Static Design Analysis and dynamic Runtime execution must use the same
disallowed-self-contact predicate. A Design Study may pass a pose only from its
authoritative collision-free selection with a `CONTACT_OPPORTUNITY` outcome;
the raw highest-contact sample is diagnostic data and can never satisfy a gate.
A checked-in dynamic probe may run only after its exact candidate passes the
current static Study. Partial dynamic success remains scenario-level evidence,
not an aggregate capability claim. The Probe must preserve phase-level
mechanism witnesses: closest-to-upright state, maximum supporting feet, final
state, collision steps, and joint-limit margin. Route a candidate back to
`design-reassessment` when a required Scenario never creates the declared
contact mechanism. Route to `balanced` co-design when every Scenario creates
four-foot support but a readable transition loses that support or crosses a
safety boundary. Neither route authorizes Training; only a passing declared
dynamic gate may justify a separately bounded Training decision.

Switch emphasis from design toward behavior only when no known design-envelope
failure or physical impossibility blocks the current capability and simple
execution demonstrates a viable mechanism. Switch back toward design when any
of the following is observed:

- multiple bounded Controller/RL attempts REVERT on the same locked blocker;
- more Training changes reward or smoothness without changing the failing
  physical outcome;
- failures persist across meaningfully different algorithms, seeds, or safe
  action budgets;
- required contacts, joint workspace, torque, sensing, clearance, stability,
  or recovery transitions are absent from the compiled plant;
- visual inspection and Runtime evidence agree on a structural hypothesis.

A screenshot alone never proves a design defect, and a Training curve never
proves a capable robot. Use the cheapest discriminating experiment, record the
switch reason and exit condition in the Plan, and let locked Judges retain
promotion authority. A Development Work Order lists eligible lanes; it does not
require the Agent to spend equal budget on them or to continue an exhausted RL
lane.

Capability acceptance is Assembly-qualified, never project-global. Every
`accepted` Charter stage names the Assembly, Controller, Benchmark, and optional
Revision that earned the claim. A newly compiled or materially changed Assembly
starts unqualified even if its interface is compatible and another project
variant has passing evidence.

When a Controller is intentionally introduced with a plant-specific first
probe, declare its `smokeTest`. Agent discovery and Studio actions use that
route instead of combining the Controller with unrelated project defaults.
Absolute Task thresholds such as base height are plant assumptions; do not
reuse them across materially different geometries without an applicability
check or a derived design fact.

Compact joint packages often contain intentional geometry overlap. Represent
legal mounting overlap with explicit MJCF contact exclusions and keep the
visual/collision hypothesis in design provenance. Never tune a Controller or
start Training against a large initial constraint impulse before inspecting the
named contact pair and deciding whether it is a real physical collision.

Standing, disturbance recovery, and self-righting are different evidence
semantics even when they share one stability target. Runtime and Studio must
name which one is being evaluated. A robot that never left the stable envelope
earns standing dwell without claiming self-righting; a push recovery must not be
presented as a fallen-pose recovery.

For a disturbance capability, final drift is not a substitute for transient
containment. Preserve maximum displacement from the Episode's pre-disturbance
base pose alongside final displacement, tilt, recovery time, contact, and
actuator evidence. A Controller that returns to the origin after an excessive
excursion has not passed a bounded-excursion gate.

## Change loop

1. Read `PLANS.md` and the active plan for non-trivial work.
2. Confirm or update the Plan's `Development emphasis`, evidence, exit
   condition, and switch-back condition before choosing a lane.
3. Update the relevant design document with any changed invariant.
4. Implement source, project fixtures, and public CLI changes together.
5. Exercise `mujica validate`, `mujica assembly compile`, the local Design
   Preview when embodiment changes, and the affected Runtime loop.
6. Run `bun run test`.
7. Never rewrite a completed run or Policy Artifact. Write into a temporary directory and publish atomically.

Do not add placeholder packages. A package boundary must own a concrete lifecycle: TypeScript Core owns schemas/compilation/governance, CLI owns the public protocol, and Python Runtime owns MuJoCo execution and training.
