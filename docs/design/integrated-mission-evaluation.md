# Integrated Mission evaluation

## Decision

Mujica separates robot evidence into three levels:

1. **Skill** — a short, resettable episode used for training, diagnosis, and
   fault isolation.
2. **Mission Case** — one causally continuous episode that composes several
   capabilities without resetting the robot.
3. **Mission Suite** — repeated complete Mission Cases across frozen seeds and
   plant conditions. Only its locked Judge may promote a Candidate.

A Skill score cannot establish end-to-end capability. Training reward cannot
promote a Policy.

## Why the boundary matters

Walking, surviving an impact, self-righting, resuming a command, turning,
traversing laterally, and stopping are coupled by physical state. Contact
history, pose, velocity, Controller state, actuator history, and accumulated
position all cross the boundary between those behaviors. Resetting between
them creates an easier problem and hides failures at the handoff.

Skills remain necessary because a failed eighteen-second Mission does not by
itself explain whether the cause is impact entry, recovery, handoff, tracking,
or braking. The harness therefore keeps local Skills, but removes their
authority to approve a robot.

## Executable contract

Task v7 adds ordered `missionPhases`. Every phase has an authored start time,
intent, and required capabilities. Every motion-command boundary must coincide
with a named phase. The current quadruped Mission is:

| Phase | Time | Intent | Required behavior |
| --- | ---: | --- | --- |
| approach | 0.00–2.50 s | operate | walk under a forward command |
| impact | 2.50–2.66 s | disturbance | absorb a bounded lateral impact |
| recover | 2.66–8.00 s | recover | self-right without resetting |
| resume | 8.00–10.00 s | resume | continue the pending forward mission |
| redirect | 10.00–13.00 s | operate | track forward velocity and yaw |
| traverse | 13.00–16.00 s | operate | switch to lateral motion |
| stop | 16.00–18.00 s | stop | brake and hold |

The Runtime records one initial reset and forbids resets inside a Mission Case.
It publishes per-phase duration, health, tracking error, tilt, displacement,
recovery-target occupancy, and actual Controller modes.

Authored phase and Controller mode are deliberately different signals. The
phase says what the mission expects; Controller mode says what the robot
actually did. For example, a `resume` phase that still contains `recovery` or
`settling` exposes a late handoff instead of silently shifting the requirement.

Benchmark v2 names a `mission-suite`, its required capability union, and
`resetPolicy: "between-cases"`. Each case is a complete Task v7 episode. The
current locked Suite repeats the full Mission under exact left/right impacts
and degraded left/right plant conditions.

## Training contract

Training v3 defines a Mission progression around one integrated Task and one
Scenario family. Every episode begins at the authored Mission start. A stage
may stop after a named phase, but it cannot jump into a synthetic state,
reorder phases, or shorten a later stage. The final stage must include the
complete Mission and its cumulative step boundary must equal the Training
budget.

The current progression is:

- through `redirect` under an exact plant, retaining the causal chain
  `approach → impact → recover → resume → redirect` and enough post-handoff
  time for the learned residual to receive authority;
- through the final `stop` phase under that exact plant;
- through the final `stop` phase under randomized mass, damping, actuator
  strength, friction, sensing, delay, impact time, force, and direction.

Stage-specific Domain Profiles alter training data difficulty, not the locked
Judge. Each episode records its stage, full Task identity, Scenario, effective
end time, Domain Profile, parameters, and global step interval. Atomic
self-righting and command Tasks remain useful diagnostic probes but are no
longer sampled by the main Policy training loop.

### Phase-conditioned credit assignment

Continuous Missions require phase-local reward geometry. For Task v7, the
Runtime resets the lateral-displacement reference at each authored phase
boundary. Otherwise displacement that was correct during `approach` becomes a
false lateral-drift penalty when `traverse` changes the commanded direction.
Legacy atomic Tasks retain their episode-start reference.

Training may add a bounded `missionReward` with three explicit terms:

- signed command-direction progress for active `operate` and `resume` phases;
- velocity tracking for those commanded-motion phases;
- zero-command stability during `stop`.

The extra terms are applied only while the learned actor has non-zero
authority. They do not reward the Policy for recovery work performed entirely
by the Program Controller, and they do not change Benchmark scores or gates.
The frozen Policy records, per Mission phase, step exposure, active-actor
fraction, effective residual authority, signed progress, base reward, shaped
reward, quality penalty, and final learning reward.

Legacy Training v2 still supports `episode-probability` and `step-share` for
reproducing existing Policies. It is not the main integrated-robot
development contract. Training v3 advances monotonically by cumulative global
steps and only switches stages at safe episode boundaries, so it never
interrupts a physical trajectory. Frozen evidence records scheduled and
observed boundaries instead of presenting desired weights as experience.

## First measured result

Training `training-d153cd89a44e2381` produced Policy
`integrated-resilience-curriculum-c811d76190c264d3` from 8,192 steps:

- Skill exposure: 450 steps, 1/1 completed episodes;
- Mission exposure: 7,742 steps, 8/9 completed episodes;
- mean residual action authority: 8.7%;
- nine continuously varied domain dimensions.

The locked Mission Suite rejected it:

- baseline aggregate: `38.935033`;
- Candidate aggregate: `38.859847`;
- delta: `-0.075186`;
- gate violations: `26 → 26`;
- verdict: `REVERT`.

Exact impacts still lead to negative post-recovery mission progress. Both
degraded impacts still fail self-righting and terminal posture gates. This is
useful negative evidence: mixed data exposure alone is insufficient. The next
ML experiment must improve the reward/credit assignment around recovery
completion and downstream signed task progress, then win the same locked
Mission Suite.

The next implementation keeps that negative Policy and verdict immutable. It
adds phase-local reward references and authority-gated Mission shaping, then
trains new content-addressed Policies. No reward increase can promote a Policy:
the unchanged Mission Suite remains the only promotion boundary.

## Phase-conditioned experiment result

Three 8,192-step seeds and one 32,768-step run were trained with identical
reward weights. Their locked Mission-Suite scores were:

| Policy | Seed / steps | Score |
| --- | ---: | ---: |
| `integrated-resilience-curriculum-08ecc97b4a83b22f` | 260726 / 8,192 | 38.893505 |
| `integrated-resilience-curriculum-3b517fde5fe26c7b` | 260727 / 8,192 | 38.853113 |
| `integrated-resilience-curriculum-2aae7945a770fa6d` | 260728 / 8,192 | 38.871558 |
| `integrated-resilience-curriculum-0098773f246c8f49` | 260726 / 32,768 | 38.637973 |

The best new Policy was still rejected against baseline `38.935033` with delta
`-0.041528`. Exact cases self-right but retain negative signed Mission
progress. Degraded cases still fail recovery and terminal posture. The longer
run reduced the magnitude of exact-case backward progress but did not improve
degraded recovery, and its larger frozen training budget incurred the locked
complexity cost.

The new diagnostics explain a second bottleneck: Policy authority is sparse
and outcome-dependent. In the selected seed it was absent during approach and
impact, effectively absent during recovery, and active on only 11.1% of
`resume`, 19.5% of `redirect`, 12.5% of `traverse`, and 24.0% of `stop`
samples. Another seed received no Mission-phase authority at all. Additional
PPO steps alone therefore repeat mostly Program-only experience. The next
experiment should change the handoff/data curriculum or the Controller
boundary, not merely increase the budget or weaken the Judge.

The next bounded change replaces the disconnected Skill/Mission sampler with
the governed Mission progression above. The first measured 10-second prefix
ended at the start of `redirect` and exposed zero actor-authority steps because
the supervisor was still settling. The governed stage therefore extends
through `redirect` to 13 seconds. This changes data availability, not the
authority gate: impact entry, recovery, and settling remain Program-only. Its
hypothesis is that exact complete causal prefixes will produce post-recovery
actor data before the final randomized stage, while every sample still
contains the approach and impact states that caused the recovery.

## Mission-progression experiment result

The first 10-second prefix reached the authored `resume` phase but exposed
zero actor-authority steps: the Program supervisor remained in recovery or
settling until after that boundary. Extending the first stage through
`redirect` and aligning its boundary to four complete 13-second episodes
produced the intended evidence:

- exact causal-prefix actor fraction: `21.5%`;
- exact complete-Mission actor fraction: `43.3%`;
- randomized complete-Mission actor fraction: `0.0%`, `9.6%`, and `12.4%`
  across three seeds.

The locked Mission-Suite results were:

| Policy | Seed / steps | Score |
| --- | ---: | ---: |
| `integrated-resilience-curriculum-2cb0c34f14903dd2` | 260736 / 8,192 | 38.863401 |
| `integrated-resilience-curriculum-3bd389ded6b6e380` | 260737 / 8,192 | 38.867625 |
| `integrated-resilience-curriculum-d1b4e9d8e61cb107` | 260738 / 8,192 | 38.853282 |

The selected seed is still `REVERT`: baseline `38.935033`, proposed
`38.867625`, delta `-0.067408`. Exact Missions self-right but move opposite
the requested direction after handoff; degraded Missions still fail recovery.
The main architectural gain is therefore trustworthy continuous data and
credit-assignment evidence, not a promoted Controller. The next optimization
must address negative `redirect` progress and broaden successful recovery
basins before increasing PPO budget.

## HCI

Studio renders a `Continuous Mission · one Episode, no reset` panel above the
synchronized A/B replay. A phase row seeks directly to its start time and shows
expected task intent beside actual Controller modes. The Policy panel exposes
Skill/Mission step counts, residual authority, domain coverage, lineage, and
the bound Candidate. New Policies additionally expose per-phase signed
progress, actor exposure, and base/shaped/learning reward so a human and Coding
Agent can distinguish “not trained here” from “trained here and got worse.”
For Training v3 it displays the stage's terminal phase, scheduled and observed
global-step interval, episode duration, Domain Profile, actor fraction, and
phase-local learning evidence.

`Copy Mission context for Agent` exports the frozen phase measurements and
exact headless reproduction command. Its authority boundary is explicit:
Skills train and diagnose, a Mission Case witnesses end-to-end behavior, and
the locked Mission Suite alone decides promotion.
