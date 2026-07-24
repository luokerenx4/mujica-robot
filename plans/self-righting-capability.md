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
- [x] Compare, review, and retain the rigid torso after the waist fails to justify its added mechanism.
- [x] Re-open the waist hypothesis under the complete no-reset Mission rather
  than relying on isolated self-righting evidence.
- [ ] Integrate recovery selection with the locomotion supervisor and add perturbed-pose robustness cases before calling the capability operationally complete.

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
- A body-up-vector classifier avoids Euler-angle ambiguity and selects one of four fallen poses. The selected rigid-torso Controller then executes `impulse → capture → rise → stand`, requiring contact support and a stable-target streak before handing off.
- Candidate `phased-self-righting` passed all four locked cases and was kept as Robot Revision `quadruped-r-0bb926344064`. Its score improved from `-15.752509` to `90.306324`, removed all 27 baseline gate violations, and retained the existing rigid morphology and 12-channel Action ABI.
- The waist hypothesis remains rejected: the rigid robot now demonstrates that an articulated torso is not necessary for the four authored resting poses.
- A second 8,192-step PPO experiment with only `0.001` residual authority reported a high training reward but failed front, left, and right recovery under the frozen Judge. Candidate `phased-self-righting-residual` was explicitly `REVERT` with a `-79.037963` score delta and 20 named gate reasons. The deterministic phased Controller remains selected; the learned Policy is preserved as negative evidence.
- The exact four poses are a first capability witness, not a robustness claim. Recovery arbitration from a walking Controller and bounded pose/contact variation remain open.
- The deterministic behavior supervisor now executes one continuous `approach → impact → recovery → resume` mission and passes mirrored left/right impacts without reset. A dedicated residual Policy may act only after `recoveryCompleted=true`; it cannot perturb impact entry or self-righting.
- Continuous-episode PPO now masks actor optimization by actual residual authority while retaining whole-episode critic learning. A separate episode-isolation fix prevents the resume gait mutated by one supervisor instance from leaking into later training episodes.
- Stage-zero Policy `resilient-mission-residual-8af2efac119bc98c` passes both continuous missions with zero safety violations but scores `0.126070` below the deterministic supervisor, so it is retained as `REVERT` evidence. Perturbed plant, impact, and fallen-pose recovery remain open before this capability is operationally complete.
- Integrated Candidate `integrated-resilience-waist-design` was judged on four
  complete `approach → impact → recover → resume → redirect → traverse → stop`
  Missions. Its neutral comparison scored `-14.293828` versus rigid
  `38.935033` and failed all four recovery handoffs.
- Research session `session-2c2867adccdca750` found a real but insufficient
  mechanical signal: experiment `001-e9997df1cda1` reduced Mission violations
  `44 → 42`, then failed isolated recovery, joint-limit, and collision
  regressions. Experiment `002-6dae00f711e7` worsened the Mission. Both were
  reverted and the rigid robot remains selected.
- The next waist attempt must co-design split-torso geometry, contact
  workspace, and leg/waist sequencing. An isolated self-righting gain cannot
  justify a morphology that fails the continuous mission.
- Continuous Mission testing found a post-recovery coordinate-frame defect:
  the Task requested world-frame motion while the resumed gait initially used
  body-forward tracking. Kept Controller experiment `001-950524569565` derives
  the handoff heading from the observed quaternion, restores world-frame
  tracking, and publishes Revision `quadruped-r-40206836cd00`. Suite score
  improved `38.935033 → 39.119018` with no gate regression.
- Three PPO micro-residuals on that stronger prior were rejected. One crossed
  the right-exact yaw gate; two safer variants failed to beat the program
  Controller. Degraded-impact recovery, rather than residual scale, remains
  the next self-righting bottleneck.

## Progress log

- 2026-07-24: Audited the existing Runtime, compiler, Controller contracts, Objectives, and Judge. Confirmed that Scenario could not freeze a base pose, Tasks could not define a recovery target, and ordinary fall termination would stop a self-righting episode immediately.
- 2026-07-24: Recorded the executable contract and morphology decision in `docs/design/self-righting-capability.md`.
- 2026-07-24: Added Task v4, four exact fallen Scenarios, recovery metrics/events/gates, rigid and two-axis-waist Robot Bases/Assemblies, a locked four-case Benchmark, and a complete-design Candidate.
- 2026-07-24: Trained frozen Policy `self-righting-residual-69de67e6fc24d6b6` for 8,192 PPO steps. The locked evaluation regressed and preserved the failure as negative evidence.
- 2026-07-24: Research session `session-f6f27d561cf0dff1` kept experiment `001-20c9db8b9b3c` and published Revision `quadruped-r-15b699d96b4e`; session `session-86d634e81120be65` rejected the follow-up sign inversion.
- 2026-07-24: Published Development Review `development-review-6741f44ff25461e7` and Work Order `development-work-order-4316fbc2ee194b44`, routing three bounded intervention lanes without changing the requirement.
- 2026-07-24: Added contact-qualified phase telemetry and promoted rigid-torso Candidate `phased-self-righting` as Revision `quadruped-r-0bb926344064`; front, back, left, and right all passed the locked recovery and safety gates.
- 2026-07-24: Trained residual Policy `phased-self-righting-residual-5ae0422798bf8d30` from the successful prior. Strict replay rejected it despite strong training reward, establishing that phase/contact sequence preservation must be an explicit ML constraint.
- 2026-07-24: Integrated recovery into the locomotion supervisor and locked a reset-free mirrored-impact mission. Added post-recovery-only residual PPO, actor-authority masking, and per-episode Controller configuration isolation. The best 8,192-step seed preserved every continuous-mission gate but was honestly rejected for a `-0.126070` score delta.
- 2026-07-24: Published current Development Review `development-review-f0ed5ab54c39bb4c` and Work Order `development-work-order-2f89c0b56af2f552`. Studio snapshot `studio-7ba7a27c3fb48f79` compares 700-frame supervisor and learned-Policy Runs on the same left-impact mission while preserving the Policy as a non-promoted candidate.
- 2026-07-24: Re-opened the waist as a complete-robot hypothesis on the
  18-second Mission Suite. Research session `session-2c2867adccdca750`
  preserved two reverted source experiments, and current Work Order
  `development-work-order-0981e41eb1643ca7` routed complete-design,
  Controller-code, and RL-policy work under the same locked acceptance test.
- 2026-07-24: Promoted measured-heading post-recovery handoff as Revision
  `quadruped-r-40206836cd00`. Three subsequent residual PPO experiments were
  preserved as negative evidence; none passed the unchanged Mission authority.
- 2026-07-24: Published Review `development-review-161b2ff0add84e0f` and Work
  Order `development-work-order-0ee33d0b4224cd04`; degraded left/right impact
  recovery is now the highest-priority shared blocker.
