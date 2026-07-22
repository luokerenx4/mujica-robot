# Spatial generalization audit

## Purpose

The promoted spatial policy was accepted on its locked seven-case Benchmark in the original Runtime context. A later friction correction showed that one authored low-friction case had been physically inert, reopening that specific capability. This audit deliberately evaluates a different held-out distribution: two new reset seeds, a mirrored 50 N push, 20 ms and 60 ms actuator delays, delay plus push, and delay plus reset. Every held-out case is gating in `spatial-generalization`.

## Findings

The promoted half-scale policy generalizes to both reset seeds, the mirrored push, and both compound 40 ms disturbances. It raises the aggregate held-out score from the program controller's 52.5065 to 58.5595. It does not generalize across delay duration: at 20 ms it makes no net progress and drifts 0.249 m; at 60 ms it drifts 0.650 m.

Adding delay variants to the PPO episode rotation did not solve the problem. Aligning training reward with Benchmark lateral displacement also did not produce a gate-passing policy, and a telemetry-aware feed-forward run still failed. All three frozen policies and training runs are retained as negative evidence; none is promoted or selected as the default.

## Actuator telemetry component

`actuator-telemetry` adds two explicit 12-value channels: `last-commanded-action` and `last-applied-action`. The resulting Assembly has a 69-value Observation Contract and the same 12-value Action Contract and physical mass. The Runtime supplies both channels at the controller boundary, and a contract test proves that a delayed environment reports the new command while applied torque remains queued.

A feed-forward MLP still cannot reliably infer arbitrary delay from a single telemetry snapshot. The next justified controller class is recurrent or uses an explicit bounded action-history window. This should be implemented as a declared policy architecture change, not hidden state outside the Observation Contract.

## Bounded-history and calibrated-latency follow-up

`actuator-history` declares four commanded and four applied action frames, producing a 142-value contract after adding the driver's calibrated delay-step signal. Mujica adds a replayable `history-gru-actor-critic`: its GRU encodes only the bounded observation window and carries no hidden state between environment steps or episodes, so ordinary PPO minibatches and deterministic policy replay remain valid.

Increasing a history MLP to 32768 steps regressed 5.0694 points. The GRU policies also failed the complete gate, including attempts with 0.25 residual scale and residual-mean penalties of 0.05 and 0.2. These results rule out missing observation history, training budget, and unconstrained residual magnitude as single-factor explanations.

The calibrated-latency program controller first completed both held-out pure-delay cases with full survival, progress above 0.35, and effectively zero drift. This proved the actuator model and 3-DOF mechanics could handle 20–60 ms when the analytic phase prior was correct, while compound delay-plus-disturbance remained unsolved at that audit point.

## Evidence-guided compound recovery

Executable Program Controller interfaces made the calibrated Controller legal only with `force-sensing-history-3dof`. `mujica diagnose` then localized the remaining failures without treating heuristics as evidence: delay-plus-push drifted `0.28099 m` and delay-plus-reset drifted `0.79888 m` against the locked `0.2 m` gate, although both survived and made progress.

The governed `compound-recovery` loop recorded 34 immutable experiments. A `0.01 s` disturbance phase lead and stronger roll-position gain first raised aggregate score from `54.66510` to `60.07851` and reduced violations from two to one. Instantaneous lateral-velocity and integrated episode-relative position feedback failed in both directions and remain negative evidence rather than selected mechanisms.

One experiment exposed a governance error: `rollPositionGain=0.31249` passed every gate but was reverted because its `56.98227` aggregate was below the infeasible current best. Research selection is now lexicographic—fewer enforced gate violations first, then score inside the same feasibility tier—while every fixed-case score regression remains anchored to the immutable Benchmark baseline. Replaying the candidate under the renewed lock produced KEEP Experiment `034-410a436d4428` and Robot Revision `quadruped-r-cb6b31bc8f4a`.

The kept robot survives all seven held-out cases. Pure-delay progress is `0.35256` at 20 ms and `0.35420` at 60 ms with effectively zero drift. Delay-plus-push reaches full progress with `0.10133 m` drift; delay-plus-reset reaches `0.40626` progress with `0.06757 m` drift. Aggregate score is `4.47582` above the locked baseline. The held-out gate is now solved in MuJoCo, not claimed as HIL or physical-robot evidence.

## Governance decision

The prior default `force-sensing-3dof` plus `spatial-residual-gait` and Policy Revision `quadruped-p-7423506a0965` remains immutable evidence for the earlier Runtime context, not a current claim that corrected low-friction locomotion passes. The held-out improvement is a separate Robot Revision using the history Assembly and calibrated Program Controller; it does not retroactively rewrite completed policy evidence.
