# Causal continuous Mission graph

Status: active

## Outcome

Each integrated robot-development episode is one causally continuous Mission:
the robot begins its assigned job, encounters a seeded disturbance while
operating, detects and resolves the resulting recovery condition, resumes the
pending job, executes later command changes, and stops without a physical
reset.

The same event-derived phase trace drives Runtime control intent, RL reward
attribution, Judge metrics, immutable Run Events, CLI evidence, and the Studio
timeline.

## Context

Task v7 removed physical resets between walking, impact, recovery, resume,
redirection, traversal, and stopping. It still assigns those meanings using
fixed wall-clock timestamps. Domain randomization moves impact time by up to
`0.3 s` without moving the authored `impact` and `recover` labels, so training
can receive reward under the wrong causal phase and a Controller or Policy can
learn the mission clock.

Atomic walking, impact, and self-righting probes remain useful for fault
isolation. They are not complete-robot training or release authority.

## Scope

In scope:

- a typed event-driven integrated Mission Task;
- phase-owned motion commands;
- transitions on elapsed phase time, disturbance start/end, and stable
  recovery;
- bounded event timeouts that advance the Mission while recording failure;
- dynamic Mission prefixes for RL curriculum without mid-Mission resets;
- actual phase/command traces in metrics, Events, CLI evidence, and Studio;
- migration of the quadruped north-star Mission, Training definitions, and
  locked Mission Suite.

Out of scope:

- a generic expression language or arbitrary workflow graph;
- branching on Scenario id, seed, Objective, or future events inside a
  Controller or Policy;
- treating one stochastic trajectory as sufficient release coverage;
- removing atomic capability probes used for diagnosis and regressions;
- rewriting immutable historical Runs or Policies.

## Acceptance

- A randomized push changes the observed `approach → impact → recover`
  transition times in the authoritative trajectory.
- `recover → resume` occurs only after the robot satisfies the authored stable
  standing dwell, or after an explicit timeout recorded as such.
- Commands change on observed phase entry, not on the old absolute Mission
  timestamps.
- Every RL episode starts at phase one. A curriculum prefix stops only after
  the named phase exits; it never resets into a later phase.
- The Mission Suite still resets only between complete cases and remains the
  only promotion authority.
- Run metrics preserve authored exit contracts, actual start/end times,
  transition causes, timeout status, and phase-local measurements.
- Studio renders the actual causal timeline and distinguishes condition-met
  transitions from timeouts.
- Project validation, Assembly compilation, affected Runtime tests, and the
  full test suite pass.

## Work

- [x] Audit Task v7, Domain Profile sampling, Runtime phase attribution, RL
  progression, Judge metrics, and Studio projection.
- [x] Bound the typed Mission transition vocabulary.
- [x] Implement Task v8 and one Runtime-owned causal phase machine.
- [x] Support dynamic Mission prefixes and actual command-response metrics.
- [x] Migrate the quadruped north-star Mission and retrain/judge the current
  articulated development branch.
- [x] Project causal phase evidence into Studio and CLI.
- [ ] Validate, regenerate governed artifacts, commit, and push.

## Decision rule

Scenario and Domain Profile select the external operating condition. Task owns
the required causal job. Runtime alone advances the Mission from deployable
state and environment events. Controllers and Policies observe only their
declared Observation ABI and cannot receive phase id, Scenario id, seed,
timeout budget, or future transition information.

Timeout is evidence of an unmet condition, not success. It permits the
remainder of a complete Mission to run so downstream behavior and safe stop
remain observable, while the Judge records the failed phase.

## Findings and decisions

- “One integrated test” means a Suite of several complete, no-reset Mission
  Cases. Multiple complete episodes are required for stochastic coverage;
  splitting capabilities into separate episode starts is not.
- Fixed-duration operate phases are still legitimate requirements. The error
  is assigning impact and recovery semantics by absolute wall-clock time when
  the triggering event and robot state are observable.
- A deliberately small transition vocabulary is easier to validate, replay,
  and eventually map to hardware telemetry than a user-authored predicate
  language.
- A capability probe may still start from a fallen pose, but it is diagnostic
  evidence only. Policy selection and robot release remain governed by a
  Suite whose every Case executes the complete causal Mission.
- RL curriculum stages are prefixes of that same Mission. They always begin at
  `approach` and stop after an authored phase exits; they cannot teleport into
  `recover` or `resume`.

## Progress log

- 2026-07-25: Confirmed that the current 18-second Task v7 is physically
  continuous but clock-labelled. Its randomized profile moves push time,
  force, direction, plant mass, damping, strength, friction, noise, and delay;
  phase timestamps remain fixed and can disagree with the sampled event.
- 2026-07-25: Selected phase-local commands plus four typed exits:
  `elapsed`, `external-push-start`, `external-push-end`, and
  `recovery-stable`. Event exits require a hard timeout and immutable timeout
  evidence.
- 2026-07-25: The first exact Mission proved why recovery exit must include
  the full dwell rather than reuse the old time-to-entry gate: the baseline
  entered the stable target near `5.5 s` but could not accumulate the required
  `0.5 s` before a `5.5 s` phase timeout. The causal contract now allows
  `6.0 s`; its maximum phase path still fits the `20 s` hard episode ceiling.
- 2026-07-25: The first articulated causal replay exposed a Task contradiction:
  `recover` still commanded `0.2 m/s` while stable recovery required linear
  speed at or below `0.2 m/s`. The impact-resistant robot never needed its
  self-righting mode and oscillated across the threshold until timeout.
  Recovery now commands zero motion, then restores the pending forward command
  only after the stable dwell.
- 2026-07-25: With that contract, the articulated brace Controller completed
  both exact-impact Missions without a phase timeout and reached stable
  recovery in `0.54 s`; the rigid baseline timed out in all four Cases. The
  exact articulated Cases still produced negative signed Mission progress,
  so the branch remains development evidence rather than a releasable robot.
- 2026-07-25: The first two causal residual Policies were rejected. Adding
  sparse rewards for recovery success, phase timeout, and timeout-free Mission
  completion improved the later Policy to a positive aggregate score, but it
  still lost to the deterministic articulated Controller and timed out on
  degraded Cases.
- 2026-07-25: Phase-local evidence isolated the next defect: after an exact
  impact the robot stabilized without entering self-righting mode, then a
  `zero → forward` edge remained in a permanent transition gait and moved
  backward. The Controller now recognizes that deployable command edge as a
  fresh locomotion bout and exposes `commandRestartCount`; this reduced exact
  resume backward displacement from about `0.099 m` to `0.043 m`, but did not
  satisfy the end-to-end Mission gate.
- 2026-07-25: Studio now renders the actual Runtime-owned Mission stages,
  transition causes, condition-met versus timeout status, and complete replay
  lengths. Its default A/B witness compares the stronger deterministic brace
  Controller (`685` frames) with the rejected causal ML Policy (`928` frames);
  selecting that Policy also exposes the exact Mission-prefix training
  progression.
