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

Task v8 additionally permits four sparse, Judge-aligned causal terms:

- a terminal bonus when the `recovery-stable` condition is actually met;
- a penalty when a physically completed recovery later enters the relapse
  envelope;
- a terminal penalty when any phase exits by timeout;
- a terminal bonus when the full Mission completes with zero phase timeouts.

Sparse causal terms are attached to the trajectory return even when the
learned residual has no authority on that exact transition step. PPO updates
remain masked to steps where the actor had non-zero authority, so the terminal
signal can assign credit to an earlier learned approach or impact action
without training the Policy on Program-only recovery Actions.

Dense command/recovery shaping is applied only while the learned actor has
non-zero authority. Recovery shaping may include `taskTargetEntry`: a bounded
bonus on the actor-authorized action whose resulting state first satisfies the
Task-authored recovery target. The authority gate observes that target before
the next action and fails closed, so the Policy cannot farm target occupancy.
It may also include `taskTargetProgress`, the geometric conjunction of smooth
height, yaw-invariant tilt, linear-speed, and angular-speed components derived
from that same Task target. Independent posture terms can all look locally
good while one required physical dimension still fails; conjunction makes that
missing dimension suppress the dense signal without changing the target or the
Policy Observation ABI.
Sparse Mission outcomes remain in the return for earlier causal credit. None
of these terms change Benchmark scores or gates.
The frozen Policy records, per Mission phase, step exposure, active-actor
fraction, effective residual authority, signed progress, base reward, shaped
reward, quality penalty, and final learning reward.

Frozen training evidence also records a Mission outcome ledger keyed by
curriculum stage and Scenario. Each row counts episode completion, total and
actor-caused recovery-target entries, stable-recovery transitions, relapse,
deadline expiry, phase timeout, and timeout-free full-Mission completion.
Scenario remains a disturbance/plant label inside the continuous task. The
ledger is a directional diagnostic for humans and Agents; it does not create
separate promotion authority for walking, impact response, or self-righting.

PPO rollout actions are sampled from the learned distribution. Those rows are
therefore labelled stochastic exploration evidence, not proof that the frozen
Policy can reproduce the result. At the end of Training v3, the Harness runs
one evaluation-only episode for every progression-stage × Scenario pair using
the frozen actor mean, frozen observation normalizer, identical Program prior,
and reproducibly sampled Domain Profile. The resulting
`deterministicMissionProbe` is stored beside the rollout ledger. Probe steps do
not update weights or normalization statistics and are not charged to the
declared Training budget. This probe is a deployability diagnostic below the
locked Mission Suite Judge; it does not promote a Policy.

Training may optionally enable bounded `eliteReplay` consolidation. The only
supported trigger is an actor-authorized transition into the Task-authored
recovery target. Mujica retains a bounded tail of the raw observations and
sampled residual actions that causally preceded the first such entry in an
episode, then adds a small behavior-cloning loss during later PPO updates so
exploration-only behavior can move into the actor mean. The buffer has explicit
tail, capacity, minibatch, coefficient, and stage-scope limits. It never admits
physical target crossings caused only by the Program, never expands Policy
authority, never adds Training steps, and never changes promotion authority.

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

## Online relapse credit and bounded history result

Training and judging now share one `RecoveryRelapseTracker`. The Runtime arms
it from the first Task `recover` phase, records the first stable self-right
even when that phase has already timed out, and emits a one-step
`recoveryRelapseEntered` signal only after the Task's physical height/tilt
failure envelope has remained breached for its declared dwell. Training v3
accepts `missionReward.recoveryRelapsePenalty`; the sparse penalty is delayed
credit, so it does not grant action authority at the failure step. The existing
residual mask still decides which earlier Policy actions receive PPO updates.

The articulated history Assembly is a new sibling,
`resilient-command-conditioned-waist-history-3dof`. It leaves the accepted
53-value Assembly immutable and adds a bounded four-frame sequence:

- 14 commanded actuator values;
- 14 applied actuator values after delay; and
- four foot-contact forces.

A multi-channel GRU consumes those three sequences and removes them from the
instantaneous MLP input. Old two-channel history Policy architectures remain
loadable.

Sessions `session-477fd558fc2f3980` and `session-08401dde948f1149` tested the
new state/credit contract for `32,768` complete-Mission steps. Both candidates
improved over the previous Policy head but were reverted:

- direct relapse credit plus history improved score `34.4350 → 40.8961` and
  violations `48 → 45`, but both degraded Cases avoided relapse credit by
  failing to complete stable self-righting;
- additionally requiring Program telemetry `recoveryCompleted=true` improved
  score `34.4350 → 40.7389` and violations `48 → 47`, but that Program flag
  precedes the Task's required `0.5 s` stable-recovery dwell and still allowed
  the residual to prevent the authoritative self-right event.

The comparison also found an Observation-ABI defect: adding unused noisy
history channels advanced the shared sensor-noise RNG and changed later
real-time foot-force observations. History channels now use an independent,
seeded noise stream; a locked test proves every pre-existing noisy observation
is byte-equivalent with and without the sibling history component under the
same seed and actions. The two experiments remain valid negative Harness
evidence, but they are not treated as a clean verdict on recurrent state.

The next learned lane must gate on a declared Runtime recovery-stable latch
whose semantics are identical to the Task/Judge dwell, not on an earlier
Controller-private completion flag. That is a state/authority contract change,
not another scalar threshold sweep.

## Task-authoritative recovery state and authority experiments

The Runtime now exposes the recovery contract through an explicit zero-mass
`mission-state-input` Component. Its Observation channels are typed
`runtime-state`, receive no synthetic sensor noise, and are derived only from
the active Task:

- `recovery-target-satisfied` is the instantaneous height, yaw-invariant tilt,
  linear-speed, and angular-speed predicate;
- `recovery-stable-progress` is the uninterrupted dwell fraction;
- `recovery-stable-latched` becomes one only when the full dwell completes
  before the causal recovery exit; and
- `recovery-deadline-expired` becomes one when that exit times out.

Success and deadline are separate, irreversible facts. A late self-right may
still be recorded for physical diagnosis and relapse tracking, but it cannot
rewrite the timed-out Mission transition or create a successful Runtime latch.

Program-residual gates may require scalar Runtime observations, restrict
enumerated Program telemetry such as recovery sub-phases, and declare
`entryRampSeconds`. Gate entry rises at a bounded rate in both Training and
frozen-Policy inference; any missing state, envelope exit, or disallowed mode
still drops authority to zero immediately. Studio shows instantaneous target,
dwell progress, success latch, deadline latch, gate target, and applied gate
scale on the synchronized A/B clock.

Four governed experiments tested the resulting boundary:

- `session-d29504dd2bf322d6` required the success latch for the learned
  post-recovery suffix. Score improved `34.4350 → 59.8346` and violations
  `48 → 43`, but the Candidate was behaviorally the Program fallback in the
  degraded Cases: both had already timed out, so the learned suffix correctly
  received no authority. It did not lexicographically beat the reference.
- `session-05c346ca1e4b2fa5` trained a history-aware recovery residual that
  released authority inside the physical target. A stateless `0.3 rad` gate
  chattered between zero and full authority and the Policy drove
  degraded-right from a recoverable rise back into inversion. Score fell
  `62.7223 → 40.0909`; verdict `REVERT`.
- `session-0ad2f2c3b560afab` restricted ML to Program impulse/capture and
  ramped each entry over `0.4 s`. It restored degraded-right self-righting,
  improved violations `43 → 41` and severity `87.786 → 84.010`, and moved the
  first relapse later. The recovery phase had already timed out, however, so
  no success latch existed; ML reactivated on a later fall and regressed final
  height. Verdict `REVERT`.
- `session-199eb99ac9e80c72` added the deadline latch but also changed the
  Policy input ABI and therefore retrained the network. Its regression
  (`62.7223 → 40.1174`) cannot isolate the gate effect. Verdict `REVERT`.

The last result establishes a Harness requirement: authority changes need a
frozen-weight counterfactual lane. Mujica must be able to preserve model
weights, normalizer, plant, Task, Scenario, and seed while changing only a
typed, auditable gate. Retraining after an ABI change answers a different
question and must not be presented as causal evidence about the gate.

## Frozen-weight authority counterfactual

The counterfactual lane makes that requirement executable. A typed Authority
Profile may override only
`architecture.actionTransform.residualGate`; Policy model bytes, normalizer,
the rest of the architecture, Assembly execution, plant, Task, Scenario, seed,
and between-case reset policy are invariants. Baseline and candidate both
produce normal immutable Simulation Runs. A content-addressed evaluation binds
the two Run sets and classifies the observed behavior as `EQUIVALENT`,
`IMPROVED`, `DEGRADED`, or `MIXED`.

Safety-supervisor facts no longer need to be neural inputs. A residual gate may
use `requiredRuntimeState`, populated by the same Task-owned recovery target,
stable dwell, success latch, and deadline latch used by the Mission Runtime.
That state is supplied out-of-band immediately before each frozen-Policy
action. Missing or mismatched state drops residual authority to zero, while
moving an existing predicate from Observation to Runtime state can be checked
for exact behavioral equivalence without retraining.

The artifact makes a causal claim only about residual authority. It never
publishes a promotion verdict, and Studio labels visual interpretation as a
hypothesis. Robot release remains subordinate to the complete locked Mission
Judge.

The first governed uses of this lane preserved the same 65,536-step Policy:

- `authority-counterfactual-13fefce43e04ed0b` moved the deadline predicate
  from `requiredObservation` to `requiredRuntimeState`. Every complete-Mission
  metric and score was byte-equivalent, validating the out-of-band supervisor
  contract.
- `authority-counterfactual-7a10e0e7af3e1776` removed only the deadline
  predicate. Degraded-right residual authority increased `0.52 → 1.90 s`;
  locked violation count remained `45`, severity improved
  `112.925 → 105.211`, and aggregate score moved `40.1174 → 40.0466`. The
  result is causally `IMPROVED` inside the same infeasible tier, with
  `promotionVerdict: null`.

The experiment therefore answers the narrow gate question without claiming a
successful robot: deadline reactivation can reduce violation severity for the
frozen network, but it neither clears the Mission gates nor improves aggregate
score.

## Target-seeking rise: combined Mission verdict

`authority-counterfactual-7a106315bc7d4e55` extended the frozen Policy through
Program rise. Degraded-left changed from terminal inversion to successful
self-righting, reached stable stand at `7.86 s` instead of `17.32 s`, and
improved signed progress from `-0.069 m` to `0.310 m`. The same change also
introduced two recovery relapses and failed downstream planar/yaw transition
gates; degraded-right remained inverted. This is the measured example of why
walking, collision response, recovery, and resumption cannot be independently
promoted.

Session `session-9e9d909f7dc6bfdb` then trained the exact pre-deadline
impulse/capture/rise authority envelope for `65,536` steps. The progression
used `32,984` recovery-prefix samples for efficient skill acquisition, then
`32,552` complete-Mission samples across exact and randomized plants. Every
episode still began at approach and experienced the authored impact; no fallen
state was synthesized.

The new `taskTargetEntry` credit fired during six PPO updates, so the candidate
did receive direct evidence for entering the Task target. The locked combined
Judge nevertheless returned `REVERT`:

- aggregate violations improved `43 → 40`;
- violation severity improved `87.786 → 81.573`;
- degraded-right self-righting and stable-standing dwell regressed from pass
  to fail;
- both recovery-handoff directions regressed on score.

This is not a failed evaluation design; it is the intended safety result.
Prefix curricula improve sampling efficiency, but they have no promotion
authority. A candidate is selected only if the same uninterrupted trajectory
survives impact, recovers, avoids relapse, resumes locomotion, redirects,
traverses, and stops across the complete Mission Suite.

## Conjunctive target and outcome-ledger result

Session `session-ff1d35144211cc53` replaced part of the independent recovery
shaping with `taskTargetProgress` and trained the same bounded
impulse/capture/rise envelope for `65,536` steps. The new ledger showed that
left/right sampling was not the limiting variable: each side received `38`
recovery-prefix episodes and roughly equal complete-Mission exposure.

The important result was causal. Across `110` episodes, ML caused only six
entries into the Task recovery target. The physical state crossed into and out
of the target hundreds of times, but no episode held it long enough to emit a
`recovery-stable` transition. Every training episode expired the recovery
phase; later phases could still run, but `timeoutFreeMissionEpisodes` remained
zero.

The locked Judge rejected Policy
`articulated-inverted-escape-f5d2e2cbb4ede888`: violations regressed `43 → 45`,
severity regressed `87.786 → 106.691`, degraded-right lost self-righting,
stable dwell, final posture, and final height, and both handoff regressions
lost score. This rules out independent Skill sampling and an additive reward
blind spot as sufficient explanations.

A subsequent frozen-weight counterfactual kept residual authority active
through target dwell and produced byte-equivalent behavior on all four locked
Cases. The six actor-caused target entries occurred in stochastic Training
rollouts; the deployed deterministic actor mean did not reproduce them on the
locked degraded Cases. The evidence-backed next problem is therefore
stochastic-to-deterministic policy consolidation, not a speculative authority
handoff change. The deterministic post-Training probe makes that gap explicit
before a Candidate reaches the uninterrupted Mission Judge.

## Exploration-to-mean consolidation result

The same 65,536-step conjunctive run was reproduced under the deterministic
probe contract as Policy `articulated-inverted-escape-d23b22b99d4a2c80`.
Its stochastic rollouts again produced six actor-caused target entries. Across
six frozen actor-mean progression-stage × Scenario probes it produced zero:
every recovery timed out and maximum stable progress remained zero. The locked
Judge reproduced the prior `39.984379` score and `REVERT`, directly confirming
that the observed entries were exploration evidence rather than deployable
Policy behavior.

Policy `articulated-inverted-escape-2c084934ac04e4a6` added elite replay with a
64-step tail, 4,096-transition capacity, 64-sample minibatch, and `0.05`
coefficient. Nine episodes admitted 576 transitions. The frozen actor mean
then caused one target entry, while the locked Judge improved from 43 to 42
violations and from `87.786` to `81.735` normalized severity. Aggregate score
reached `59.449401`, but terminal height regressed on degraded-right and both
recovery-handoff score gates regressed, so the Harness correctly returned
`REVERT`.

A stricter `complete-mission` replay scope admitted only one 64-transition
episode. It moved the deterministic target entry to a complete left Mission
probe but regressed the locked Judge to 46 violations and `108.883` severity.
This separates semantic correctness from sample sufficiency: complete-Mission
success is the right deployment evidence, but one elite episode cannot support
reliable policy consolidation. The next bounded problem is collection and
selection of more diverse complete-Mission recovery evidence, not increasing
the cloning coefficient or weakening the Judge.

## Deterministic Mission checkpoint selection

PPO's last update is not automatically the most deployable Policy. Mission
Training v3 may therefore declare a bounded `deterministicCheckpoint`
contract. At each configured Training-step interval, Runtime freezes the
current network and normalizer and replays the same complete Mission stages,
Scenarios, domain seeds, Program prior, and residual-authority envelope with
the deterministic actor mean. Probe steps do not update weights or
normalization and do not consume the declared Training budget.

Selection uses Task-owned causal evidence, never the locked Benchmark score.
It compares the worst left/right Scenario first and then totals, in this
order: timeout-free Mission completion, Mission completion, stable-recovery
transition, actor-caused recovery-target entry, fewer relapses, fewer
phase-timeout episodes, worst-case recovery-target progress, and mean target
progress. Exact ties preserve the earlier checkpoint because later weight
changes have not demonstrated an observable capability gain.

The selected network and its matching normalizer become the frozen Policy
Artifact. Training metrics retain every candidate step, its named rank
components, the selected step, the final trained step, and whether earlier
weights were restored. Studio presents the same ledger, while
`mujica policy inspect --json` exposes it headlessly. This is a deployability
selection mechanism inside one Training run, not evaluation or promotion:
the complete locked Mission Judge still has sole authority to KEEP or REVERT
the resulting Candidate.

The first governed use froze eight checkpoints across a 65,536-step elite
replay run. The selector restored step 24,576 because it was the only
checkpoint whose actor mean caused a target entry in a complete Mission
probe; the final checkpoint caused none. The entry existed only on the left
exact-profile probe, so the worst-direction target-entry count remained zero,
no checkpoint produced a stable transition or timeout-free Mission, and every
complete probe still timed out.

The locked Judge rejected the selected Policy
`articulated-inverted-escape-2ced228c45390cc4`: score was `58.811399`,
violations regressed from 43 to 44, and normalized severity regressed from
`87.786` to `102.663`. This falsifies final-update forgetting as a sufficient
explanation. Checkpoint selection exposed and preserved a real transient
behavior, but it could not manufacture the missing bilateral,
complete-Mission evidence.

## Interleaved Mission progression

Sequential progression can create a deployment-data blind spot: a recovery
behavior may emerge during a short diagnostic prefix and disappear before
complete-Mission stages begin. Training v3 may therefore declare
`progressionSampling: interleaved-step-share`. The cumulative `untilStep`
boundaries still define an exact per-stage step quota, but a deterministic
deficit scheduler interleaves those quotas from the beginning of Training.
Every episode still resets to Mission phase one and executes one declared
Scenario; no fallen-state reset, phase teleport, or independent Skill
promotion is introduced.

This schedule is a data-collection policy, not a test change. Complete exact
and randomized Missions now observe early, middle, and late Policy states,
while short prefixes retain only their declared diagnostic quota. Training
metrics publish target and actual step share, first/last observed step, and
per-stage actor authority. Elite replay additionally publishes admission
coverage by progression stage and Scenario, including whether each admitted
tail came from a complete Mission. Studio and headless Policy inspection can
therefore distinguish genuinely bilateral deployment evidence from a replay
buffer populated by one side or by diagnostic prefixes.

The first governed comparison used the same 65,536-step budget and
32,768/16,384/16,384 quotas as the sequential run. Actual shares were
`49.01%`, `25.65%`, and `25.34%`; complete-Mission collection began at step
zero, proving that the temporal blind spot was removed. The result also
demonstrated why sampling and evaluation must remain separate claims:
complete-only replay still admitted just one 64-step left/exact tail, no
deterministic checkpoint achieved bilateral actor target entry or stable
recovery, and every complete probe timed out. The locked Judge rejected Policy
`articulated-inverted-escape-6bcc5001e7faabbe` with score `49.004078`,
violations `43 → 44`, and normalized severity `87.786 → 89.151`.

Mujica therefore reports interleaving as data-collection provenance, never as
evidence of integrated competence. A Candidate is useful only when the same
continuous Mission produces bilateral recovery and downstream command
evidence under the locked Judge.

## Operating-condition authority coverage

Domain randomization is not meaningful learning evidence when the actor is
silently disabled for part of the sampled envelope. Training and deterministic
Mission probes therefore publish `actuatorDelayCoverage`, grouped by the
effective Scenario delay after Domain Profile jitter is applied. Each row
records episode and complete-Mission counts, steps, active actor fraction,
mean authority, actor-caused target entries, stable transitions, phase
timeouts, and timeout-free Missions.

The first use found that the recurrent recovery Policy observed effective
actuator delay but its residual gate accepted only exactly one step. The
declared randomized profile also produced two-step plants, and all five such
training episodes had zero actor actions. A bounded follow-up may enumerate
the explicitly trained values `{1, 2}` in `allowedTelemetry`; this is a typed
authority change, not a wider Domain Profile or weaker Judge. Missing delay,
zero delay, values outside the declared set, disallowed Program phases, and
physical-envelope exits continue to fail closed.

The governed comparison confirmed the coverage table is causal: two-step
episodes moved from zero actor actions to 1,001 actor steps (`21.33%` active
fraction). It did not produce a two-step target entry or any stable recovery.
One-step stochastic target entries increased to five, but the selected actor
mean reproduced only one left entry and zero right entries. The Mission Judge
rejected Policy `articulated-inverted-escape-fc5bf55bd5a150e6` with score
`41.056755`, violations `43 → 44`, and severity `87.786 → 109.435`.

The right-degraded replay explains the downstream failure. Residual authority
was bounded to `2.43 s` during the initial recovery and correctly closed at
the Task deadline. Its changed rise state nevertheless diverged after the gate
closed: the Program baseline recovered to `0.364 m`, while the Candidate
entered inverted brace at `11.98 s` and ended at `0.060 m`. Fail-closed
authority prevents later learned actions; it cannot erase momentum injected
earlier. Mujica must therefore preserve continuous post-intervention evidence,
not infer safety from the instant at which authority becomes zero.

## Bilateral Policy symmetry is an ABI contract

Robot bilateral symmetry is meaningful only when declared over the frozen
compiled coordinates. A Trainer may provide a `lateral-reflection-v1`
contract that:

- classifies every Observation channel as explicitly transformed or invariant;
- defines permutation and sign transforms, including repeated history blocks;
- defines the corresponding Action permutation and signs;
- is dimension checked against the compiled Observation/Action ABI; and
- is proven involutive before Training begins.

For a declared contract, Runtime may update normalization with both each
physical observation and its coordinate reflection, penalize deterministic
actor-mean equivariance error on actor-authorized samples, and mirror admitted
elite observation/action tails. Mirrored data is an optimization prior, not a
second physical episode: episode counts, plant coverage, Mission events, and
Judge evidence continue to count only Runtime executions.

Scenario symmetry is audited independently. Opposite push directions do not
establish a mirror pair when force, duration, friction, payload, noise, delay,
or other authored plant conditions differ. Training metrics and Studio publish
the authored lateral impulse and a pair status for each progression stage.
This prevents a useful Policy prior from laundering unequal test loads into a
false claim of balanced physical evidence.

The first quadruped contract reflects all 185 Observation coordinates and all
14 Actions. Its degraded Mission pair is intentionally preserved as
load-magnitude-asymmetric: positive-y impact is `9.60 N·s`, while negative-y
impact is `7.84 N·s`. Only the unchanged complete Mission Suite may decide
whether the bilateral Policy improves the robot.

## Temporal authority is part of the experiment contract

A bounded learned residual can be safe at each active frame and still be
useless because it receives authority after the controllable event. Mission
Training therefore records the first physical impact end, causal recovery-phase
entry, Program recovery entry, learned-authority entry, and Task recovery
deadline. Studio and headless Policy inspection report response latency and
remaining recovery budget by progression stage and Scenario.

Program residual gates may declare a primary route plus bounded
`additionalRoutes`. Each route is a complete fail-closed conjunction over
Program mode, exact/allowed telemetry, scalar Observation and Runtime latches,
and numeric telemetry limits. A learned controller is authorized when at least
one declared route matches; a missing or malformed value matches none. Route
identity must remain physical and observable. Scenario id, benchmark Case id,
research verdict, or hidden Task labels are not authority inputs.

This makes “impact reflex while still locomoting” and “recovery correction
after fall detection” separate auditable surfaces. It also prevents a Studio
label such as `recover` from silently becoming a privileged controller signal.

## Delayed contribution is not same-step authority

For short interventions, a useful action may occur seconds before the Task
target is crossed. Mujica reports two distinct counters:

- contemporaneous target entry means actor authority was nonzero on the
  crossing step;
- contributed target entry means at least one actor-authorized action since the
  prior target entry preceded the crossing in the same uninterrupted episode.

The contributed counter can trigger bounded replay and participate in
checkpoint evidence, but it is not a causal proof and is never a promotion
gate. Multiple crossings after one intervention do not receive repeated
credit unless new actor authority occurs. Stable dwell, phase timeout,
relapse, Mission completion, and the locked Judge remain authoritative.

## A short reflex needs a temporally matched learning objective

The quadruped experiments showed why authority timing and objective timing are
different. Opening a physical lateral-momentum route before Program recovery
successfully recovered several seconds of potential response budget. PPO
nevertheless learned reflexes that improved some immediate or one-sided
signals while moving the opposite side into a recovery basin from which the
deterministic Program could not self-right. Restricting the residual from all
14 actuators to only lateral abduction and waist roll did not fix the outcome.

For such a surface, the next supported research pattern is a short-horizon
counterfactual objective tied to physical post-impact state, followed by
distillation and the unchanged complete-Mission Judge. The short-horizon
objective is Training evidence only. It must never replace downstream
recovery, resumption, redirection, traversal, stop, or regression Cases.

### Local counterfactual courses do not split the Mission

`mujica policy reflex-search` branches a frozen Policy at the physical impact
trigger and observes only a bounded post-impact horizon. It is deliberately a
Training-data operation, not a Benchmark mode:

- search Cases use explicit seeds that must not overlap the locked Mission
  Suite seeds;
- Policy weights, normalizer, Program prior, Assembly, plant, Task, Scenario,
  and pre-trigger state are hash checked;
- candidate ranking first rejects safety regressions, then compares the
  worst-case terminal recovery basin across repeated seeds;
- unequal opposite-direction loads may select different state-conditioned
  actions; the bilateral ABI is audited but exact action reflection is not
  fabricated;
- the immutable artifact records `training-only` search authority,
  `promotion-only` Judge authority, and a null promotion verdict.

Training may consume an eligible artifact through `reflexDistillation`.
Counterfactual teacher frames target the actor's pre-transform raw Action.
States on a direction where search found no safe improvement may instead
carry frozen-policy anchors. The supervised coefficient is explicit and
linearly retires at `untilStep`; it cannot add Training steps, widen residual
authority, change Mission progression, or change the Judge. Studio and
`policy inspect` expose the search identity, hashes, teacher/anchor counts,
side coverage, schedule, and authority boundary.

This is still one deployed Policy and one integrated task. “Local course”
describes where a learning signal came from, not a separately trained walking,
collision, or self-righting controller.

### First counterfactual result

Search `reflex-search-7e950b1350b261dd` used four independent Training seeds
(`17203`–`17206`) and excluded Judge seeds `7201`–`7204`. The 60 N positive-y
side found no safe proxy improvement and produced 38 frozen-policy anchors.
The 49 N negative-y side selected one reflex that improved terminal recovery
progress on both search seeds by approximately `+0.345` and `+0.119`, removed
the observed disallowed self contacts, and produced 24 counterfactual teacher
frames. The artifact was correctly labelled `IMPROVED_PROXY`, never KEEP.

Two governed 65,536-step experiments then tested whether the local signal
survived the complete Mission:

- always-on 24-frame distillation produced Policy
  `articulated-inverted-escape-2bafab9f68460ff7`; the locked aggregate fell
  from `62.722325` to `40.168929`;
- 24 teacher frames plus 38 opposite-side anchors, coefficient `0.01`, and
  linear retirement at step `8,192` produced Policy
  `articulated-inverted-escape-f319aeffab0d482d`; the locked aggregate was
  `40.486566`.

Both candidates ended the previously passing degraded-right complete Mission
inverted and regressed recovery handoff and lateral command tracking. Both
were `REVERT`. This is the intended evidence hierarchy working: a locally
better impact basin did not become a robot-level claim.

The next supported ML intervention is a bounded update around the already
qualified frozen Policy—warm-start fine-tuning, a trust region, or an
equivalent weight-preservation contract—not another from-scratch run or a
larger distillation coefficient. It must still pass the same complete Mission
and regression suite.
