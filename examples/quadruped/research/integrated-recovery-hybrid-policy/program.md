# Integrated Mission code and RL recovery research

Improve recovery inside the complete eighteen-second no-reset Mission. Every
training episode starts at `approach`, experiences the authored impact, and
continues through recovery and later mission commands. A phase prefix may end
an early curriculum episode, but it may not synthesize an isolated fallen
state or reset between walking, impact, and recovery.

This Lab deliberately divides authority by mechanism:

- Program code owns fall detection, impulse, capture, rise, retries, handoff,
  locomotion, and every state outside the declared recovery-settle envelope.
- PPO may add at most a four-percent residual only while the Program prior
  reports the initial dynamic right-side recovery before any retry, at least
  two supporting feet, base height at least 0.25 m, and body tilt at most
  0.8 rad. The observed pose and state envelope, rather than Scenario identity
  or a wall-clock phase label, control authority.
- Missing, non-finite, mistyped, or out-of-envelope telemetry fails closed to
  zero learned authority.

The source hypothesis is based on four locked Controller experiments. Early
capture of the initial degraded side fall reached an upright basin but caused
a continuing recovery limit cycle. Restricting that structural intervention
to retry zero protects the opposing degraded retry path. The learned residual
is responsible only for damping the reachable near-upright state; it may not
replace the recovery state machine.

Training focuses on repeated full left-degraded Missions and then continuous
domain randomization around that failure. It never starts from a synthesized
fallen pose. The other three exact/degraded directions remain unseen release
evidence. The locked four-case Mission Suite, plus static self-righting,
handoff, tracking, and transition regressions, alone decides promotion.
Training reward and an isolated Skill score are never release evidence.

Edit the isolated workspace directly, then print exactly one proposal object:

```json
{
  "strategy": "short-kebab-case",
  "hypothesis": "Why the bounded code and Policy combination should improve a measured complete Mission.",
  "expectedEffect": "Which locked Mission gates should improve without regressions."
}
```
