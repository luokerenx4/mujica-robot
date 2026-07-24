# Self-righting as an executable robot-design capability

## Decision

Mujica models self-righting as a complete capability contract, not as a special controller demo and not as an instruction to add a waist.

The contract separates four authorities:

- a Task defines what counts as stable recovery;
- a Scenario defines the exact fallen initial condition;
- an Objective defines score terms and locked safety gates;
- an Assembly and Controller jointly attempt the recovery.

The same Task, Scenarios, Objective, seeds, and gates judge every morphology candidate. A morphology may not ship with a private easier recovery definition.

## Recovery Task

Task version 4 is a zero-command recovery test. It retains the existing control-grid and fall-termination fields and adds:

- minimum standing base height;
- maximum yaw-invariant body tilt;
- maximum root linear speed;
- maximum root angular speed; and
- required uninterrupted stable-standing dwell.

Starting below normal healthy height is expected, so self-righting Tasks do not terminate merely because the robot begins fallen.

## Frozen fallen state

Scenario version 1 may provide `initialBasePose` with an exact world position and normalized MuJoCo `wxyz` quaternion. Runtime applies it after the Assembly keyframe and before joint noise, records it in `episode.reset`, and freezes it into the Run identity and `inputs/initial-state.json`.

The first suite uses front, back, left-side, and right-side resting poses. It does not randomize orientation. Randomized recovery belongs in a later training set, never in the locked first witness.

## Recovery evidence

Every Simulation Run publishes:

- initial, minimum, and final body tilt;
- final base height;
- whether the stable recovery target was achieved;
- first stable-stand time and maximum/final stable dwell;
- minimum scalar-joint limit margin;
- peak applied actuator command; and
- disallowed robot-to-robot collision steps.

Runtime emits `robot.recovery-target-entered`, `robot.recovery-target-exited`, and `robot.self-righted` events. These events are derived debugging evidence; the numeric Run metrics remain Judge authority.

Self-contact excludes world contacts and the intentional overlap of bodies separated by at most two kinematic edges around a joint. Foot, limb, torso, and waist contacts with the floor are legal during recovery; non-neighbor robot-to-robot contacts are reported because a controller must not win by repeatedly striking its own mechanism.

## Judge gates

Recovery Objectives may gate:

- self-righting success;
- time to stable stand;
- stable-standing dwell;
- final body tilt and base height;
- joint-limit margin;
- peak actuator command; and
- disallowed collision steps.

These gates default to permissive values for older locomotion Objectives. They become enforced only when a recovery Objective declares stricter thresholds.

Capability gates continue to outrank aggregate score. A faster recovery that adds self-collision, violates joint limits, or exceeds actuator authority is not an improvement.

Collision-step severity is normalized by episode step count for research ordering. The gate remains exact—one newly introduced disallowed contact still regresses a previously passing case—but a raw frame count cannot numerically swamp recovery success, final pose, or joint-limit evidence.

## Morphology comparison

The first design comparison is:

1. the existing rigid `quadruped-3dof` base; and
2. a split-torso base with the smallest waist that can address both failure families.

A single hinge can assist either front/back recovery or side recovery, but not both. The articulated candidate therefore uses two bounded orthogonal hinges—roll and pitch—between front and rear torso segments. This costs two Action coordinates and explicit structural mass. The Development Charter may widen the Action envelope only to the exact fourteen coordinates required by this candidate; mass, observation, and cost gates remain fixed.

This is a Robot Base alternative rather than a cosmetic Component. Re-parenting the rear legs is a structural topology change, and representing it as a mounted shell would be physically dishonest. Assembly comparison must expose the changed base, mass, Observation contract, and Action contract.

## Design-selection rule

The waist is a hypothesis. It is eligible for promotion only when:

- the rigid candidate cannot satisfy the shared locked recovery contract, or the articulated candidate wins by a predeclared margin;
- all recovery safety gates pass;
- required locomotion regressions remain passing; and
- the improvement justifies added mass, Action width, and controller/training complexity.

Until those conditions hold, Studio may show the articulated run as a design experiment but must not label it the selected robot.

## First measured result

The first rigid and articulated baselines both failed all four fixed cases. Both reached the inverted resting basin instead of the stable-standing target. The two-axis waist slightly improved aggregate score but introduced more non-neighbor self-contact; it was therefore rejected as a Robot Revision.

One controller-code experiment that latched the initial fall axis was kept because it removed one safety-gate failure and reduced the total violation count from 28 to 27. It still did not self-right. A follow-up that reversed the latched direction was rejected. The first 8,192-step residual PPO Policy also regressed.

These results narrow the next hypothesis: recovery needs a contact-aware phase that explicitly handles the inverted basin, or a morphology whose reachable workspace can create useful ground reaction forces there. Merely adding two waist coordinates, completing RL training, or flipping a sign is not sufficient evidence.

Studio presents recovery outcome deltas separately from locomotion-quality burdens and exposes target occupancy, stable dwell, time to stand, joint-limit margin, self-contact, and final pass/fail at the selected frame. The copied Agent context carries the same recovery evidence.
