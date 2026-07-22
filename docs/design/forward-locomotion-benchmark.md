# Forward locomotion benchmark

Status: V1 implemented and verified.

## Why this exists

Instantaneous velocity error is not proof that a robot travelled. The original quadruped could remain upright, move only 2.9 cm in three seconds, and still receive roughly 84 points. Mujica now treats episode-level motion as first-class evidence.

For a task with nonzero horizontal target velocity, the Runtime records initial and final base position, three-axis net displacement, forward displacement projected onto the target direction, target distance, clipped forward-progress ratio, mean forward velocity, perpendicular lateral drift, and total horizontal path length. A stationary task reports forward progress as one and treats all horizontal displacement as drift.

The Objective scores:

```text
survival + velocity tracking + net forward progress + upright
  - lateral drift - energy - action roughness
  - component mass - sensor channels - policy training steps
```

Forward progress uses net displacement divided by `target speed × requested task duration`; walking in circles or oscillating in place cannot satisfy it. Early termination does not shrink the target distance.

## Fixed robustness matrix

`forward-locomotion.benchmark.json` contains seven 5-second cases at a 0.25 m/s target:

- nominal;
- two distinct seeded joint-state and observation perturbations;
- low friction;
- 0.8 kg payload;
- two-control-step actuator delay;
- timed lateral push.

The reset perturbation is deterministic for a seed and different across seeds. Benchmark locks hash the parsed scenario, including reset-noise fields, so changing the distribution requires explicit relocking.

## Gates and scored challenges

Required cases must survive at least 80% of the requested episode, reach 25% of the target distance, remain below 0.2 m lateral drift, and respect the per-case regression limit. A Benchmark case may set `gating: false`: it still contributes to the aggregate and is present in every evaluation, but it cannot block an otherwise valid promotion.

This distinction is intentionally explicit. The current 2-DOF-per-leg model cannot recover a 40 ms delayed-torque case, so actuator delay remains a low-weight scored challenge rather than being deleted, weakened, or falsely claimed as passed. The next mechanical milestone is lateral actuation and delay-tolerant control.

Research may begin from an infeasible locked baseline. Core permits an otherwise sub-threshold candidate only when it moves the failed gate monotonically toward feasibility relative to that baseline; Candidate promotion still requires every gating case to pass absolutely.

## Verified result

The promoted `forward-gait` controller uses a left-right-symmetric front/rear bound. Against the locked baseline it scores `72.94594910737753` versus `49.35998545716317`, a `+23.58596365021436` KEEP. Every gating case survives for 5 seconds and advances `0.6506–0.9770 m`; lateral drift stays at or below `0.02354 m`.

The frozen periodic residual policy scores `71.23071451203992` after a charged 4096-step budget. Mujica keeps its Policy Revision but does not replace the stronger program-controller Robot Revision.
