# Forward locomotion milestone

Status: completed on 2026-07-22.

## Goal

Replace standing-biased velocity scoring with verifiable forward locomotion, establish a multi-seed robustness benchmark, promote a walking program controller, and train a periodic residual policy under the same frozen evaluator.

## Delivered

- Episode-level net displacement, target progress, mean forward velocity, lateral drift, and path-length metrics.
- Forward-progress and lateral-drift Objective terms and gates.
- Seeded, reproducible joint-state reset perturbations.
- Per-case required gates versus explicit scored challenges.
- A seven-case locked forward-locomotion benchmark.
- A left-right-symmetric program gait and bounded controller research ledger.
- A periodic force-aware residual PPO transform shared by collection and inference.
- A governed 29-attempt training ledger and parent-linked Policy Revisions.
- A whole-robot Candidate KEEP and immutable Robot Revision.

## Verification evidence

- Stationary audit: 2.9 cm in three seconds under the old controller.
- Program controller: `72.94594910737753`; required-case distance `0.6506–0.9770 m`; all required cases survive 5 seconds.
- Locked baseline: `49.35998545716317`; Candidate delta `+23.58596365021436`; no gate reasons.
- Learned policy: `71.23071451203992` after the 4096-step cost; training neighborhood exhausted.
- Robot Revision: `quadruped-r-5c96344630e7`.
- Policy Revision head: `quadruped-p-9c6aa2aa2c8b`.
