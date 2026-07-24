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

- authority is zero until the Program enters observable dynamic recovery;
- authority is zero during approach and impact;
- authority is zero for static self-righting;
- per-actuator authority must remain explicitly finite and smaller than the
  Program's normal actuation envelope;
- authority is derived only from Program telemetry, never Scenario identity or
  a Mission phase label; and
- missing, non-finite, or out-of-envelope telemetry fails closed to zero.

The first 32,768-step scalar-authority Policy recovered one locked terminal-yaw
gate and changed the Mission violation tier from 41 to 40, but it did not
self-right. A 65,536-step follow-up widened authority through one-foot contact;
the locked trace proved that neither accepted nor candidate Policy ever reached
one-foot support in the selected exact-left review. Extra scalar training
instead regressed both exact-left progress gates and was rejected.

Waist-focused finite authority and one-contact continuation were also
rejected. New Controller evidence then tested progress-adaptive phase, an
impact brace, early recovery, and momentum-directed recovery entry. Early
entry reduced complete-Mission violations `42 → 39`, but both early-entry
variants still lost the previously successful degraded-right recovery. The
fixed Program trajectory, not merely the inverted plateau, is now the measured
boundary.

The next bounded hypothesis therefore moves learned authority earlier but
narrows it by observable plant state:

- `measuredDelaySteps` must equal one;
- Program mode must be dynamic `recovery`;
- authority begins only above `0.3 rad` tilt;
- authority ends after the first retry, above three supporting feet, outside a
  safe base-height envelope, or after `4.5 s` recovery dwell;
- each leg actuator receives at most `0.30 Nm`;
- each waist actuator receives at most `1.50 Nm`.

Static recovery, approach, impact, locomotion, and Mission phase labels remain
outside learned authority. Exact and degraded Cases are not privileged policy
inputs: if their observable Program telemetry enters the same gate, the
residual may act and the locked complete Case must judge it. This tests whether
PPO can adapt the recovery trajectory to measured entry momentum without
becoming a general-purpose controller or hiding failed Program behavior.

Training reward may use the dense `tiltEscape` term to escape the fully
inverted zero-gradient region. Stillness must remain disabled outside a
near-upright envelope. Training reward is diagnostic only.

The locked complete Mission is primary authority. Static self-righting,
recovery handoff, command tracking, and command transitions are mandatory
regressions. A score gain cannot compensate for a newly failed gate, collision,
joint-limit violation, or lost command capability.

The first delay-one candidate confirmed a useful learned correction on the
degraded-right plant: signed progress became positive, terminal tilt and
collisions fell, and joint-limit margin improved. It was nevertheless rejected
because the complete Mission exposed a later fall during traverse/stop. The
residual reactivated for that second recovery and the Mission ended mid-rise,
below the terminal height gate. A follow-up may therefore add the causal
Program-telemetry requirement `recoveryCompleted=false`. This gives PPO
authority only during recovery from the authored impact; once the Program has
completed a recovery, every later fall and the remainder of the Mission are
Program-only. Do not use Mission stage or Scenario identity to create this
boundary.

Edit the isolated workspace directly, then print exactly one proposal object:

```json
{
  "strategy": "short-kebab-case",
  "hypothesis": "Why the bounded source and Policy change should improve a measured complete Mission.",
  "expectedEffect": "Which locked gates should improve without regressions."
}
```
