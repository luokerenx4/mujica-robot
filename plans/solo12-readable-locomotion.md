# Solo12 readable locomotion foundation

Updated: 2026-07-28

## Outcome

The source-grounded `solo12-informed` robot executes its first honest commanded
forward gait with one readable Program Controller. The same Controller retains
the accepted zero-command standing suite, while a new locked locomotion suite
measures nominal motion, reset sensitivity, a combined degraded plant, and an
in-motion lateral push before any learned Policy is authorized.

## Context

Solo12-informed standing now passes eight Assembly-qualified cases, and the
current Development Work Order correctly requests capability inception rather
than inventing a failed optimization lane. The old demo robot's command evidence
cannot qualify this plant. The cheapest next question is whether one readable
scheduled gait with explicit swing clearance and bounded 2.5 Nm joint-space
control creates sustained forward motion at all.

This slice deliberately proves forward locomotion before expanding to reverse,
lateral, yaw, or transition quality. Those remain in the project Charter, but
they are not allowed to borrow evidence from the demo-family robot.

## Scope

- Keep the compiled `solo12-informed` Assembly, source provenance, geometry,
  joint envelopes, sensors, 1 kHz plant, and 2.5 Nm actuator limit fixed.
- Add one forward Task, three Solo12-specific robustness Scenarios, one
  Objective, one locked Benchmark, and one readable command-conditioned
  Controller.
- Keep the Controller mechanism inspectable: four-beat phase schedule,
  stance/swing hip trajectory, knee clearance, activity ramp, joint-space PD,
  and bounded body feedback only.
- Use the accepted disturbance-standing Benchmark as a mandatory regression.
- Repair concrete Harness evidence or workflow gaps exposed by this work.
- Do not train a Policy, change morphology, claim full planar commands, claim
  self-righting, or promote hardware in this slice.

## Development emphasis

`behavior-heavy`, mechanism-first. Static support screening and the accepted
standing suite show no current design-envelope blocker for level-floor stepping.
The budget is therefore one readable gait family and bounded parameter changes,
not arbitrary source search or RL.

Exit when every locomotion gate and the standing regression pass with a visual
Run that visibly cycles all four feet through distinct swing turns. Switch to `balanced` if the feet
create swing/stance contact but the fixed morphology cannot retain support under
reasonable trajectory parameters. Switch to `design-reassessment` if repeated
readable probes cannot produce clearance, forward contact exchange, or actuator
headroom without collision or joint-limit use.

## Acceptance

- The Task declares a Solo12-only 0.12 m/s forward command, a 4 second episode,
  and the correct plant height envelope.
- The Benchmark is authored and locked before candidate diagnosis. Cases cover
  nominal, seeded reset perturbation, one combined friction/payload/noise/delay
  plant, and a lateral push while walking.
- Gates require full survival, positive signed target progress, bounded backward
  motion, lateral drift, tilt, joint margin, actuator use, saturation, and zero
  disallowed contact.
- The standing Controller baseline fails locomotion for measured lack of
  progress rather than an interface or plant-applicability error.
- The readable gait passes the locomotion suite or leaves a precise,
  trajectory-backed mechanism diagnosis and correct development-emphasis route.
- `solo12-disturbance-standing` remains passing with the same gait Controller at
  zero command before any capability scope is accepted.
- Studio provides a synchronized baseline/candidate motion witness for human
  inspection.
- New product requirements are resolved or retained explicitly in
  `examples/quadruped/HARNESS_REQUIREMENTS.md`.
- `mujica validate` and the full TypeScript/Python test suite pass.

## Work

1. Freeze the Task, Scenarios, Objective, Benchmark, and Charter witness.
2. Diagnose the standing baseline against locomotion.
3. Implement and run a readable gait mechanism; use a conservative four-beat
   crawl when the first diagonal probe cannot demonstrate honest support exchange.
4. Tune only bounded, interpretable parameters from measured failures.
5. Re-run locomotion plus standing regression and inspect Studio evidence.
6. Repair Harness gaps, clean generated artifacts, validate, commit, and push.

## Findings and decisions

- The locked standing baseline failed all four locomotion cases only on forward
  and signed progress while remaining upright with no disallowed contact. That
  established a behavior gap rather than an Assembly or interface failure.
- The first joint-sine probe walked backward. Reversing its hip sign produced a
  numerical PASS, but Studio motion-quality deltas exposed approximately
  `0.50 m` cumulative foot slip and mean joint jerk near `8,800 rad/s³`.
- Adding explicit slip, jerk, Action-slew, and contact-impact gates invalidated
  that false positive. Trajectory contact patterns then showed that the claimed
  diagonal trot mostly lifted one forefoot while the rear feet dragged.
- A two-link IK diagonal probe created cleaner contact but still rocked onto
  three feet. The accepted mechanism therefore uses a conservative four-beat
  crawl: FL, RR, FR, and RL receive separate quarter-cycle swing windows while
  the other three feet retain a support triangle.
- Final locked locomotion result: `PASS`, score `80.2806`, delta `+4.9094`,
  zero violations. Forward progress ranges from `0.1678` under lateral push to
  `0.2103` in the degraded plant; mean foot slip stays
  `0.0160–0.0199 m/s`, maximum tilt stays below `0.049 rad`, and peak actuator
  demand stays below `1.59 Nm`.
- The same Controller at zero command passes all eight
  `solo12-disturbance-standing` cases with zero violations.
- The final nominal trajectory records hundreds of measured off-ground frames
  for each intended swing leg. Judge still lacks a generic declaration/contact
  agreement gate; that product need remains explicit in
  `HARNESS_REQUIREMENTS.md`.
- Studio playback previously treated each 1 kHz PNG as a browser animation
  frame. It now skips dense frames by simulation time: a measured one-second
  wall-clock interval advances roughly one second at `1×`.
- Final synchronized witness `studio-187a29842f0c68f2` uses a 1.4 m tracking
  camera. During browser acceptance, 1.33 seconds of wall time advanced both
  Runs to frame 1169 at 1.169 seconds of simulation time.
- Development Review `development-review-a45277cff5fc46ed` accepts both
  Solo12 standing and readable locomotion. Work Order
  `development-work-order-61a0efe49ddfb531` correctly routes the next
  Solo12-only command-foundation inception with Training still unauthorized.

## Progress log

- 2026-07-28: Opened from Development Work Order
  `development-work-order-84a935a873c6cbd3`; Training is explicitly
  unauthorized.
- 2026-07-28: Rejected the first positive-displacement probe after synchronized
  Studio and contact-pattern inspection exposed sliding and false gait
  semantics.
- 2026-07-28: Accepted the four-beat crawl after locked locomotion, standing
  regression, contact exchange, and real-time Studio playback checks passed.
