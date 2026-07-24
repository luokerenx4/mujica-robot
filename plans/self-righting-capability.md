# Self-righting capability and morphology study

Status: candidate

## Outcome

The quadruped can recover from deterministic front, back, left-side, and right-side resting poses into a stable standing state without external contact, unsafe joint loading, or regressions to its locked locomotion capabilities.

The study compares at least two complete robot candidates:

1. the current rigid torso using coordinated leg motion; and
2. an articulated torso with one deliberately bounded waist joint.

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

- [ ] Author the requirement, stage, scenario matrix, and safety gates.
- [ ] Add resting-pose initialization and recovery evidence to the MuJoCo Runtime.
- [ ] Establish a rigid-torso scripted recovery baseline.
- [ ] Add the smallest viable waist Assembly candidate without changing unrelated morphology.
- [ ] Lock one Benchmark shared by both candidates.
- [ ] Route remaining blockers to bounded controller-code and RL-policy Labs.
- [ ] Compare, review, and either promote the waist or retain the rigid torso.

## Decision rule

Treat the waist as a testable design hypothesis. Promote it only if the rigid torso cannot satisfy the locked recovery contract, or if the articulated candidate wins by a predeclared margin while preserving all design and locomotion gates.
