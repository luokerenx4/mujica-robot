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

Later experiments proved that Controller-private completion is still too
early and that a stateless numeric gate can chatter. Recovery Policy authority
must now use the Task-derived Runtime state carried by the mission-state
Component:

- `recovery-target-satisfied=0` while ML acts, so Program alone owns every
  stable-dwell sample;
- `recovery-stable-latched=0`, so a physically completed recovery permanently
  closes this Policy;
- `recovery-deadline-expired=0`, so a timed-out recovery cannot reactivate
  later in the failed Mission;
- `allowedTelemetry.phase` may restrict authority to Program impulse/capture;
  and
- `entryRampSeconds` limits every authority rise while any envelope exit still
  fails closed immediately.

Do not infer a gate improvement from a separately retrained network. A clean
authority counterfactual must hold frozen Policy weights, normalization, plant,
Task, Scenario, and seed constant while changing only the declared gate.

The frozen-weight `target-seeking-rise-recovery` counterfactual supplied the
next causal boundary. On degraded-left, extending the same Policy through
observable Program `recovery.rise` changed self-righting from failure to
success, shortened stable stand from `17.32 s` to `7.86 s`, reduced final tilt
from `3.128 rad` to `0.201 rad`, and improved signed progress from `-0.069 m` to
`0.310 m`. It also introduced two recovery relapses and failed terminal planar
and yaw tracking; degraded-right still ended inverted. This is not a promotable
controller. It proves that rise is a valuable learnable envelope and that
optimizing recovery as an isolated episode would select the wrong result.

The next experiment may therefore train through impulse, capture, and rise, but
it must remain a continuous-Mission experiment:

- early episodes may terminate after `recover` only as curriculum sampling;
- later episodes must continue through traverse and stop without reset;
- the Runtime recovery deadline, target, and stable latch bound authority;
- entering the Task-authored recovery target may receive dense causal credit
  only on the actor-authorized action that enters it;
- relapse, phase timeout, complete-Mission success, and every locked downstream
  gate remain part of the same return and promotion decision.

The word “scenario” here denotes a controlled disturbance or plant variant
inside a complete Mission Case. It is not an independently promotable skill
test. The locked four-Case benchmark is the sole promotion authority.

Edit the isolated workspace directly, then print exactly one proposal object:

```json
{
  "strategy": "short-kebab-case",
  "hypothesis": "Why the bounded source and Policy change should improve a measured complete Mission.",
  "expectedEffect": "Which locked gates should improve without regressions."
}
```
