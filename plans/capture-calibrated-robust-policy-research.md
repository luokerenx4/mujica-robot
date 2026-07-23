# Capture-calibrated robust Policy research

- Status: `completed`
- Updated: `2026-07-23`
- Related design: [Capture-calibrated Policy research](../docs/design/capture-calibrated-policy-research.md), [Research Lab V2](../docs/design/research-lab-v2.md), [Hardware capture protocol](../docs/design/hardware-capture-protocol.md)

## Outcome

A Coding Agent can modify a dedicated PPO source closure, train against the
capture-derived Domain Profile and measured failure scenarios, and retain a new
Policy head only when locked robot capability gates improve without regression.

## Context

The first capture-calibrated Policy improved `spatial-robustness` aggregate
score from `60.4130` to `60.6407`, but introduced a strong-push survival
violation and still moved backwards under low friction. Its Training definition
sampled the calibrated mass/damping/strength/delay Profile but exposed PPO only
to nominal and reset scenarios. The learning distribution therefore omitted
both measured primary failures.

## Scope

### In scope

- A dedicated Trainer and Research Lab source closure for capture-calibrated PPO.
- Low-friction and strong-lateral-push scenarios in the Training distribution.
- Bounded experiments over sample budget, residual authority, exploration,
  regularization, and the declared scenario set.
- Gate-first primary judgement on `spatial-robustness`.
- Locked spatial-generalization and motion-quality regression suites.
- Immutable Training Runs, Policies, Experiments, Sessions, and Policy Revisions.

### Out of scope

- Changing the captured evidence, promoted Domain Profile, Runtime reward,
  robot Assembly, program prior, Benchmark, Objective, gates, or seeds.
- Online learning during evaluation or deployment.
- Claiming synthetic capture as HIL/real evidence.

## Acceptance

- [x] The Lab validates and exposes only its dedicated Trainer, Training, and Policy Controller source.
- [x] Agent proposals cannot change capture evidence, Profile, Runtime, Judge, seeds, or robot hardware.
- [x] Every attempt performs real PPO, freezes the Policy, and evaluates the complete locked primary and regression suites.
- [x] KEEP requires fewer primary violations or a gate-preserving material score improvement, with no regression-suite gate loss.
- [x] At least two legible ML hypotheses are executed and preserved, including rejected evidence.
- [x] The resulting source head and failure frontier are documented honestly.
- [x] Project validation, full tests, locks, commit, and remote push pass.

## Work

- [x] Audit the capture-calibrated Training distribution against measured failures.
- [x] Add the dedicated Trainer, Lab contract, human program, and deterministic reference Researcher.
- [x] Run governed PPO experiments and inspect per-case evidence.
- [x] Verify, document, commit, and push.

## Findings and decisions

- 2026-07-23 — The first Policy's main distribution error is observable:
  calibration randomizes plant dynamics, but Training omitted both scenarios
  that failed the frozen Judge.
- 2026-07-23 — This Lab owns a dedicated Trainer package. A KEEP must not
  silently change the semantics of unrelated historical Training definitions.
- 2026-07-23 — Primary feasibility outranks aggregate score. Removing the
  strong-push regression is progress even if a safer residual gives up a small
  average-score gain; low-friction remains an explicit unsolved frontier.
- 2026-07-23 — Hard-case residuals at `0.10` and `0.05` improved aggregate
  score to `61.3694` and `60.9217`, respectively. Both REVERT: the former
  increased primary violations `3 → 5`; the latter recovered strong-push and
  delayed performance but lost reset, generalized-delay, saturation, and impact
  gates.
- 2026-07-23 — Repeating the deterministic second candidate exposed a Harness
  defect: Training Run IDs correctly matched, but volatile absolute paths and
  elapsed time made directory byte hashes differ. Research import now reuses a
  Run only after its manifest and stable result identity match exactly.
- 2026-07-23 — The first quality-guarded session crashed before Training because
  `qualityReward` is a closed six-term contract and the Researcher omitted
  explicit zeroes. The three CRASH artifacts are retained; the Researcher now
  declares every term instead of relying on implicit omission.
- 2026-07-23 — Calibration Runs and Hardware Captures are generated but not
  disposable inside an isolated Research workspace: a provenance-bound Profile
  revalidates that evidence before Training. They remain copied as read-only
  guarded dependencies and stay outside the Agent-editable source closure.

## Progress log

- Session `session-1fead455a9be2bd0` froze two valid Policies and retained one
  collision CRASH. Scores `61.3694` and `60.9217` both REVERT on gate loss.
- Session `session-ae5fcfdf4ffc7a75` retained three schema-contract CRASH
  artifacts before Training.
- Session `session-4ec5558f54c6e22f` proved that calibration evidence must be
  present in the isolated workspace and retained three missing-evidence CRASH
  artifacts.
- Session `session-472bb9fdf9106129` froze three micro-residual Policies. Each
  reduced primary violations `3 → 2`; all REVERT on regression gate loss.
- Session `session-64964e8b1bfdea57` replayed the first deterministic candidate,
  safely reused Training Run `training-e7a4f1ed12f29bc8` and its Policy, and
  reproduced the exact evaluation without an artifact collision.
- No candidate reached KEEP. The source Controller remains
  `capture-calibrated-spatial-residual-locomotion-9539500c844b2ddc`.
