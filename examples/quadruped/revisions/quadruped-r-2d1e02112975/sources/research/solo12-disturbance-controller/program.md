# Solo12 disturbance-standing Controller research

Improve `solo12-balance-stand` against the locked
`solo12-disturbance-standing` Benchmark. The complete nominal, four-direction
push, payload, low-friction, and delayed/noisy suite is the authority.

Start with the cheapest readable hypothesis. Prefer bounded joint stiffness and
damping changes while they still improve disturbance recovery. Add body-state
or contact feedback only after the evidence shows that the joint-space
mechanism has reached a repeatable limit.

Every candidate must preserve:

- the `solo12-informed` Assembly and its 2.5 Nm actuator envelope;
- all Benchmark, Scenario, Task, Objective, and Runtime source;
- zero disallowed self-contact;
- full survival and every other enforced gate;
- one causal Controller implementation that does not inspect Scenario identity,
  future disturbance timing, seed, or Judge thresholds.

Judge lexicographically by enforced violations, normalized severity, and then
the declared minimum score improvement. A smoother trace is useful diagnostic
evidence but cannot excuse a failed physical gate.

Return one JSON proposal containing `strategy`, `hypothesis`, and
`expectedEffect`.
