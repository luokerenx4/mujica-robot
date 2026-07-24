# Self-righting capability and morphology study

Status: active

## Outcome

The quadruped can recover from deterministic front, back, left-side, and right-side resting poses into a stable standing state without external contact, unsafe joint loading, or regressions to its locked locomotion capabilities.

The study compares at least two complete robot candidates:

1. the current rigid torso using coordinated leg motion; and
2. an articulated torso with the smallest viable bounded waist.

A waist is promoted only when locked evidence shows that it adds necessary recovery capability within the mass, cost, action-width, collision, and control-complexity envelope.

## Context

The current capability charter and Benchmarks treat falling as failure but do not define recovery after a fall. That makes a fallen robot terminal in both development reasoning and operation. Adding a waist could increase the reachable recovery workspace, but it also changes the Assembly, Controller action ABI, mass distribution, collision geometry, Training configuration, and hardware boundary. The capability must be specified before choosing the morphology.

## Scope

In scope:

- explicit self-righting requirement and capability stage;
- deterministic resting-pose scenarios with reproducible perturbations;
- contact, joint-limit, energy, time-to-stand, and post-recovery stability evidence;
- rigid-torso and articulated-torso Assembly candidates;
- scripted controller baselines before ML exploration;
- controller-code and RL-policy Research Labs only after the Benchmark is locked;
- regression evaluation against the existing locomotion Benchmarks.

Out of scope:

- assuming a waist is required before the rigid candidate is measured;
- unconstrained morphology search;
- hardware actuation before simulation and shadow evidence;
- weakening existing locomotion gates to accept recovery.

## Acceptance

- The Charter names self-righting as an authored capability stage with exit criteria and non-goals.
- Front, back, left-side, and right-side cases are executable from frozen initial states.
- A Benchmark locks recovery success, time-to-stand, joint-limit margin, peak actuator effort, collision exclusions, and stable standing dwell.
- Both morphology candidates compile and are judged by the same capability contract.
- The selected candidate passes self-righting gates and all required locomotion regressions.
- Studio can replay failed and successful recovery attempts side by side.
- The morphology decision and rejected alternative are preserved as immutable evidence.

## Work

- [x] Author the requirement, stage, scenario matrix, and safety gates.
- [x] Add resting-pose initialization and recovery evidence to the MuJoCo Runtime.
- [x] Establish a rigid-torso scripted recovery baseline.
- [x] Add the smallest viable waist Assembly candidate without changing unrelated morphology.
- [x] Lock one Benchmark shared by both candidates.
- [x] Route remaining blockers to bounded controller-code, RL-policy, and complete-design Labs.
- [ ] Compare, review, and either promote the waist or retain the rigid torso.

## Decision rule

Treat the waist as a testable design hypothesis. Promote it only if the rigid torso cannot satisfy the locked recovery contract, or if the articulated candidate wins by a predeclared margin while preserving all design and locomotion gates.

## Findings and decisions

- One hinge cannot independently address both front/back and left/right resting poses. The smallest honest candidate is a two-axis roll/pitch waist.
- A topology-changing waist must be a Robot Base alternative because the rear legs need to be re-parented. Mounting a moving shell as a Component would produce misleading physics.
- Fallen initialization belongs to the Scenario; stable-recovery semantics belong to a versioned Task. This keeps the same test reusable across morphology and controller candidates.
- Recovery requires terminal-state and dwell metrics. Existing maximum-tilt and ordinary survival gates cannot express success because every valid recovery Run intentionally starts fallen.
- The first rigid and two-axis-waist baselines both roll into an inverted resting basin and fail all four stable-standing gates. A waist alone is therefore not yet evidence of recoverability.
- The first 8,192-step residual PPO Policy scored `-16.214185` versus the original rigid Controller's `-16.148146` and failed all four cases. Training completion is not treated as capability.
- A latched fall-axis Controller experiment was kept (`-16.148146` → `-15.752509`, gate violations `28` → `27`); simply reversing that axis was rejected. The next controller needs an explicit inverted/recovery contact phase rather than another sign or gain tweak.
- The current Development Work Order routes the same blockers to complete-design, controller-code, and RL-policy lanes. All three retain the locked recovery Task, Scenarios, Objective, seeds, and Judge.

## Progress log

- 2026-07-24: Audited the existing Runtime, compiler, Controller contracts, Objectives, and Judge. Confirmed that Scenario could not freeze a base pose, Tasks could not define a recovery target, and ordinary fall termination would stop a self-righting episode immediately.
- 2026-07-24: Recorded the executable contract and morphology decision in `docs/design/self-righting-capability.md`.
- 2026-07-24: Added Task v4, four exact fallen Scenarios, recovery metrics/events/gates, rigid and two-axis-waist Robot Bases/Assemblies, a locked four-case Benchmark, and a complete-design Candidate.
- 2026-07-24: Trained frozen Policy `self-righting-residual-69de67e6fc24d6b6` for 8,192 PPO steps. The locked evaluation regressed and preserved the failure as negative evidence.
- 2026-07-24: Research session `session-f6f27d561cf0dff1` kept experiment `001-20c9db8b9b3c` and published Revision `quadruped-r-15b699d96b4e`; session `session-86d634e81120be65` rejected the follow-up sign inversion.
- 2026-07-24: Published Development Review `development-review-6741f44ff25461e7` and Work Order `development-work-order-4316fbc2ee194b44`, routing three bounded intervention lanes without changing the requirement.
