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

## Contact-qualified phase controller

The first successful rigid-torso Controller is deliberately small and observable. It classifies the initial fall from the body-up vector, not Euler roll/pitch, because the latter is ambiguous near the 90-degree resting poses. It then runs:

1. `impulse`: create momentum in the selected recovery direction;
2. `capture`: place the legs for useful ground contact instead of sweeping them in air;
3. `rise`: use pose-specific orientation and rate feedback while preserving support; and
4. `stand`: hold the ordinary standing target after stable-target qualification.

Phase changes are evidence, not hidden Controller state. A Program Controller may expose a finite JSON telemetry map. Runtime records `controllerPhase` and `controllerTelemetry` on every trajectory row and emits `controller.phase-changed` events. The current telemetry includes the detected fallen pose, number of supporting feet, recovery-target state, and target-streak steps. Older Controllers remain compatible because telemetry is optional.

Studio shows those fields next to the authoritative MuJoCo frame, and copied frame context includes the same Controller state. `mujica evidence inspect` returns it from the immutable trajectory for headless Agent diagnosis.

## Measured selection result

The first rigid and articulated baselines both failed all four fixed cases. Both reached the inverted resting basin instead of the stable-standing target. The two-axis waist slightly improved aggregate score but introduced more non-neighbor self-contact; it was therefore rejected as a Robot Revision.

One controller-code experiment that latched the initial fall axis was kept because it removed one safety-gate failure and reduced the total violation count from 28 to 27. It still did not self-right. A follow-up that reversed the latched direction was rejected. The first 8,192-step residual PPO Policy also regressed.

Those failures narrowed the hypothesis correctly. Candidate `phased-self-righting` added an explicit contact-aware phase sequence and passed all four fixed cases with the existing rigid torso:

- aggregate score `-15.752509 → 90.306324`;
- gate violations `27 → 0`;
- recovery times `3.68–4.32 s`;
- final stable dwell `1.70–2.34 s`;
- zero disallowed self-contact steps; and
- positive joint-limit margins with the locked actuator ceiling.

Judge selected `KEEP` and published Robot Revision `quadruped-r-0bb926344064`. Because the rigid morphology now satisfies the authored witness, the two-axis waist remains rejected: extra mass, Action width, collision geometry, and hardware complexity are not justified by this capability evidence.

The morphology question was re-opened after the behavior supervisor existed, using a new
`self-righting-morphology-v2` Benchmark whose baseline is the successful phased rigid
Controller rather than the obsolete cyclic Controller. The articulated Controller was
then moved to the same impulse/capture/rise state machine while holding the two waist
targets neutral. This controlled comparison still failed all four cases:

- phased rigid torso: aggregate `90.306324`, four successful recoveries, zero violations;
- phased split torso: aggregate `-15.130470`, zero successful recoveries;
- the front case briefly reached the standing target but could not hold it and accumulated
  disallowed self-contact; and
- the back and side cases entered the inverted basin.

This result does not prove that a waist can never help. It proves that articulation changes
the plant enough that a rigid-body leg sequence cannot be reused, even with the waist
servoed to zero. Mujica therefore keeps the waist as a `REVERT` complete-design lane. A
future attempt must jointly optimize torso geometry and leg/waist sequencing, then beat
the already-passing rigid baseline by enough to pay for `+0.2 kg`, two actuators, a wider
Observation/Action ABI, self-contact risk, and hardware reliability cost.

The hypothesis was then tested at the complete-robot boundary rather than only
inside the four resettable recovery poses. Candidate
`integrated-resilience-waist-design` uses the full 18-second Mission Suite:
approach, impact, recovery, resumed walking, redirection, lateral traversal,
and stop all share one physical and Controller state. The proposed robot is
6.23 kg with 14 actions, versus 6.03 kg and 12 actions for the selected rigid
robot. To remain within the 145-value Observation Charter, the proposal removes
raw four-step command history and retains measured actuator-delay state,
yielding an Observation width of 53. That observability loss is part of the
design burden.

With neutral waist targets, the integrated Candidate scored `-14.293828`
against rigid `38.935033` and failed self-righting in all four exact/degraded,
left/right Missions. Research session `session-2c2867adccdca750` then tried two
bounded code changes. The first reduced aggregate Mission violation count
`44 → 42` and normalized severity `185.804 → 180.903`, but introduced locked
joint-limit, collision, and isolated recovery regressions. Reversing the
impulse worsened the Mission to 46 violations. Both attempts are immutable
`REVERT` evidence.

This integrated result is stronger than a collection of independent scores:
it shows that the current waist can influence the recovery basin, but cannot
yet carry the robot through the handoff into the rest of its job. The selected
rigid robot remains the baseline. Further morphology work must change
split-torso geometry, contact workspace, and coordinated leg/waist motion as
one complete-design experiment.

## RL residual result

PPO was then placed on top of the successful program prior rather than asked to rediscover recovery. The first `0.05` residual-authority run and a second `0.001` run both completed 8,192 steps and reported strong episode reward. Frozen deterministic evaluation still failed three of four recovery cases in the tighter run: back recovery passed, front lost the stable target, and left/right fell into the inverted basin.

The separate `self-righting-residual-audit` Benchmark uses the successful phased Controller as its baseline so the learned layer cannot claim progress merely by outperforming the original broken cyclic Controller. Candidate `phased-self-righting-residual` received `REVERT`: score delta `-79.037963`, three failed cases, and 20 explicit gate reasons.

This is preserved as negative ML evidence. The side-recovery trajectory has a narrow contact-order basin; tiny continuous action changes can cross a discrete contact bifurcation. Therefore:

- training reward cannot promote a recovery Policy;
- the program prior remains selected;
- residual authority alone is not a sufficient safety mechanism; and
- future ML work must make phase/contact preservation and perturbed-pose validation explicit.

The four exact resting poses prove a bounded simulation capability, not arbitrary recovery. The next controller slice added a behavior supervisor and a separate fixed `recovery-handoff` Benchmark. One deployed Program Controller now detects a resting fall, runs the phased recovery, cross-fades through a bounded handoff, and resumes the pending world-frame command. All four exact-pose handoff cases pass with zero violations, while side-pose progress remains an explicitly weak capability floor. See [Locomotion and recovery behavior supervision](behavior-supervision.md).

The complete no-reset Mission later revealed that “resume the command” also
requires preserving its coordinate frame. Recovery can change robot heading;
the previous gait initially treated a world-frame forward command as
body-forward after handoff. Governed experiment `001-950524569565` restores
world-frame tracking only after qualified recovery and bounds yaw authority
from the measured quaternion heading. It improved the locked Suite from
`38.935033` to `39.119018`, reduced normalized violation severity from
`71.283` to `59.194`, preserved the same violation count and every gate, and
published Revision `quadruped-r-40206836cd00`.

Three PPO micro-residual experiments on this stronger prior did not promote.
The most active residual improved aggregate evidence but crossed a mirrored
exact-impact yaw gate; two safer variants stayed inside the gates but did not
beat the Program Controller. These failures narrow the next target to the
degraded-impact recovery basin rather than more residual-scale interpolation.

A separate robustness suite must still vary initial pose, contact, friction, mass, and actuator response without changing either locked witness.

Studio presents recovery outcome deltas separately from locomotion-quality burdens and exposes Controller phase, detected pose, supporting feet, target streak, target occupancy, stable dwell, time to stand, joint-limit margin, self-contact, and final pass/fail at the selected frame. The copied Agent context carries the same recovery evidence.
