# Command transition gait autoresearch

Improve `transition-aware-gait` against the locked `command-transitions` Benchmark.

The Task schedule, resolved boundary steps, scenarios, Objective tolerances, gate thresholds, Assembly, Runtime, and baseline Controller are fixed evidence. Edit only the declared numeric Controller configuration values. Do not preview future command segments or infer schedule timing inside the Controller.

Selection is capability-first: preserve every gate that already passes, then reduce enforced violation count, normalized violation severity, and finally improve aggregate score. Inspect per-transition terminal error, sustained settling, overshoot, survival, and the exact command-boundary trajectory before attributing a failure to a parameter.

Prefer the smallest reversible change. Command rate limits and transition-only velocity gains must not change one-command Task v2 behavior. Stop when the bounded neighborhood is exhausted or every gate passes.
