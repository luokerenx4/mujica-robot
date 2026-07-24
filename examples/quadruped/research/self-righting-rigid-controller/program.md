# Rigid self-righting research program

Improve the complete four-case `self-righting` Benchmark without changing its Task, fallen Scenarios, Objective, seeds, lock, Assembly, or actuator limits.

Work only inside `controllers/rigid-self-right/**`.

Use this evidence order:

1. reduce enforced violation count;
2. reduce normalized violation severity;
3. improve score only inside the same feasibility tier.

Inspect `robot.recovery-target-entered`, `robot.recovery-target-exited`, joint-limit margin, non-neighbor self-contact, final tilt, and stable dwell. Do not treat violent motion or a transient upright frame as recovery.

The rigid torso is the lower-complexity design baseline. A valid failure is useful evidence for the morphology decision.
