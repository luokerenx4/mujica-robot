# Locomotion and recovery behavior supervision

## Decision

Mujica treats autonomous self-righting as one behavior inside a deployed
Controller, not as a Controller a human selects after the robot falls. The
checked-in `behavior-supervisor` owns one unchanged 12-torque Action ABI and
arbitrates:

1. `locomotion` while the robot is inside the locomotion operating envelope;
2. `recovery.impulse → recovery.capture → recovery.rise → recovery.stand`
   after a debounced resting-fall observation;
3. `settling`, a fixed one-second cross-fade from the recovery Action to the
   locomotion Action; and
4. `locomotion` again after the bounded handoff completes.

The fall detector uses yaw-invariant body tilt together with low torso height.
The conjunction matters: the accepted gait can make large dynamic pitch
excursions without being a resting fall. Five consecutive fallen observations
are required during locomotion, while an episode authored with an initial
resting pose enters recovery immediately.

## Frozen Controller package

Program Controller identity now hashes the complete Controller directory,
including `controller.json`, the entry module, and package-local helper
modules. The Python loader gives an entry module a private package namespace,
so a composed Controller can use relative imports without modifying global
`sys.path`. A helper-source edit therefore changes Run identity, Benchmark
evidence, Revisions, and Hardware Bundles.

This closes a provenance defect in the former entry-only hash: a multi-file
Controller could previously change executable behavior without changing its
declared identity.

## Recovery-to-mission Task

Task v5 combines a bounded `motionCommandSchedule`, the Task v4
`recoveryTarget`, and a fixed `mobilityMeasurementStartSeconds`. The mission
command is visible from reset and remains pending while recovery owns the
Action ABI. The Judge measures target-direction motion from the authored,
control-grid-aligned measurement boundary, not from Controller telemetry.

The fixed boundary prevents a Controller from shrinking its target distance by
reporting a late handoff. Controller mode and transition telemetry remain
diagnostic evidence only.

`recovery-handoff` freezes front, back, left, and right resting poses. Every
case must:

- reach and hold the shared recovery target;
- complete before the five-second mobility measurement boundary;
- produce positive signed progress under the still-active forward command;
- end upright and above the final-height gate;
- preserve joint-limit, collision, and actuator gates.

## Measured result and limit

On `command-conditioned-history-3dof`, the supervisor passes all four
`self-righting` cases and all four `recovery-handoff` cases with zero
violations. The fixed post-recovery window measures:

- front progress `0.424`;
- back progress `0.184`;
- left progress `0.062`; and
- right progress `0.062`.

The same Controller is an exact pass-through for ordinary locomotion:
`command-tracking` and `command-transitions` retain zero violations and the
same aggregate scores as `bounded-traction-gait`. The current project Review
therefore passes command foundation, self-righting, and transition quality.

This is a capability floor, not a claim of good recovery locomotion. Side-pose
post-recovery speed remains weak, and the pre-existing robustness stage still
fails `spatial-robustness` and `sim-to-real-audit`. Those locked failures are
the next controller/RL research target; they are not weakened to promote the
supervisor.

## Human–Agent evidence

Runtime emits both `controller.mode-changed` and
`controller.phase-changed`. Every trajectory row retains the full finite
Controller telemetry map. Studio shows mode, phase, transition reason/count,
recovery lineage pose, supporting feet, target streak, and whether the mission
command has been released. The same row is available through
`mujica evidence inspect`, so a human watching the replay and an Agent
diagnosing headlessly refer to one immutable state transition.
