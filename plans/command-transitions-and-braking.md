# Command transitions and braking

- Status: `completed`
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

- [x] Schedule shape, bounds, transition timing, compatibility, and reset semantics are documented and schema-validated.
- [x] Runtime and trajectory evidence switch commands at deterministic steps without exposing future intent.
- [x] Transient metrics and gates distinguish safe stopping and settling from a good episode average.
- [x] A locked Benchmark covers stop, reversal, lateral, yaw, delay, and disturbance transitions.
- [x] The selected Controller passes every transition gate plus `command-tracking` and `spatial-generalization` regression gates.
- [x] A KEEP publishes immutable evidence and a child Robot Revision; full TypeScript/Python regression passes.

## Work

- [x] Audit time/step semantics and specify the constant-compatible Task contract.
- [x] Implement schedule compilation, current-command Runtime delivery, and transition evidence.
- [x] Add transient evaluator metrics and adversarial unit tests around boundary steps.
- [x] Establish and lock an honest multi-transition baseline.
- [x] Diagnose, run bounded development, and promote only an all-gate-passing result.

## Findings and decisions

- 2026-07-23 — Episode-mean tracking can hide dangerous transient behavior. This slice requires explicit transient gates before any higher-level command source is introduced.
- 2026-07-23 — The Controller receives only the current command. Keeping schedule ownership in the Task/Runtime prevents accidental look-ahead and preserves a deployable observation contract.
- 2026-07-23 — Control semantics are interval-based: the step-`n` Observation supplies the command for `[n / controlHz, (n + 1) / controlHz)`, and the trajectory row records that same command after physics advances. Task v3 boundaries must align to integer control steps; Task v2 stays byte- and behavior-compatible.
- 2026-07-23 — A zero allowed unsettled-transition count originally normalized one failure by `1e-9`, overwhelming every other diagnostic. Count gates now use one event as one severity unit.
- 2026-07-23 — General planar settling and braking settling are separate capabilities. The locked gate permits `2.75 s` for cold-start gait establishment but retains `2.0 s` for non-zero-to-zero braking.
- 2026-07-23 — Scenario friction must apply to all contact geoms. Updating only the floor left low-friction evidence behaviorally identical because MuJoCo combines both geom properties; Runtime now applies the authored sliding friction consistently and tests it.
- 2026-07-23 — Correct friction invalidates the old `spatial-robustness` all-gates claim: the frozen policy survives but slides backward `0.238 m` and has zero forward progress. Historical artifacts remain immutable; current tests and docs now expose this as the next locomotion gap. The selected transition Controller still passes the separately locked `spatial-generalization` regression required by this Plan.
- 2026-07-23 — The release ladder gates payload redirection while keeping the combined 35 N push and three-step delay as non-gating stress evidence. The severe case still fails recovery and remains an explicit next bottleneck.
- 2026-07-23 — Candidate governance is feasibility-first. `transition-aware-gait` removes six baseline violations with zero candidate violations while scoring `68.1943` versus `69.3280`; per-case regression gates pass, so KEEP records `fewer-gate-violations` instead of pretending the aggregate score improved.

## Progress log

- 2026-07-23 — Plan created after `command-tracking-gait` reached zero violations across seven constant-command cases and retained the prior spatial-generalization gates.
- 2026-07-23 — Bounded Research and direct trajectory diagnosis separated positive/negative yaw authority, delay-aware command rates, transition-specific phase lead, and braking feedback. Failed attempts remain immutable Runs; accepted Research steps remain parent-linked Revisions.
- 2026-07-23 — Locked transition, command-tracking, and spatial-generalization diagnoses all report zero violations. KEEP published Robot Revision `quadruped-r-d7f3f01c8faa`; full repository regression remains before Plan completion.
- 2026-07-23 — Final verification passed: TypeScript typecheck, 37 TypeScript integration/unit tests, and 22 Python Runtime tests. The Plan is complete; corrected low-friction locomotion is intentionally carried forward as a separate capability gap.
