# ML motion-quality research

## Purpose

Mujica uses ML as one replaceable Controller-development method inside the robot harness. A Coding Agent chooses a bounded hypothesis and source change; PPO optimizes weights from simulation experience; a frozen-policy evaluation decides whether the result improved the robot. No one layer may grade its own work.

## Three optimization signals

The loop deliberately keeps three signals separate:

1. **Task reward** gives dense survival, tracking, progress, posture, energy, and Action continuity feedback during training.
2. **Quality reward shaping** adds dense local proxies for the visible gait defects.
3. **Locked Judge evidence** evaluates the frozen Policy with task gates and the unitful motion-quality metrics defined by [Motion-quality Judge](motion-quality-judge.md).

Training reward is allowed to be imperfect. It never changes a Benchmark score, gate, KEEP/REVERT decision, or completed Run.

## Quality reward contract

Training V1 optionally declares non-negative `qualityReward` weights. Omission produces exactly zero quality penalty and preserves existing Training behavior.

After each MuJoCo control interval, the Runtime exposes exact training-only features:

| Term | Dense feature | Fixed reference |
| --- | --- | --- |
| `jointAcceleration` | Mean absolute actuated-joint velocity change divided by control `dt` | `1000 rad/s²` |
| `bodyAngularAcceleration` | Mean absolute root angular-velocity change divided by control `dt` | `100 rad/s²` |
| `actionSlew` | Mean absolute applied-Action change divided by control `dt` | `800 Action units/s` |
| `actuatorSaturation` | Fraction of applied actuators within 1% of either declared bound | `1` |
| `footSlip` | Mean XY speed of feet whose touch force exceeds `1 N` at both endpoints | `1 m/s` |
| `footImpact` | Mean positive touch-force derivative | `20000 N/s` |

Each feature is divided by its fixed reference and multiplied by its Training weight. The sum is subtracted from the base task reward. The Training artifact records per-update mean base reward, total quality penalty, and every weighted term.

Acceleration is a dense proxy, not the final jerk claim. Frozen evaluation still computes actual joint and root-angular jerk from the completed trajectory. Exact foot sites and touch sensors follow the same planted-contact rule used by the Judge.

## Learned residual boundary

The first ML lane serializes `upright-traction-gait` into every Policy Artifact and places a small, low-exploration actor behind an explicit residual scale. The network observes the deployable Assembly channels and contributes a bounded torque residual. It cannot read Scenario identity, friction, seed, future commands, Objective weights, or Benchmark results.

The Lab can edit only its Trainer package, Training definition, and Policy Controller pointer. The primary Judge is locked `motion-quality`; `upright-locomotion` and `command-transitions` are locked regressions. Training transitions and wall time are bounded. Every attempted Training Run and Policy remains immutable evidence even when the source proposal is reverted.

## First governed result

The initial quality-aware search supplied useful negative evidence. A candidate scoring `51.4668` was rejected because delayed yaw tracking and braking overshoot regressed; another reduced quality severity but failed delayed survival. The Judge therefore prevented a higher primary score or smoother local proxy from masking capability loss.

The accepted strategy then shrank learned authority to a `0.002` residual scale with a strong zero-output penalty. Policy `motion-quality-residual-locomotion-478335c4ce7fee99` improved the primary score from `48.4059` to `49.6529`, reduced enforced violations from ten to seven, and reduced normalized violation severity from `7.7188` to `2.6004` without a regression-suite gate failure. Mujica published Policy Revision `quadruped-p-a19af86be9ad`.

The next experiment expanded residual scale to `0.004`. It regressed delayed lateral drift, braking terminal tracking, and overshoot, so the Lab retained its immutable Training Run and Policy but reverted the source head. This establishes the intended authority boundary: learning may propose more control, but promotion stays fail-closed.

## Human and Agent roles

The Coding Agent reads prior immutable results, edits the isolated source closure, and states one hypothesis. PPO performs numerical optimization. Mujica freezes the model and evaluates it. A human may then compare exact Run replays, but visual preference cannot override the verdict.

This is “AI-driven” in an auditable sense: AI authors robot source and experiment strategy, ML learns control parameters, and machine-readable gates govern selection. It is not an autonomous claim of real-world readiness.
