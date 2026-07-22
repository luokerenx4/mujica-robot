# Spatial gait autoresearch

Improve one bounded controller parameter at a time against the locked `spatial-robustness` Benchmark.

The target is a single controller that survives and makes net forward progress under seeded reset noise, payload, low friction, a 50 N lateral impulse, and a two-control-step actuator delay. Never special-case a scenario or weaken a gate. Treat aggregate score as secondary to passing every gating case. A KEEP experiment must preserve the exact Benchmark lock and publish its immutable evaluation as a Robot Revision.

The controller is intentionally small: a periodic front/rear bound, roll stabilization, phase lead, and short-horizon joint-state prediction. Prefer a smaller numerical change over adding controller state or a new Runtime capability.
