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

The current failure begins during one-step-delay approach locomotion, before
impact. A useful Policy therefore needs measured locomotion authority early
enough to affect impact entry, while remaining unable to replace recovery
logic. Prefer changing one of:

- leg-versus-waist residual authority;
- locomotion gate dwell, tilt ceiling, or ramp;
- PPO budget/step size and prior regularization;
- complete-Mission progression boundary; or
- bounded reward weight for signed command progress and phase timeout.

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
