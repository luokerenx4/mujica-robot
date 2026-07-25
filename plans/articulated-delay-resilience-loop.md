# Articulated delay-resilience loop

Status: active

## Outcome

Remove the articulated quadruped's delayed-observation regressions without
trading left-impact recovery for right-impact recovery or optimizing an
isolated Skill at the expense of the complete Mission.

The iteration unit is one Candidate judged on the same causal sequence:
approach, impact, recover, resume, redirect, traverse, and stop. Controller and
RL work share that authority and may use atomic Skills only to diagnose a
failure witnessed by the Mission Suite.

## Current development branch

- Review subject:
  `resilient-command-conditioned-waist-3dof/articulated-behavior-supervisor`
- Current score under the durable-recovery Judge: `62.7223`
- Worst Case: `integrated-resilience-mission/impact-left-degraded`
- Work Order status: `READY`
- Routed lanes:
  `integrated-resilience-waist-design`,
  `articulated-resilience-controller`,
  `articulated-brace-locomotion-policy`, and
  `articulated-inverted-escape-policy`

The Development Lab matcher accepts either side of a Review's Candidate
comparison as its subject. This is required because useful non-promoted
mechanisms must remain iteratable even when the selected release Robot stays
unchanged.

## Completed bounded probes

### Measured low-delay Controller fallback

Session `session-2fec8f26286bad66` tested a delay-one/two phase-direction
fallback driven by early signed-progress deficit.

- aggregate score: `72.7223 → 73.3788`;
- violations: `42 → 41`;
- left-degraded self-righting changed from failure to success;
- right-degraded self-righting changed from success to failure;
- normalized severity regressed from `85.786` to `96.930`;
- verdict: `REVERT`.

The experiment found a measured signal, but a global direction latch merely
moved the failure between impact sides.

### Early-delay RL locomotion residual

Session `session-7428b37374db2e79` doubled training exposure, increased
signed-progress credit, and gave the learned residual more leg authority with
less waist authority.

- Policy score: `34.435 → 34.939`;
- primary violations: `48 → 40`;
- right-degraded signed progress became positive (`0.0754`);
- exact-right timed out and degraded recovery remained unsafe;
- the Policy remained far below the Program reference (`72.7223`);
- verdict: `REVERT`.

More samples and more authority produced a useful directional signal but did
not produce a promotable robot.

## Findings and decisions

The left/right replay pair showed that the impact is already distinguishable
from declared state at the end of the push: lateral velocity and roll rate have
opposite signs, while the existing Supervisor waits until roughly `0.8 rad`
tilt before entering recovery. Five bounded Controller strategies used only
continuous measured state—phase retardation, smooth reversal, support-side
brace, early command-stop entry, and momentum-directed entry. None passed all
four complete Mission Cases. Early entry reduced violations `42 → 39`, but
lost the currently passing degraded-right self-righting gate. Fixed phase
tuning is not the remaining root cause.

The Policy Lab initially exposed a harness defect: its selected frozen Policy
was built against an older Assembly, yet its Work Order lane was labelled
ready. Policy Labs now preflight execution, Observation, and Action identity.
This Lab records `reference-controller-retrain` and trains from
`articulated-behavior-supervisor`; it cannot crash later in Python or compare
against an incompatible Policy head.

Session `session-dcf9f2536745c351` trained a `65,536`-step residual restricted
to delay-one dynamic recovery, with `0.30 Nm` per leg actuator and `1.50 Nm`
per waist actuator. Exact Cases remained behaviorally unchanged. On
degraded-right, signed progress improved `-0.345 → +0.226 m`, terminal tilt
fell `0.237 → 0.063 rad`, collisions fell `23 → 9`, and joint margin
improved `-0.060 → -0.031 rad`. The complete Mission nevertheless caught a
later fall during traverse/stop; the Policy reactivated and the episode ended
mid-rise at `0.227 m`, regressing the terminal-height gate. Verdict: `REVERT`.

That comparison exposed a Judge defect rather than merely a Policy defect:
terminal posture depended on when the second fall happened relative to the
fixed horizon. The accepted Program also fell again after self-righting; it
fell earlier and happened to be upright at the end. Task v8 now declares a
physical post-recovery failure envelope (`height < 0.24 m` or yaw-invariant
tilt `> 0.7 rad` for `0.1 s`). Runtime emits
`robot.recovery-relapsed`, the Objective locks zero relapses, diagnostics route
the complete recovery-to-locomotion suffix, and Studio exposes the event.

Rejudging preserved the useful distinction without rewarding horizon luck:

- accepted Program: degraded-right `2` relapse episodes;
- first narrow recovery Policy: degraded-right `3` relapse episodes;
- exact left/right Cases: `0` relapses;
- Program aggregate: `72.7223 → 62.7223` under the strengthened Judge;
- Policy aggregate: `72.6571 → 57.6571`.

The first Program relapse occurs in `traverse`, `2.4 s` after stable
self-righting, as body tilt remains above the failure envelope. The Supervisor
re-enters recovery immediately afterward. This makes the next bounded problem
explicit: preserve recovery through the settling-to-locomotion handoff and the
subsequent command transition, not merely reach standing once.

Session `session-c48393802da86aed` then restricted authority to the first
recovery using causal Program telemetry `recoveryCompleted=false`. Its newly
trained Policy lost degraded-right self-righting and increased violations
`42 → 45`. Verdict: `REVERT`.

### Closed-loop handoff and learned Mission suffix

The strengthened relapse gate localized a concrete handoff edge in immutable
Run `run-ff7d8750aaeae444`. On degraded-right:

- the Supervisor entered `settling` at `11.70 s`;
- locomotion authority reached roughly `75%` near `13.20 s`, when angular
  speed and saturated action began to grow;
- the wall-clock blend completed at the same redirect-to-traverse boundary;
- the first relapse was emitted at `14.80 s`.

Session `session-f4a4c740cf4ffb50` replaced the wall-clock-only cross-fade with
a stability-conditioned authority integrator. Height, yaw-invariant tilt,
angular speed, and support contacts advanced or backed off locomotion
authority, with no Scenario or Mission-phase input.

- score improved `62.7223 → 68.1143`;
- violations improved `43 → 41`;
- normalized severity improved `87.786 → 79.425`;
- the first degraded-right relapse moved from `14.80 s` to `17.72 s`;
- the robot crossed traverse but entered a late oscillatory handoff and failed
  the previously passing final tilt/height gates;
- verdict: `REVERT`.

Session `session-62b5a1eab9d3d22e` then trained a `32,768`-step residual on
complete Missions. Learned authority was zero in approach, impact, and
recovery; it activated only in `settling`/`locomotion` after at least three
observable Program transitions. Completion, stop stability, recovery, and
timeout credit made the whole post-recovery suffix part of the return.

- previous Policy score improved `34.4350 → 57.4422`;
- violations improved `48 → 43`;
- normalized severity improved `114.371 → 89.306`;
- degraded-right ended upright at `0.366 m`, but accumulated three relapse
  episodes and regressed backward-progress and terminal-yaw gates;
- exact-left also regressed its backward-displacement gate;
- the Candidate did not lexicographically beat the Program reference;
- verdict: `REVERT`.

These experiments prove both intervention surfaces carry useful signal but
neither is promotable. The Program rule delayed failure without stabilizing
the authority loop; PPO improved its predecessor while exploiting trajectories
that still crossed the physical relapse envelope. The Program remains the
release subject. The next experiment must change the learned state/credit
contract—most likely recurrent contact/action history plus direct relapse
credit—not merely widen torque authority or repeat scalar stability thresholds.

## Acceptance

- no new passing-gate regression;
- no left/right failure exchange;
- both degraded Cases exit recovery without timeout;
- zero post-recovery relapse events through resume, redirect, traverse, and
  stop;
- downstream signed progress and stop stability remain observable in the same
  episode;
- only the locked Mission Suite may promote the Candidate.

## Work

- [x] Route the articulated Review subject into executable design, Controller,
  and RL Labs.
- [x] Run and preserve one bounded Controller experiment.
- [x] Run and preserve one bounded RL experiment.
- [x] Reject both regressions while retaining immutable evidence.
- [x] Test continuous side-aware Controller priors on all four Mission Cases.
- [x] Train and judge phase-/actuator-conditioned residuals.
- [x] Keep the Program release subject because no Candidate passed the complete
  Mission Suite.
- [x] Replace terminal-frame recovery luck with a causal post-recovery relapse
  event, score term, hard gate, diagnostics, and Studio evidence.
- [x] Test one closed-loop Program handoff and one bounded learned post-recovery
  suffix against the strengthened complete-Mission Judge; preserve both as
  immutable `REVERT` evidence.
- [x] Add causal relapse credit and recurrent contact/action history to the
  learned suffix without expanding its Program-telemetry authority boundary.
- [x] Preserve two reverted complete-Mission experiments that exposed
  no-self-right reward avoidance and a noisy Observation-ABI composition bug.
- [x] Isolate bounded history noise so adding an unused history component
  cannot perturb any existing noisy observation under the same seed/actions.
- [x] Expose Task/Judge target, stable dwell, success, and deadline as declared
  Runtime state and gate learned authority on those facts.
- [x] Make residual authority fail closed on disallowed Program sub-phases,
  rise smoothly on every entry, and exit immediately in Training and frozen
  inference.
- [x] Preserve four reverted Mission experiments that separate Program
  fallback, target-boundary failure, gate chatter, and deadline reactivation.
- [x] Add a frozen-weight authority counterfactual lane so a gate-only change
  can be judged without retraining a different Policy.
- [x] Make complete-Mission training publish a stage-by-Scenario episode
  outcome ledger instead of hiding directional failures in aggregate reward.
- [x] Derive dense recovery progress conjunctively from the complete
  Task-authored height, tilt, linear-speed, and angular-speed target.
- [x] Train and judge one balanced left/right continuous-Mission Policy using
  the conjunctive Task-target signal.
- [x] Declare the exact lateral Observation/Action involution, mirror bounded
  successful recovery evidence, and judge one same-budget bilateral Policy.
- [x] Add a Training-only frozen-policy impact counterfactual with independent
  seeds, repeated worst-case selection, byte-identical pre-trigger state, and
  no promotion authority.
- [x] Preserve load asymmetry: audit bilateral coordinates without forcing the
  60 N and 49 N sides to share an exact reflected Action.
- [x] Distill one proxy-improving reflex into the same continuous-Mission
  Policy and preserve its locked `REVERT` evidence.
- [x] Add opposite-side frozen-policy anchors and an early linear retirement
  schedule; preserve the second locked `REVERT` instead of weakening the
  Mission Judge.
- [ ] Add a warm-start/trust-region Policy update contract around the accepted
  frozen weights before running another counterfactual-reflex experiment.

## Frozen-weight authority result

Two counterfactuals reused Policy
`articulated-inverted-escape-7165992fb1a9b8bc`, its exact model and
normalizer bytes, Assembly
`resilient-command-conditioned-waist-history-3dof`, the same locked Mission
cases, and the same seeds.

- `authority-counterfactual-13fefce43e04ed0b` moved only
  `recoveryDeadlineExpired=0` from the neural Observation gate to out-of-band
  Runtime supervisor state. All four case metrics, scores, violation counts,
  severities, and residual-authority durations were byte-equivalent. This
  validates the ABI separation.
- `authority-counterfactual-7a10e0e7af3e1776` removed the deadline predicate
  from the same frozen Policy. Exact and degraded-left cases were unchanged.
  Degraded-right received `0.52 → 1.90 s` residual authority; total violations
  remained `45`, normalized severity improved `112.925 → 105.211`, and
  aggregate score changed `40.1174 → 40.0466`. The causal classification is
  `IMPROVED` within the same infeasible gate tier, not promoted.

This isolates a useful but insufficient signal: deadline-open recovery reduces
physical gate severity on the one case where it changes behavior, but does not
eliminate a violation and slightly lowers aggregate score. The next learned
experiment may use Runtime-owned deadline state without widening its neural
input ABI, but the complete Mission Judge still requires a new Policy or
Program intervention before release.

## Continuous-Mission outcome contract

The first trained impulse/capture/rise Policy
`articulated-inverted-escape-b68c36415c7bcfe4` was rejected despite improving
violation count `43 → 40` and severity `87.786 → 81.573`: degraded-right lost
self-righting and stable dwell, and both handoff directions regressed. Training
exposure was already balanced by left/right Scenario. Only six Task-target
entries occurred across 110 episodes, and the degraded-right Candidate ended
upright but `0.031 m` below the authored minimum height.

The Harness now preserves atomic Scenarios as diagnostic labels inside one
continuous Mission rather than treating them as independently promotable
skills. Every training episode records target entry, actor-caused target entry,
stable transition, relapse, deadline expiry, phase timeout, and complete
Mission outcome. Frozen Policy evidence aggregates this by curriculum stage
and Scenario for both Studio and headless inspection.

Dense target progress is the geometric conjunction of Task-authored height,
tilt, linear-speed, and angular-speed components. It remains training-only:
the sparse causal events, locked complete Mission, and gate-first Judge retain
promotion authority.

Session `session-ff1d35144211cc53` trained that contract for `65,536` steps.
The outcome ledger exposed the handoff failure directly:

- every one of the `110` episodes started from Mission approach;
- both sides received `38` recovery-prefix episodes and `17–18` complete
  Mission episodes;
- ML caused only `6` target entries in total;
- the physical state repeatedly crossed the target boundary, but no training
  episode held it long enough for a `recovery-stable` transition;
- all `110` episodes expired the recovery phase, and no full Mission completed
  without a phase timeout.

The locked Judge therefore returned `REVERT`: violations regressed `43 → 45`,
severity regressed `87.786 → 106.691`, degraded-right lost self-righting and
stable dwell, and both atomic handoff directions lost score.

The frozen-weight target-dwell authority counterfactual then produced
byte-equivalent behavior on every locked Case, disproving that handoff as the
current causal bottleneck. The six actor-caused target entries came from
stochastic PPO rollouts; the deterministic actor mean did not reproduce them
on the locked degraded Cases. Training v3 now publishes both ledgers:

- stochastic sampled rollouts remain exploration evidence;
- a frozen actor-mean probe replays every Mission-stage × Scenario pair with
  zero Training-budget charge;
- only the locked Mission Suite Judge retains promotion authority.

This keeps walking, disturbance response, recovery, and controlled stop inside
one causal Mission while preventing exploration luck from masquerading as a
deployable robot capability.

## Elite replay consolidation

The deterministic probe reproduced the stochastic-to-deployment gap exactly:
six sampled actor target entries became zero actor-mean entries, all six probes
timed out, and the locked score remained `39.984379`.

Bounded elite replay then retained the 64 actor-authorized steps preceding the
first Task-target entry in each admitted episode. With nine admitted episodes
and 576 retained transitions:

- the frozen actor mean produced its first target entry;
- locked violations improved `43 → 42`;
- normalized severity improved `87.786 → 81.735`;
- aggregate score reached `59.449401`;
- terminal height on degraded-right and both recovery-handoff score gates
  still regressed, so the verdict remained `REVERT`.

Restricting admissions to complete-Mission stages was semantically cleaner but
yielded only one 64-transition episode. It produced one complete-probe target
entry but regressed to 46 violations and `108.883` severity. The next
experiment should increase diverse complete-Mission success collection or
select an earlier deterministic checkpoint. It should not simply raise the
distillation coefficient: the present evidence shows a data-coverage problem,
not insufficient loss magnitude.

## Deterministic checkpoint selection

The Harness now treats the final PPO update as a candidate rather than an
implicit winner. A bounded Training v3 contract freezes the network and its
matching normalizer at configured intervals, runs fixed-seed actor-mean probes
over the complete Mission stages, and publishes a side-balanced,
lexicographic Task-evidence ledger. The selector cannot read Benchmark scores,
change the locked Judge, consume Training steps, or widen residual authority.
It restores an earlier checkpoint only when that frozen Policy is observably
better on complete-Mission completion, stable recovery, target entry,
relapse/timeout avoidance, or worst-case target progress. Exact ties keep the
earlier weights.

The next governed experiment keeps the successful all-progression elite
replay configuration and all other Training/Task/Scenario/Judge inputs fixed.
It adds only periodic deterministic checkpoint selection, then judges the
selected frozen Policy on the same locked complete Mission Suite.

Session `session-37378a8ba52138d9` completed that comparison. Eight checkpoints
were frozen from step 8,192 through 65,536. Step 24,576 was selected because
it alone produced one actor-caused target entry in a complete left Mission;
the final weights produced none. All checkpoints still had zero
worst-direction target entries, zero stable transitions, zero timeout-free
Missions, and four complete-probe timeout episodes.

The locked Judge returned `REVERT`: score `58.811399`, violations `43 → 44`,
and normalized severity `87.786 → 102.663`. Degraded-left lost backward and
terminal-planar gates, degraded-right lost final height, and both handoff
directions regressed. Earlier checkpoint selection preserved a transient
left-side behavior but did not solve bilateral deployment. The next bounded
problem is collecting multiple complete-Mission target-entry trajectories on
both sides and physical profiles; neither later-weight rollback nor a larger
distillation coefficient is supported as the next intervention.

## Interleaved complete-Mission collection

The current sequential schedule spends the first 32,984 observed steps on the
recovery prefix, then 16,812 on exact complete Missions and 15,740 on
randomized complete Missions. That ordering can miss transient useful Policies
before the deployment-context stages begin.

Training v3 now supports deterministic `interleaved-step-share` progression.
The existing cumulative boundaries become fixed quotas while prefix, exact
complete Mission, and randomized complete Mission episodes are deficit
scheduled throughout the run. Every episode still starts at approach and
experiences the authored impact. Elite replay records admission coverage by
stage and direction so a nominal replay count can no longer hide one-sided or
prefix-only evidence.

The governed comparison kept the same 32,768/16,384/16,384 step quotas, total
budget, seed, architecture, rewards, Program authority, Task, Scenarios, and
locked Judge. It changed only the temporal schedule, restricted elite
admissions to complete-Mission stages, and used the already-governed
deterministic checkpoint selector for publication.

Session `session-a2b1b65d1340da02` confirmed the scheduler behaved as designed.
The recovery prefix, exact complete Mission, and randomized complete Mission
received `49.01%`, `25.65%`, and `25.34%` of 65,536 steps. Complete-Mission
collection began at global step zero instead of after the prefix, and all
started episodes still began at approach.

The learning hypothesis was falsified. Complete-Mission-only elite replay
again admitted one 64-step left/exact tail and no right or randomized tail.
All complete Missions timed out recovery, no deterministic checkpoint
produced an actor target entry, stable transition, or timeout-free Mission,
and the earliest tied checkpoint at step 8,192 was restored. The locked Judge
returned `REVERT`: score `62.722325 → 49.004078`, violations `43 → 44`, and
normalized severity `87.786 → 89.151`, with new Mission and handoff gate
regressions.

Interleaving is retained as the honest option when simultaneous Mission data
collection is required, but it is not itself a recovery algorithm. The next
intervention must increase bilateral actor-authorized recovery signal in the
complete Mission—by changing authority/credit or the recovery policy—not
merely reschedule the same sparse trajectories.

## Measured-delay authority coverage

The interleaved episode ledger exposed a concrete training-contract mismatch.
The randomized complete-Mission Domain Profile intentionally adds zero or one
control step to each degraded Scenario's one-step actuator delay. The recurrent
Policy observes the effective delay, but its safety gate required
`measuredDelaySteps == 1`. All five sampled two-step episodes therefore
received exactly zero actor actions and could not contribute target-entry or
elite-replay evidence.

The next governed comparison keeps the interleaved quotas, complete-Mission
replay scope, checkpoint selector, network, reward, residual torque envelope,
seed, Task, Scenarios, and locked Judge fixed. It changes only the enumerated
gate condition from exact delay one to the Domain-declared set `{1, 2}`. Zero
delay remains outside this learned recovery lane, missing telemetry still
fails closed, and the existing `0.4 s` entry ramp plus all physical telemetry
bounds remain unchanged.

Training evidence now groups episode count, complete-Mission exposure, actor
authority, actor target entry, stable recovery, phase timeout, and timeout-free
completion by effective actuator delay. The frozen actor-mean probe publishes
the same coverage. This lets Studio and headless inspection distinguish
“robustness data existed” from “the Policy was actually authorized to learn
from it.”

Session `session-465adc94163c2d13` validated the diagnosis but rejected the
learning hypothesis. Two-step delay received 1,001 actor steps across five
complete Missions (`21.33%` active fraction) instead of zero, while one-step
rollouts produced five actor target entries instead of one. The two-step bucket
still produced zero target entries, every episode in both buckets timed out,
and no stable recovery occurred. Checkpoint selection restored step 16,384,
whose actor mean reproduced one left target entry but none on the right.

The locked Judge returned `REVERT`: score `62.722325 → 41.056755`, violations
`43 → 44`, and severity `87.786 → 109.435`. On the selected right-degraded
Case, the Program baseline eventually self-righted with `1.08 s` stable dwell
and finished at `0.364 m` height. The learned residual received `2.43 s` of
authority during the first impulse/capture/rise, left the robot on a divergent
rise trajectory after authority closed, and it inverted by `11.98 s`, ending
at `0.060 m`.

The next bounded ML question is therefore bilateral structure in the recovery
policy, not further authority widening. Left-only exploration success and
right-only deployment failure suggest testing a declared left/right symmetry
contract or mirrored recovery data augmentation while keeping the same
continuous Mission Judge.

## Declared bilateral Policy contract

A left/right label is not a coordinate transform. The articulated history
Assembly has a 185-element Observation ABI and a 14-element Action ABI whose
lateral reflection must swap front-left/front-right and rear-left/rear-right
legs, negate abduction and waist-roll coordinates, reflect quaternion,
linear/angular velocity, IMU, command, four-step Action history, and foot
contact history, and leave six Task/plant scalars invariant.

Runtime now validates that every compiled Observation channel is classified,
every permutation/sign transform is dimensionally valid, and applying the
declared transform twice returns the exact original coordinate. The same
contract can symmetrize normalizer statistics, add an actor-mean equivariance
loss only while the residual has authority, and mirror a complete-Mission
elite tail without pretending that a synthetic mirror is another physical
rollout.

The Scenario audit is deliberately separate. The two degraded authored plants
share friction, payload, observation noise, delay, and opposite lateral
directions, but their impulse magnitudes are `9.60 N·s` and `7.84 N·s`
(`60 N` versus `49 N` for `0.16 s`). They are therefore reported as
`LOAD-MAGNITUDE-ASYMMETRIC`, not physically mirrored. The governed experiment
will preserve those unequal loads and every locked Mission input; only the
Policy's declared bilateral inductive bias changes.

Session `session-c5fe02f9bffa4749` falsified bilateral regularization as the
missing algorithm by itself. The selected step-32,768 Policy mirrored 128
complete-Mission elite transitions, but every complete Mission still timed
out. The locked Judge returned `REVERT`: aggregate score
`62.722325 → 40.154612`, violations `43 → 46`, and severity
`87.786 → 114.878`. Degraded-right lost self-righting, stable dwell, final
tilt, and final height. The physical pair audit correctly remained
`LOAD-MAGNITUDE-ASYMMETRIC`; mirrored coordinates did not become synthetic
plant evidence.

## Intervention timing and pre-fall authority

The bilateral replay exposed a deeper causal mismatch. On the accepted
degraded-right Run, the physical impact ends at `2.68 s`, but the Program waits
until `6.06 s` to enter `recovery`. The Task deadline is `8.68 s`, so active
self-righting starts with only `2.62 s` of the six-second recovery budget
remaining. PPO had been authorized only after this late Program transition.

Training and deterministic probes now publish an intervention-timing ledger by
Mission stage and physical Scenario:

- impact-end, recovery-entry, first Program-recovery, and first actor-authority
  times;
- Program and actor response latency relative to the physical impact end;
- remaining Task recovery budget at each intervention;
- episodes in which learned authority preceded Program recovery.

The residual gate can also declare up to eight typed `additionalRoutes`.
Every route independently names Program modes, exact/allowed telemetry,
Observation and Runtime latches, and numeric physical bounds. Routes are ORed,
their predicates remain conjunctive, malformed telemetry fails closed, exit is
immediate, and the existing entry ramp remains global. This supports an
auditable pre-fall reflex and a later recovery residual without merging their
physical envelopes or reading Scenario labels.

Both quadruped Supervisors now expose absolute lateral velocity, absolute roll
rate, and total base angular speed as physical telemetry. The first pre-fall
route required:

- Program mode `locomotion`;
- measured delay in the trained set `{1, 2}`;
- at least one second of mode dwell;
- absolute lateral velocity at least `0.4 m/s`;
- body tilt below the Program's `0.8 rad` fall threshold; and
- open Task target/stable/deadline latches.

The deterministic actor received authority before Program recovery on both
impact directions. This proved that the new route closed the timing blind spot,
but not that the learned action was useful.

## Early-reflex experiments and objective mismatch

Three governed, same-Mission comparisons isolated the early-reflex hypothesis:

1. Session `session-b7c038185d3cdd43` combined the new reflex route with the
   prior recovery route. Program recovery advanced on degraded-right from
   `6.06 s` to `5.00 s`, but learned recovery authority then remained active
   until `8.70 s` and the robot ended inverted. Judge: `REVERT`, score
   `40.263473`, violations `43 → 43`, severity `87.786 → 92.780`.
2. Session `session-ad873f49486690a2` removed all learned authority after
   Program recovery. A deterministic complete-Mission probe recorded a later
   Task-target entry after actor intervention on both exact directions, and the
   selected degraded-left replay self-righted in `7.30 s`. Degraded-right still
   became unrecoverable after only 12 actor steps. Judge: `REVERT`, score
   `60.376779`, violations `43 → 44`, severity `87.786 → 109.429`.
3. Session `session-7a808fd87e77c7ad` restricted learned torque to the four
   lateral abduction motors and waist roll while Program retained every
   sagittal and waist-pitch Action. The right-side failure remained and overall
   evidence worsened. Judge: `REVERT`, score `39.892361`, violations `43 → 48`,
   severity `87.786 → 125.554`.

These results falsify “open authority earlier” and “reduce the residual Action
axes” as sufficient fixes. The current on-policy PPO receives ordinary
locomotion reward during a sparse 12–21-step reflex window, while the relevant
consequence is which recovery basin the robot reaches seconds later. It can
improve an immediate posture proxy while making the deterministic Program's
later job impossible.

The ledger therefore distinguishes two attribution claims:

- `actorRecoveryTargetEntryCount`: the actor still had authority on the exact
  physical target-crossing step;
- `actorContributedRecoveryTargetEntryCount`: an earlier actor intervention in
  the same uninterrupted episode preceded the later target entry.

Elite replay and deterministic checkpoint selection may opt into the second
claim, but it remains contribution evidence rather than proof of stable
recovery. Stable Task dwell, timeout-free Mission completion, and the locked
Judge stay ahead of both counts.

The next algorithmic lane should not be another PPO gate/threshold sweep. It
should define a short-horizon impact objective over physical post-impact state
(angular momentum, tilt growth, support/contact, base height, and recovery
basin), search or optimize counterfactual reflex Actions over the same MuJoCo
state, and then distill only Judge-compatible reflexes into a small bilateral
Policy. The uninterrupted Mission and all downstream regressions must remain
the final selector so the short-horizon proxy cannot promote a locally neat
but globally unrecoverable brace.

## Frozen-policy reflex search and continuous-Judge result

The new `policy reflex-search` lane branched the accepted frozen Policy from
hash-identical impact states on four Training-only Cases. Search seeds
`17203`–`17206` do not overlap locked Judge seeds `7201`–`7204`. The proxy
rank rejects joint/contact regressions first, then compares worst-case terminal
Task-target progress over a five-second post-impact horizon. It cannot emit a
promotion verdict.

The load-aware result was intentionally asymmetric:

- positive-y / 60 N: keep the frozen actor; no safe candidate improved the
  repeated-seed proxy;
- negative-y / 49 N: one reflex improved terminal Task-target progress on both
  seeds and removed observed disallowed self contact.

Artifact `reflex-search-7e950b1350b261dd` therefore contains 24 negative-y
counterfactual teacher frames and 38 positive-y frozen-policy anchors. Its
bilateral contract reports the deviation from exact coordinate reflection
because opposite directions with unequal impulse magnitudes are not the same
physical experiment.

The first distillation kept the 24 teacher frames active throughout Training.
Policy `articulated-inverted-escape-2bafab9f68460ff7` was rejected at
`40.168929` versus the accepted `62.722325`. The second used all 62 contrastive
frames, coefficient `0.01`, and linear retirement at step `8,192`; Policy
`articulated-inverted-escape-f319aeffab0d482d` was rejected at `40.486566`.
Both lost the previously passing degraded-right self-righting, stable dwell,
final tilt, and final height gates and regressed downstream handoff/tracking.

This falsifies direct from-scratch distillation as the missing algorithm.
Local counterfactuals are retained as useful data discovery, but a future
experiment must preserve the accepted frozen solution with a warm-start or
trust-region update. The complete no-reset Mission remains unchanged.
