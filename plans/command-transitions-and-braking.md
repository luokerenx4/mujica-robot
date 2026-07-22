# Command transitions and braking

- Status: `active`
- Updated: `2026-07-23`
- Related design: [Motion command contract](../docs/design/motion-command-contract.md)

## Outcome

Mujica can develop and test a quadruped against a bounded sequence of motion commands inside one episode. The Runtime changes the Controller's current command at exact declared times, evidence preserves both the requested and measured transition, and locked gates judge braking, reversal, lateral redirection, yaw changes, and recovery under delay. Constant-command Tasks remain valid and behaviorally unchanged.

## Context

The completed command-conditioned controller passes seven locked cases, but every case holds one command from reset to termination. That proves steady episode-level behavior, not that the robot can stop after walking, reverse without falling, or settle after a turn command changes. Those transients are the next capability bottleneck and must become executable before navigation or higher-level behavior can safely depend on this Controller.

## Scope

### In scope

- Add the smallest schema-validated command schedule with bounded segment count, monotonic transition times, explicit frame/units, and constant-command compatibility.
- Expose only the current command to the Controller; future schedule entries must not leak through the Observation ABI.
- Record requested and measured motion at every step and derive deterministic transient metrics such as terminal speed, peak error, overshoot, and settling time.
- Lock a transition Benchmark covering accelerate/stop, forward/reverse, lateral redirection, and yaw changes, including actuator delay and one disturbed case.
- Develop the existing analytic command Controller through a bounded, evidence-led surface and retain both completed command-tracking and spatial-generalization gates.

### Out of scope

- Navigation, path planning, perception, terrain anticipation, or behavior trees.
- Unbounded command streaming from a network or operator.
- Previewing future commands in the Controller.
- Treating simulator transition evidence as hardware braking certification.
- Weakening any completed steady-state or spatial robustness gate.

## Acceptance

- [ ] Schedule shape, bounds, transition timing, compatibility, and reset semantics are documented and schema-validated.
- [ ] Runtime and trajectory evidence switch commands at deterministic steps without exposing future intent.
- [ ] Transient metrics and gates distinguish safe stopping and settling from a good episode average.
- [ ] A locked Benchmark covers stop, reversal, lateral, yaw, delay, and disturbance transitions.
- [ ] The selected Controller passes every transition gate plus `command-tracking` and `spatial-generalization` regression gates.
- [ ] A KEEP publishes immutable evidence and a child Robot Revision; full TypeScript/Python regression passes.

## Work

- [ ] Audit time/step semantics and specify the constant-compatible Task contract.
- [ ] Implement schedule compilation, current-command Runtime delivery, and transition evidence.
- [ ] Add transient evaluator metrics and adversarial unit tests around boundary steps.
- [ ] Establish and lock an honest multi-transition baseline.
- [ ] Diagnose, run bounded development, and promote only an all-gate-passing result.

## Findings and decisions

- 2026-07-23 — Episode-mean tracking can hide dangerous transient behavior. This slice requires explicit transient gates before any higher-level command source is introduced.
- 2026-07-23 — The Controller receives only the current command. Keeping schedule ownership in the Task/Runtime prevents accidental look-ahead and preserves a deployable observation contract.

## Progress log

- 2026-07-23 — Plan created after `command-tracking-gait` reached zero violations across seven constant-command cases and retained the prior spatial-generalization gates.
