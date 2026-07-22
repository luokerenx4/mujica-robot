# Spatial quadruped development

## Decision

Mujica's second robot revision is a 3-DOF-per-leg quadruped. Each leg adds an abduction joint ahead of the existing hip and knee pitch joints. The resulting Robot Assembly has a 45-value Observation Contract, a 12-value Action Contract, and a compiled mass of 6.03 kg.

This is a new Base rather than an optional Component. Abduction changes the kinematic tree, actuator ABI, MJCF keyframe, and controller assumptions together; expressing it as a bolt-on catalog Component would hide a mechanical incompatibility.

## Controller

The program controller remains deliberately small. It uses a periodic front/rear bound, foot-contact modulation, roll feedback, a 120 ms gait phase lead, and 19.73 ms constant-velocity prediction of joint position and roll. The prediction is scenario-independent: the controller receives no actuator-delay value and does not branch on scenario identity. Torque slew limiting was tested and removed because it did not improve delayed actuation and caused reset and payload regressions.

## Evaluation correction

Episode survival is now `healthy steps / planned steps`. The earlier denominator used executed steps, making a robot that fell near the end of a truncated trace appear to have almost perfect survival. Changing evaluator source invalidates prior Benchmark locks by design; all locks were regenerated with the corrected Runtime source hash.

## Locked spatial benchmark

`spatial-robustness` compares the prior 2-DOF robot with the 3-DOF proposal across nominal motion, two seeded resets, low friction, payload, a 50 N lateral impulse, and a two-control-step (40 ms) actuator delay. Every case is gating.

The 50 N push is intentionally discriminating: the 2-DOF baseline falls after 1.52 s with 0.591 m lateral drift, while the promoted 3-DOF controller completes 5 s with 0.080 m drift. Under actuator delay, the baseline falls after 1.54 s and moves backward 0.879 m; the proposal completes 5 s and moves forward 0.675 m.

`spatial-locomotion` preserves the existing survival, forward-progress, and lateral-drift gates. It allows up to 20 points of per-case regression because this is a Development Candidate adding a new capability envelope, not a same-capability efficiency optimization. The aggregate score must still improve. The locked result is 62.6170 versus 59.7765 (+2.8405), producing Robot Revision `quadruped-r-b1a3d1f7161a`.

## Autoresearch result

The reproducible `spatial-gait` loop tested bounded one-parameter changes after promotion. Four initial coordinate experiments changed gait frequency and phase lead. None exceeded the 0.01 minimum improvement, so all were REVERT and no post-promotion source mutation occurred.

## Residual-policy result

The `spatial-gait-residual` transform reproduces the promoted 12-action program controller at zero residual; a contract test compares both implementations on the same observation and simulation time. An unconstrained 8192-step PPO run raised aggregate score from 62.6170 to 62.9482 but failed the actuator-delay gate with 0.484 survival and 0.350 m lateral drift.

Mujica therefore promotes `residualScale` into the governed Training manifest and freezes its effective value into policy architecture. A half-scale run passes every gate and scores 63.0350, including full actuator-delay survival, 0.694 progress, and 0.030 m drift. It creates Policy Revision `quadruped-p-7423506a0965`. A quarter-scale policy scores 63.3804 but regresses seeded reset survival to 0.664, so it remains REVERT despite the higher aggregate. The project defaults now select the half-scale policy and 3-DOF Assembly.
