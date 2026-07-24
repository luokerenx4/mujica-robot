# Articulated inverted-escape code and RL research

Improve the articulated quadruped inside the complete eighteen-second,
no-reset `integrated-resilience-mission`. Every training episode must begin at
`approach`, experience an authored impact, and preserve all later Mission
commands. A prefix may end an early curriculum episode after `recover`; it may
not synthesize an isolated fallen state.

The serialized Program Controller owns locomotion, fall detection, the initial
impulse/capture/rise sequence, retry selection, handoff, and every state outside
the explicit inverted-escape envelope. PPO is a bounded residual, not a
replacement controller:

- authority is zero before the first dynamic retry;
- authority is zero during approach and impact;
- authority is zero for static self-righting;
- authority is at most `0.15 Nm` on each leg actuator and `2 Nm` on each waist
  actuator when the per-actuator experiment is active;
- authority is derived only from Program telemetry, never Scenario identity or
  a Mission phase label; and
- missing, non-finite, or out-of-envelope telemetry fails closed to zero.

The first 32,768-step scalar-authority Policy recovered one locked terminal-yaw
gate and changed the Mission violation tier from 41 to 40, but it did not
self-right. A 65,536-step follow-up widened authority through one-foot contact;
the locked trace proved that neither accepted nor candidate Policy ever reached
one-foot support in the selected exact-left review. Extra scalar training
instead regressed both exact-left progress gates and was rejected.

The next bounded hypothesis must therefore change authority structure, not
merely duration: retain only micro-corrections on the twelve leg actuators,
concentrate bounded residual authority on the two new waist actuators, and stop
the learned attempt after a finite recovery-mode dwell. This tests whether the
new morphology can earn its complexity without letting an unsuccessful Policy
thrash through every later Mission command.

Training reward may use the dense `tiltEscape` term to escape the fully
inverted zero-gradient region. Stillness must remain disabled outside a
near-upright envelope. Training reward is diagnostic only.

The locked complete Mission is primary authority. Static self-righting,
recovery handoff, command tracking, and command transitions are mandatory
regressions. A score gain cannot compensate for a newly failed gate, collision,
joint-limit violation, or lost command capability.

Edit the isolated workspace directly, then print exactly one proposal object:

```json
{
  "strategy": "short-kebab-case",
  "hypothesis": "Why the bounded source and Policy change should improve a measured complete Mission.",
  "expectedEffect": "Which locked gates should improve without regressions."
}
```
