# Lateral-reach recovery co-design

Status: completed

## Outcome

The complete quadruped either regains a usable four-foot support opportunity
after a no-reset Mission impact or produces bounded negative evidence showing
that the articulated-waist morphology cannot justify its added mechanism.

The study keeps four authored feet as the only declared work contacts. It
co-designs hip mounting width, abduction workspace, foot geometry, and an
inverted-only contact-seeking recovery phase under the existing continuous
Mission authority.

## Context

The centered rollover-keel family changed the inverted resting basin but never
created sustained foot support. Its best point improved score and normalized
violation severity, yet still regressed collision, yaw, and atomic recovery
gates. Scanning another keel height or damping value would repeat an exhausted
hypothesis family.

The selected failed replay instead shows an actionable geometric fact: after
recovery enters its inverted plateau, the torso remains about `0.12 m` high
while all four foot sites remain roughly `0.22–0.38 m` above the floor. The
next design question is therefore whether the robot's existing feet can reach
a useful support configuration, not whether another passive torso contact can
roll it.

## Scope

In scope:

- lateral hip-mount location;
- abduction joint range and target envelope;
- bounded foot radius and corresponding mass;
- inverted-only contact-seeking leg targets;
- contact-conditioned use of the existing two-axis waist;
- the locked continuous Mission plus self-righting, handoff, and command
  regressions.

Out of scope:

- adding undeclared passive contact points;
- another dorsal-keel parameter scan;
- changing Mission phases, Scenarios, seeds, Objectives, or gates;
- treating isolated self-righting success as complete-robot acceptance;
- training an RL Policy before the morphology produces a viable support event.

## Acceptance

- All proposed geometry remains within the Charter mass, cost, Action,
  Observation, and four-contact envelope.
- Every experiment states the changed physical mechanism and is preserved with
  exact source and locked Judge evidence.
- At least one candidate creates a measured post-impact foot-support
  opportunity, or the bounded family emits an explicit exhaustion record.
- A candidate is kept only if it preserves passing gates before comparing
  violation severity and score.
- A structurally viable but release-reverted candidate may be frozen as an
  explicit non-promoted development branch for a subsequent bounded
  controller/RL study; RL may not conceal its failed release gates.
- Studio and CLI expose the selected continuous Mission witness and the
  complete experiment history.

## Work

- [x] Audit the failed keel replay and identify the zero-support inverted
  plateau.
- [x] Bound a four-point lateral-reach morphology family.
- [x] Make the governed Agent select new strategies from cross-Session memory.
- [x] Run and review the four complete-robot experiments.
- [x] Freeze the viable, still non-promoted brace morphology for controller/RL
  work.
- [x] Train and judge a bounded locomotion residual on the frozen brace plant.
- [x] Publish current Review, Work Order, Studio evidence, and remote commit.

## Decision rule

Preserve every passing gate. Among equally feasible candidates, minimize
normalized violation severity before maximizing aggregate score. A new foot
support event is diagnostic evidence, not permission to accept regressions.
The rigid robot remains selected unless the complete articulated candidate
passes the same Mission and regression contract.

## Findings and decisions

- The Charter requires exactly four declared contact points. A passive
  outrigger or rollover rail would change the robot's contact topology and
  must not be hidden as an unlisted MJCF geom.
- Widening the existing feet and their kinematic workspace preserves the
  authored four-contact morphology while making its mechanical cost visible.
- Geometry and sequencing must be evaluated together: extra joint travel has
  no effect if the Controller always retracts toward an upright stance while
  the torso is inverted.
- RL is downstream of plant feasibility in this slice. It becomes useful only
  after the scripted prior can produce contact authority for a residual to
  refine.
- The contact-seeking brace is the first candidate in this study to make the
  articulated robot structurally viable in the continuous Mission: exact-left,
  exact-right, and degraded-right ended upright. It still regressed fourteen
  previously passing gates, so the Judge correctly reverted it.
- A reverted release decision does not erase a useful design branch. The exact
  experiment source is now frozen in the authored articulated candidate while
  the selected rigid Robot Revision remains unchanged. Controller and RL work
  must remove the branch's regressions before any promotion.
- A trained residual is not automatically progress. The best causal residual
  evaluated below the deterministic brace Controller and still timed out in
  degraded Cases, so it remains rejected immutable evidence.

## Progress log

- 2026-07-25: Audited the fourth keel candidate replay. The failed recovery
  ended at `2.681 rad` body tilt and `0.121 m` torso height with foot sites
  about `0.220–0.383 m` above the floor and no supporting feet.
- 2026-07-25: Defined four bounded lateral-reach/co-design points and updated
  the governed Research Agent to consume cross-Session strategy history rather
  than repeat the exhausted keel family.
- 2026-07-25: Session `session-b5415a712be91666` judged all four points. The
  contact-seeking brace improved aggregate score `-14.788 → 68.633`, violations
  `41 → 36`, and normalized severity `177.781 → 77.542`; three of four Mission
  cases ended upright. Fourteen gate regressions still forced `REVERT`.
- 2026-07-25: Froze experiment `002-9b09abe62bef` as a non-promoted design
  branch: `6.27 kg`, `14` Actions, `53` Observations, and the same four declared
  feet. The next tuning problem is wide-stance command tracking and handoff,
  not inverted-basin escape.
- 2026-07-25: Causal Mission retraining produced training Run
  `training-afaf5868a3e9af9f` and Policy
  `articulated-brace-locomotion-62104cabfbc91e7a`. It improved over the rigid
  baseline but scored below the deterministic articulated Controller and
  failed degraded recovery, so it was not promoted.
- 2026-07-25: Published the articulated branch as the current Development
  Review subject. Its READY Work Order now routes complete-design, Controller,
  and two RL lanes against the same no-reset Mission authority.
