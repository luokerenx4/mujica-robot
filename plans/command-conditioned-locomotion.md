# Command-conditioned locomotion

- Status: `completed`
- Updated: `2026-07-23`
- Related design: [Program Controller interface](../docs/design/program-controller-interface.md)

## Outcome

Mujica develops the quadruped against explicit motion commands instead of one controller-internal forward-speed constant. A Task command crosses the Runtime boundary as a declared Observation, appears in immutable run evidence, and is exercised by locked forward, stop, reverse, lateral, and turning cases. Humans can read the intent and result; Agents can discover, reproduce, diagnose, and optimize the same contract.

## Context

The spatial quadruped now survives combined delay and lateral disturbance, but `latency-aware-spatial-gait` still embeds a single forward target in controller configuration. Task intent therefore does not participate in the executable Controller interface, and a high score proves robustness around one gait rather than useful command tracking. This is the next robot capability bottleneck, not another scalar search on the solved fixed command.

## Scope

### In scope

- Audit the current Task-to-Runtime path and define the smallest typed motion-command Observation with unambiguous frame and units.
- Make Program Controllers declare command consumption and make runs record commanded versus measured motion.
- Add a locked command-tracking Benchmark whose gating cases include stop, forward, reverse, lateral, and yaw commands plus a small disturbed subset.
- Add deterministic diagnosis and bounded research surfaces only after the first fixed-input evaluation exposes measured bottlenecks.
- Publish a Robot Revision only when every safety and tracking gate passes without regressing the solved spatial-generalization benchmark.

### Out of scope

- Navigation, perception, footstep planning, or a general behavior tree.
- Treating simulator-only command tracking as real-hardware validation.
- Replacing the analytic Controller with unbounded policy training before command semantics and evidence are executable.
- Weakening the completed compound-recovery gates.

## Acceptance

- [x] Command frame, units, shape, bounds, and reset semantics are documented and schema-validated.
- [x] An incompatible command-consuming Controller fails before Python Runtime execution.
- [x] Run artifacts expose commanded and measured planar velocity/yaw traces without inference from logs.
- [x] A locked Benchmark covers stop, forward, reverse, lateral, and yaw commands with per-case tracking and safety gates.
- [x] The selected controller passes every command gate and the existing `spatial-generalization` gates.
- [x] A KEEP publishes immutable experiment evidence and a child Robot Revision; full TypeScript/Python regression passes.

## Work

- [x] Trace and test the current Task command semantics through schema, compiler, Runtime, metrics, and Controller host.
- [x] Write the durable command contract before changing Controller behavior.
- [x] Implement command Observation and command-tracking evidence end to end.
- [x] Establish and lock the multi-command benchmark baseline.
- [x] Diagnose, run bounded development, and promote only an all-gate-passing result.

## Findings and decisions

- 2026-07-23 — Robustness around one hard-coded forward target is not yet command-conditioned locomotion. The next slice begins at the Task/Controller ABI so both humans and Agents optimize the robot against explicit intent.
- 2026-07-23 — Audit found that Task v1's third `targetVelocity` element was compared to vertical free-joint velocity, not yaw rate, and no Task command reached Program Controllers. Task v2 is deliberately incompatible instead of silently changing that evaluator meaning.
- 2026-07-23 — MuJoCo defines free-joint linear velocity in the global frame and rotational velocity in the local body frame. The executable command therefore records world planar velocity plus body yaw rate, with both frames explicit in the durable contract.
- 2026-07-23 — Command Observations are exact Runtime inputs. They neither receive sensor noise nor consume the sensor-noise random stream; adding command capability therefore cannot silently shift otherwise identical sensor evidence.
- 2026-07-23 — Multi-command optimization is coupled: improving yaw can worsen lateral tracking while still reducing overall infeasibility. Research selection is lexicographic by enforced violation count, summed normalized violation severity, then score. A previously passing gate may never become failing.

## Progress log

- 2026-07-23 — Plan created after compound delay/disturbance recovery reached zero held-out gate violations.
- 2026-07-23 — Added Task v2, a zero-mass `motion-command-input` Runtime Component, a 145-value command-capable Assembly, an interface-checked command Controller, and commanded-versus-measured trajectory evidence.
- 2026-07-23 — Initial immutable runs established honest forward and stop evidence. `run-9a838c7efb0004f3` survives and reaches `0.515` normalized forward progress with `0.0217 m` drift; `run-aa806248133aed75` survives a zero command with effectively zero yaw error. Lateral and yaw behavior remain unclaimed until locked tracking gates exist.
- 2026-07-23 — Locked `command-tracking` across stop, forward, reverse, lateral, yaw, delayed-forward, and disturbed-lateral. The frozen baseline scored `71.2745` with eight enforced violations.
- 2026-07-23 — Forty-six immutable bounded experiments plus targeted controller development reduced the benchmark to zero violations. The selected `command-tracking-gait` scored `76.3247` (`+5.0502`) and also passed the prior `spatial-generalization` benchmark with zero violations at `56.4313`.
- 2026-07-23 — Candidate KEEP published Robot Revision `quadruped-r-45f394da4a24`. The final regression passed 34 TypeScript tests, 18 Python/MuJoCo tests, type checking, and dry-run hardware protocol verification `verification-d96ea9defa876b75`.
