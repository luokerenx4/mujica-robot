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

### Causal phase contract

Task v8 replaces absolute phase labels with a Runtime-owned causal phase
machine. Each ordered phase owns the active motion command and one typed exit:

- `elapsed` after an authored phase-local duration;
- `external-push-start` when the sampled disturbance actually begins;
- `external-push-end` when that disturbance actually ends;
- `recovery-stable` after the authored recovery target has remained satisfied
  for its full dwell.

Event exits carry a hard phase-local timeout. Reaching a timeout advances the
episode so later mission resumption and safe stop remain observable, but the
transition is recorded as `timedOut: true` and cannot count as satisfying the
phase. This is intentionally not a generic predicate language. The bounded
vocabulary has direct simulator and future device-telemetry meanings.

The active command changes when Runtime enters a phase. A Controller or Policy
receives only that command through the declared Observation ABI; it does not
receive phase id, Scenario id, seed, exit condition, remaining timeout, or
future command. Runtime Events and trajectory rows preserve actual phase
boundaries and transition causes.

The quadruped recovery phase explicitly commands zero motion. Asking the robot
to continue walking while also requiring a low-speed stable-standing dwell is
an internally contradictory test. The causal sequence therefore becomes
`impact end → zero-command stabilization/self-righting → stable dwell →
restore pending forward command`. This makes emergency braking and mission
resumption observable command transitions instead of hiding them inside a
fixed recovery window.

Mission-progression training remains prefix-based, but a Task v8 prefix ends
only after the named phase exits. Every episode still begins at phase one.
Consequently a recovery curriculum must first walk into the sampled impact and
experience its resulting state; it cannot reset into an authored fallen pose.

Task v7 remains readable for immutable historical artifacts. New north-star
Missions use Task v8 so Domain Profile timing randomization cannot disagree
with reward attribution or teach a wall-clock script.

The Runtime records one initial reset and forbids resets inside a Mission Case.
It publishes per-phase duration, health, tracking error, tilt, displacement,
recovery-target occupancy, and actual Controller modes.

### Durable recovery, not terminal-frame luck

Reaching the stable-standing target once is necessary but not sufficient.
Task v8 may declare a `recoveryRelapse` failure envelope with a minimum base
height, maximum yaw-invariant body tilt, and control-grid-aligned dwell. After
the first `robot.self-righted` event, Runtime scans the same uninterrupted
trajectory. A sustained envelope breach emits `robot.recovery-relapsed` and
increments `recoveryRelapseCount`; a shorter excursion is treated as transient
motion rather than a second fall.

The envelope is intentionally hysteretic: its minimum height cannot exceed the
recovery target height and its maximum tilt cannot be tighter than the recovery
target tilt. This separates “qualified as stably recovered” from “physically
failed again.” The integrated Objective gives relapse a score penalty and
locks `maximumRecoveryRelapses: 0`.

Terminal height and tilt remain useful posture evidence, but they no longer
stand in for durable recovery. A Controller that falls early and happens to be
upright at the horizon, or a Policy that falls later and ends mid-rise, is now
judged by the same causal failure event rather than by timing luck.

Authored phase and Controller mode are deliberately different signals. The
phase says what the mission expects; Controller mode says what the robot
actually did. For example, a `resume` phase that still contains `recovery` or
`settling` exposes a late handoff instead of silently shifting the requirement.

Benchmark v2 names a `mission-suite`, its required capability union, and
`resetPolicy: "between-cases"`. Each case is a complete Task v8 episode. The
current locked Suite repeats the full Mission under exact left/right impacts
and degraded left/right plant conditions.

`Task`, `Scenario`, and `Case` have deliberately different meanings:

- the Task owns the complete causal job and its success contract;
- the Scenario owns external plant and disturbance conditions applied while
  that job is running;
- the Case freezes one Task + Scenario + seed witness for reproducibility.

A Scenario is therefore not a walking, collision, or self-righting skill.
Those behaviors are phases of the same Task. Multiple Cases provide
stochastic coverage by repeating the complete job; they do not split the job
into independently promotable episodes.

Atomic walking, impact, recovery, and self-righting Tasks remain executable
unit tests for fault isolation and curriculum design. Their results may route
an Agent toward Controller, Assembly, or Training work, but they cannot keep a
Candidate that fails the integrated Mission Suite.

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

Task v8 additionally permits three sparse, Judge-aligned causal terms:

- a terminal bonus when the `recovery-stable` condition is actually met;
- a terminal penalty when any phase exits by timeout;
- a terminal bonus when the full Mission completes with zero phase timeouts.

Sparse causal terms are attached to the trajectory return even when the
learned residual has no authority on that exact transition step. PPO updates
remain masked to steps where the actor had non-zero authority, so the terminal
signal can assign credit to an earlier learned approach or impact action
without training the Policy on Program-only recovery Actions.

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

## Complete-robot co-design result

The same Mission now judges morphology as well as Controller and Policy work.
This closes an important loophole: a waist may not be selected because it looks
useful in an isolated self-righting reset while making impact entry, recovery
handoff, resumed walking, or braking worse.

The first integrated waist Candidate changed the complete robot from:

| Burden | Selected rigid robot | Proposed articulated robot |
| --- | ---: | ---: |
| Mass | 6.03 kg | 6.23 kg |
| Action width | 12 | 14 |
| Observation width | 145 | 53 |
| Component cost | 6 | 6 |

The smaller proposed Observation is a deliberate trade, not a free
improvement. The Charter caps Observation width at 145, so adding two waist
actuators to the existing four-step raw action history would exceed the
contract. The Candidate removes raw commanded/applied history and retains only
measured actuator-delay state. Studio exposes this burden beside the Candidate
hypothesis.

A neutral-waist comparison on the four-case Mission Suite scored
`38.935033 → -14.293828` (`-53.228861`) and failed recovery in all four cases.
Two governed source experiments then changed waist recovery sequencing:

- experiment `001-e9997df1cda1` reduced Mission violations `44 → 42` and summed
  normalized severity `185.804 → 180.903`, showing that articulation can change
  the mechanical recovery basin, but it introduced isolated recovery,
  joint-limit, and self-contact regressions and was reverted;
- experiment `002-6dae00f711e7` reversed the waist impulse, worsened violations
  `44 → 46` and severity `185.804 → 187.572`, and was also reverted.

The rigid robot therefore remains selected. This is not evidence that a waist
is universally useless. It is evidence that the current split-torso geometry
and borrowed recovery sequence do not compose safely with the complete
Mission. The next morphology experiment must jointly change geometry, contact
workspace, and leg/waist sequencing rather than trying another isolated gain or
sign.

Development Work Order `development-work-order-0ee33d0b4224cd04` now routes the
same locked Mission blockers into three parallel bounded lanes:
complete-design, Controller code, and RL Policy. None may promote from its
local training or diagnostic score.

## Recovery-to-locomotion control result

The continuous Mission exposed a fault that the isolated recovery and
locomotion Skills could not reveal. Every authored planar command is in the
world frame, but the Program Controller resumed its legacy body-forward
locomotion after recovery. Once an impact and self-righting maneuver changed
heading, body-forward was no longer task-forward.

Seven governed Controller experiments tested the handoff without changing the
Task, Scenario, Objective, seeds, gates, or Benchmark:

- holding the last recovery torque through handoff raised violations from
  `26 → 46`; stale recovery torque is not a safe bridge;
- replacing the dynamic recovery tail with immediate standing PD lost the
  transient contact qualification needed to remain upright;
- unconditional world-frame tracking corrected direction but caused a
  mirrored exact-impact yaw regression;
- gain-only yaw changes moved that regression between cases; and
- measured-heading-conditioned handoff preserved the exact-case gates while
  lowering normalized violation severity `71.283 → 59.194`.

The kept experiment `001-950524569565` uses only the observed base quaternion:
after qualified recovery it restores world-frame tracking and selects bounded
yaw authority from the measured handoff heading. It does not branch on hidden
Scenario or seed identity. The locked Suite score improved
`38.935033 → 39.119018` with the same 26 violations and no gate regression,
publishing Robot Revision `quadruped-r-40206836cd00`.

Development Review `development-review-161b2ff0add84e0f` makes the remaining
priority explicit: the two degraded-impact Cases are the top-ranked blockers,
while exact recovery and the atomic self-righting/handoff witnesses remain
passing.

PPO was then rerun on this stronger program prior. Residual scales `0.02`,
`0.01`, and `0.017` all reduced normalized violation severity, but none passed
the lexicographic promotion boundary. The `0.02` Policy improved score and
removed one aggregate violation, then exceeded the right-exact yaw gate by
`0.021 rad/s`. The safer `0.01` and interpolated `0.017` Policies preserved
the gates but did not beat the selected Controller. All three remain immutable
`REVERT` evidence. The result is deliberately asymmetric: ML remains a valid
intervention lane, but a learned layer is not promoted merely because it has
lower training loss or a better non-authoritative aggregate.

## Articulated-waist branch result

The next complete-design audit found that the articulated controller was not
actually comparable with the selected rigid controller: its recovery module
predated dynamic-entry classification, pose reclassification, bounded retries,
retry-only damping, and feedback hold. Earlier waist experiments had therefore
mixed a morphology question with a stale Controller fork.

The parity experiment first restored those causal recovery semantics while
leaving the waist neutral. It reduced the integrated Mission violation count
from `44 → 43` and severity from `186.050 → 182.255`, but regressed one
previously passing exact-impact yaw gate and was reverted. Restricting the
changed damping to post-retry motion removed that collision surface.

Experiment `001-140af53cae12` then added a `0.18 rad` pose-directed waist
moment only during a classified dynamic retry. Across the four complete
no-reset Mission Cases it:

- reduced violations `44 → 41`;
- reduced normalized severity `186.050 → 177.781`;
- recovered forward and signed-forward progress in the left exact impact;
- recovered terminal planar tracking in the right degraded impact; and
- reduced right-degraded disallowed collision steps `3 → 1`.

The aggregate score fell `-14.2938 → -14.7882`, and the robot still did not
self-right successfully. The lexicographic Judge nevertheless kept the change
because three enforced gates moved into the feasible tier and every locked
self-righting, recovery-handoff, and command-tracking regression preserved its
previous state. This is an intermediate branch improvement, published as
Robot Revision `quadruped-r-b1f06e0ffbc8`; it is not a North-Star pass.

The subsequent articulated residual experiments demonstrate why the complete
Mission remains the authority boundary. A learned retry policy could improve
one degraded impact while harming exact-case yaw, and more training never made
a foot reachable from the fully inverted state. Mujica therefore preserves
the Policies and traces as negative evidence but routes the blocker back to
the complete-design lane. ML may optimize a reachable recovery basin; it must
not hide a structural contact-geometry failure behind local reward.

That KEEP also exposed and verified a Harness correction. Development Labs now
publish the exact Lab-judged evidence rather than asking the legacy Candidate
selector to issue a conflicting second verdict. Publication re-evaluates the
committed source and requires byte-matching Benchmark lock, result hashes,
Assembly hash, semantic changes, and source closure before creating a
Revision.

A follow-up reduced the retry moment from `0.18` to `0.10 rad`. It lost the
left-exact yaw-settling gate, moved violations `41 → 42`, increased severity
`177.781 → 180.777`, and reduced aggregate score by another `0.301`. Experiment
`001-31991b52c254` was reverted. The response is therefore not a smooth
“smaller is safer” gain curve: the kept moment appears to cross a discrete
dynamic basin boundary. The next useful intervention should change the
post-retry contact sequence or learn a tightly gated retry residual, not scan
more waist amplitudes without a new causal hypothesis.

## Cross-session morphology result

Four governed complete-design experiments then tested whether a segmented
dorsal rollover keel could create a reachable contact basin. All four were
judged on the same complete no-reset Mission Suite and all were reverted:

- an overlapping two-segment keel did leave the inverted basin, but its
  capsules contacted around the waist and raised violations `41 → 46`;
- the clearance-corrected `0.13 m` profile kept violations at `41`, improved
  severity `177.781 → 168.220`, and improved score by `2.175`, but never made
  a foot reachable and regressed exact/degraded yaw, collision, and atomic
  recovery boundaries;
- a lower `0.10 m` profile was non-monotonically worse at `46` violations and
  `-3.065` score delta;
- restoring the better geometry while raising sagittal recovery damping and
  reducing retry waist magnitude improved score by `2.926`, but raised
  violations `41 → 44` and retained unsafe front/back recovery boundaries.

The rigid selected robot and the previously kept articulated branch therefore
remain unchanged. The useful conclusion is structural rather than promotional:
a narrow dorsal support can escape the `π`-tilt rest basin, but this centered
keel family cannot both create foot support and preserve Mission safety. The
next morphology family must alter lateral bracing/contact pairing or leg reach,
not continue scalar keel sweeps.

Research Lab V2 now supplies every Agent with a bounded, deterministic history
of completed experiments across Sessions. Each entry carries Lab, Program, and
Benchmark-lock comparability flags; numerical score comparisons are valid only
under the same Benchmark lock, while old causal failures remain useful
hypotheses after a Harness relock. The exact compact history and its hash are
stored with each experiment. An Agent may return JSON `null` without changing
source to mark a bounded hypothesis family exhausted. This prevents an
auto-research loop from silently repeating reverted geometry whenever a new
Session is opened.

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

## Durable handoff research result

The post-recovery relapse contract changed the optimization target from
“reached standing once” to “remained physically recovered through the rest of
the job.” Two governed experiments demonstrate how code and ML share that
target without sharing promotion authority.

The Program experiment
`session-f4a4c740cf4ffb50/001-561fad4d8a36` replaced a fixed recovery-to-
locomotion timer with a closed-loop authority integrator. The integrator used
only height, tilt, angular speed, and support contacts. It raised aggregate
score `62.7223 → 68.1143`, reduced violations `43 → 41`, and delayed the first
degraded-right relapse by almost three seconds. It still regressed terminal
tilt and height, so the Judge reverted it.

The Policy experiment
`session-62b5a1eab9d3d22e/001-9d235d259169` trained on complete Mission
episodes with bounded residual authority only after an observable Program
recovery transition. Training score improved substantially over the previous
Policy, but exact-left backward displacement and degraded-right progress, yaw,
and relapse gates regressed. The Judge reverted it as well.

This is the intended auto-research contract:

1. immutable complete-Mission evidence identifies a causal boundary;
2. Program and ML Labs receive separate editable source closures;
3. each Lab may improve its local signal without receiving release authority;
4. gate regressions dominate aggregate reward or score; and
5. rejected code, Policy, training, and A/B trajectories remain inspectable in
   Studio and reproducible through the CLI.

The next learned candidate should add recurrent contact/action history and a
direct causal relapse credit path. It must retain zero authority during
approach, impact, and Program recovery, and it must still be judged on the
same four complete no-reset Cases.
