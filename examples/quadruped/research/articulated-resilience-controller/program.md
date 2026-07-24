# Articulated delay-resilience Controller research

Improve `resilient-command-conditioned-waist-3dof` with
`articulated-behavior-supervisor` on the locked
`integrated-resilience-mission`.

Every primary Case is one causal, no-reset job:

`approach → impact → recover → resume → redirect → traverse → stop`.

Scenario selects plant and disturbance conditions for that complete job. It
does not select a Controller branch and it does not define a separately
promotable skill. Controller source may read only the declared Observation
ABI; never read Scenario id, seed, Mission phase id, a future command, or a
timeout budget.

## Current evidence

The exact impact Cases recover without a Mission timeout but make negative
signed downstream progress. Both degraded Cases time out during recovery. The
worst Case is `impact-left-degraded`, whose one-step actuator delay causes the
robot to move backward before the lateral impact:

- nominal, low-friction, and payload-only forward probes remain upright and
  move forward;
- the one-step-delay probe moves backward and eventually enters recovery;
- widening the delay-one measured-progress classifier improved some local
  posture and recovery outcomes but used unsafe sagittal authority, added
  collisions, and still failed the complete Mission;
- isolated phase-lead, startup-ramp, and phase-direction probes did not pass
  the complete Case.

This ordering is authoritative: improve causal impact entry before spending
more recovery or PPO budget. Do not repeat a rejected scalar probe under a new
name.

## Bounded intervention surface

Prefer one deployable mechanism per experiment:

- measured command-progress versus base-progress state for delay one or two;
- delay-indexed gait timing that is scoped to a fresh longitudinal bout;
- bounded low-delay sagittal authority distinct from the three-step
  contact-loss response;
- measured pitch, yaw-rate, and lateral-state feedback during impact entry;
- explicit release of traction/recovery state across zero-command recovery
  and the observable zero-to-forward resume edge.

Any new state must reset from observable command boundaries and be exposed in
Controller telemetry. It must behave identically in MuJoCo and a hardware
driver that supplies the same Observation ABI.

The locked Mission Judge decides KEEP/REVERT. Then run
`self-righting-morphology-v2`, `recovery-handoff`, `command-tracking`,
`command-transitions`, and `spatial-robustness`. Aggregate score cannot pay for
a new fall, timeout, backward-progress gate, collision, joint-limit violation,
or command regression.

Edit only the declared Controller closure and print exactly one proposal:

```json
{
  "strategy": "short-kebab-case",
  "hypothesis": "Why one observable bounded Controller mechanism should improve the measured complete Mission.",
  "expectedEffect": "Which locked gates should improve without regressions."
}
```
