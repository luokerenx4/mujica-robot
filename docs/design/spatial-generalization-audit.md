# Spatial generalization audit

## Purpose

The promoted spatial policy is proven on its locked seven-case Benchmark. This audit deliberately evaluates outside that distribution: two new reset seeds, a mirrored 50 N push, 20 ms and 60 ms actuator delays, delay plus push, and delay plus reset. Every held-out case is gating in `spatial-generalization`.

## Findings

The promoted half-scale policy generalizes to both reset seeds, the mirrored push, and both compound 40 ms disturbances. It raises the aggregate held-out score from the program controller's 52.5065 to 58.5595. It does not generalize across delay duration: at 20 ms it makes no net progress and drifts 0.249 m; at 60 ms it drifts 0.650 m.

Adding delay variants to the PPO episode rotation did not solve the problem. Aligning training reward with Benchmark lateral displacement also did not produce a gate-passing policy, and a telemetry-aware feed-forward run still failed. All three frozen policies and training runs are retained as negative evidence; none is promoted or selected as the default.

## Actuator telemetry component

`actuator-telemetry` adds two explicit 12-value channels: `last-commanded-action` and `last-applied-action`. The resulting Assembly has a 69-value Observation Contract and the same 12-value Action Contract and physical mass. The Runtime supplies both channels at the controller boundary, and a contract test proves that a delayed environment reports the new command while applied torque remains queued.

A feed-forward MLP still cannot reliably infer arbitrary delay from a single telemetry snapshot. The next justified controller class is recurrent or uses an explicit bounded action-history window. This should be implemented as a declared policy architecture change, not hidden state outside the Observation Contract.

## Governance decision

The current default remains `force-sensing-3dof` plus `spatial-residual-gait` and Policy Revision `quadruped-p-7423506a0965`. The held-out Benchmark is a new research gate, not a retroactive rewrite of the completed promotion evidence.
