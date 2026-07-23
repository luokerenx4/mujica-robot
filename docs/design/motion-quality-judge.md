# Motion-quality Judge

## Purpose

Motion quality turns visible gait defects into reproducible evidence that a Coding Agent can optimize. It is a diagnostic and acceptance dimension beside task progress, tracking, posture, survival, and hardware verification—not a claim that simulation “looks natural.”

## Measurement authority

All signals are derived after each control interval from the same MuJoCo state and applied Action stored by a Simulation Run. Derivatives use `dt = 1 / task.controlHz`; renderer cadence and browser timing never enter the calculation.

The Runtime records exact world positions for the four named foot sites (`foot-fl-site`, `foot-fr-site`, `foot-rl-site`, `foot-rr-site`). A foot contributes to planted-slip evidence only when its touch force exceeds the contact threshold in both adjacent samples. This excludes swing motion. Missing sites make foot-quality evidence unavailable; the Runtime never estimates it from pixels or joint geometry.

## Signals and units

For sample `i`, first differences use adjacent applied Actions or velocities. Second velocity differences are accelerations; their next difference is jerk. The first two samples without enough history carry zero derivative values and do not enter derivative aggregates.

| Signal | Definition | Unit |
| --- | --- | --- |
| Joint jerk | Absolute finite-difference jerk of actuated joint velocities | `rad/s³` |
| Body angular jerk | Absolute finite-difference jerk of root angular velocity | `rad/s³` |
| Action slew | Absolute applied-Action difference divided by `dt` | Action units/s |
| Actuator saturation | Fraction of actuators within 1% of either declared control bound | ratio `[0, 1]` |
| Planted-foot slip | XY foot-site displacement divided by `dt`, requiring contact at both endpoints | `m/s` |
| Contact impact | Positive touch-force difference divided by `dt` | `N/s` |

Trajectory rows retain compact `motionQuality` summaries for frame-local diagnosis. Run metrics retain mean and peak values, total planted-foot slip distance, peak touch force, and availability. Means are calculated over valid scalar observations, not padded zeros. Each aggregate name includes its unit or a dimensionless `Rate` suffix.

## Scoring and gates

Objective V1 adds neutral-default penalty weights for joint jerk, body angular jerk, Action slew, saturation, foot slip, and contact impact. Existing Objectives therefore preserve their scores.

Matching maximum gates also default to a permissive bound. A dedicated motion-quality Objective must set explicit weights and bounds. Motion-quality gates cannot waive survival, progress, tracking, posture, or regression gates; they only add reasons to reject.

The example `motion-quality` Benchmark fixes nominal and three-step delayed forward walking at seed `1807`. Its first bounds deliberately describe the next capability gap rather than retrofitting a pass: the current upright Controller crosses nominal joint-jerk/Action-slew bounds and delayed body-jerk/saturation/slip/impact bounds while still satisfying the task and posture gates. These measurements are the starting evidence for bounded Research, not universal biological-naturalness constants.

CLI diagnosis maps each violation to a bounded hypothesis:

- joint/body jerk: inspect gait phase discontinuities, feedback gains, and command transitions;
- Action slew or saturation: inspect Controller output bounds, gain wind-up, delay compensation, and actuator authority;
- planted-foot slip: inspect friction assumptions, contact timing, load transfer, and foot placement;
- contact impact: inspect touchdown velocity, clearance, phase timing, and joint damping.

Hypotheses cite the measured gate and remain advice. They never mutate Controller source.

## Synchronized comparison

`mujica studio <project> --run A --compare-run B` treats `A` as baseline and `B` as subject. Each Run independently resolves and verifies its exact model, trajectory hash, result hash, replay identity, frame hashes, and telemetry.

The snapshot embeds both replays. A shared simulation-time cursor selects the nearest available frame at or before that time for each side; comparison does not assume equal frame counts, stride, or duration. Playback, step, scrub, speed, and Event seek change the shared time. Studio shows:

- baseline and subject perspective frames;
- per-side Run/frame/time identity and local telemetry;
- both top-down paths;
- aggregate motion-quality values and signed `subject - baseline` deltas;
- a copyable context containing both immutable result/replay identities and current frame mappings.

Studio remains a read-only observer. It does not recompute physics, metrics, scores, or promotion verdicts, and visual comparison is never evidence of physical-hardware performance.
