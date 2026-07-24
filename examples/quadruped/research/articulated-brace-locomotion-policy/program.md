# Articulated complete-Mission locomotion residual research

Train a bounded residual around the serialized
`articulated-behavior-supervisor` Program prior. The learned Policy must
improve the same complete `integrated-resilience-mission`; it is not a
collection of independently promotable walking, impact, and self-righting
skills.

Every training episode begins at `approach`. Curriculum stages may end only
after a causal Mission phase exits. They may not reset into a fallen pose or
start at `recover`, `resume`, or a later command. Exact and randomized
complete-Mission experience must remain present.

## Authority boundary

The Program prior owns fall detection, recovery sequencing, inverted brace,
handoff, and safe behavior outside the residual gate. Learned authority must:

- derive only from declared observations and Program telemetry;
- never use Scenario id, seed, Mission phase id, timeout budget, or future
  commands;
- fail closed to zero for missing/non-finite telemetry;
- remain per-actuator bounded and ramped;
- preserve zero authority outside explicitly listed Program modes.

The latest locked Judge adds a later causal failure: after successful
self-righting, the right-degraded Case relapses during the continuous
redirect/traverse/stop suffix. A useful Policy may therefore receive bounded
authority only after an observable Program recovery transition, including the
`settling` handoff, while remaining exactly zero during approach, impact, and
Program recovery. Prefer changing one of:

- leg-versus-waist residual authority;
- post-recovery transition gate, tilt ceiling, or ramp;
- PPO budget/step size and prior regularization;
- complete-Mission progression boundary; or
- bounded reward weight for signed command progress, stop stability, successful
  recovery, phase timeout, and timeout-free completion.

Do not increase PPO steps without changing the measured authority or credit
assignment bottleneck. Training reward is evidence about learning, never
promotion authority.

The Policy must beat both the locked benchmark baseline and its current
Program reference without introducing a new enforced regression in
`self-righting-morphology-v2`, `recovery-handoff`, `command-tracking`,
`command-transitions`, or `spatial-robustness`.

Edit only the declared Training, Trainer, Policy Controller, and Domain Profile
closure, then print exactly one proposal:

```json
{
  "strategy": "short-kebab-case",
  "hypothesis": "Why the bounded Policy change should improve the measured complete Mission.",
  "expectedEffect": "Which locked gates should improve without regressions."
}
```
