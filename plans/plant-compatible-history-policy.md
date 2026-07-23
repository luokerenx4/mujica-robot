# Plant-compatible history-aware Policy

## Outcome

An Agent can transfer capture-derived physical calibration to an Assembly with bounded actuator history, train a history-aware residual Policy, and judge it against locked robustness and motion-quality gates without weakening Policy ABI checks.

## Context

The capture-calibrated Profile was fitted on `force-sensing-3dof`, while delay-aware policy learning needs `force-sensing-history-3dof`. Their MuJoCo plant is identical; the composed XML differs only by a runtime-observation comment, while their Observation Contracts intentionally differ. Exact `modelHash` was therefore too strict for Profile compatibility and remains correctly strict for Policy execution.

## Scope

- Add a narrow physical `plantHash` alongside exact model and execution identities.
- Bind newly generated calibration evidence and Profiles to that identity.
- Reject plant-incompatible Profiles in both CLI and Runtime training boundaries.
- Train one bounded-history residual PPO Policy from the frozen delay-aware program prior.
- Judge primary spatial robustness plus spatial-generalization and motion-quality regressions.
- Do not requalify old Policies, erase historical v1 evidence, or claim real-hardware verification from dry-run captures.

## Acceptance

- Comment/inter-tag formatting changes preserve `plantHash`; actual MJCF element or attribute changes do not.
- The ordinary and history Assembly have equal `plantHash` but distinct Observation Contracts and `executionHash`.
- A fresh promoted v2 Profile records immutable Calibration evidence and the shared `plantHash`.
- Mismatched Profile/Assembly training fails closed before optimization.
- The frozen history-aware Policy records plant, Profile, prior Controller, Runtime, Harness, dependency, and contract identities.
- Locked primary and regression Benchmarks record the candidate verdict, including an honest REVERT if it does not beat the program prior.
- TypeScript, CLI/Studio, and Python tests pass; generated evidence is content-addressed.

## Work

1. Implement and test `plantHash`.
2. Recalibrate and promote the v2 capture-derived Profile.
3. Train the history-aware delay-prior Policy.
4. Run governed Benchmarks, lock evidence, update durable design notes, and ship.

## Findings and decisions

- `modelHash` and `executionHash` remain exact. Physical Profile portability is narrower than executable Policy compatibility.
- Canonicalization removes only XML comments and inter-tag whitespace; it is not an XML semantic equivalence engine.
- Historical Profiles remain parseable but are not retroactively granted a `plantHash`.
- The first micro-residual beat the first neural Policy and legitimately published a research Policy Revision, but it still regressed against the frozen program prior. Policy Labs now accept an explicit `referenceController` and enforce that reference on the primary and every regression Benchmark; improving on a worse neural predecessor is no longer sufficient for promotion.
- History conditioning produced useful primary-score signal, but none of the tested residuals retained the program prior's held-out delay gates. The program Controller remains the deployable choice; learned Policies remain immutable research evidence.

## Progress log

- 2026-07-23: Confirmed the two target Assemblies have identical MuJoCo dimensions and mass; their composed model diff is one runtime-only XML comment.
- 2026-07-23: Calibration Run `calibration-cbb6ff34cc6d23ec` recovered mass `1.05`, damping `0.825`, strength `1.175`, and delay `2`; validation loss `0.014912677` passed the `0.02` bound. Promoted `quadruped-dry-run-capture-calibrated-v2` with plant `686fb75a9933c12b6adbcfe562cca4af7e17932e784aa3c482edd85d85b39cfa`.
- 2026-07-23: Initial GRU Policy `capture-calibrated-history-residual-locomotion-fbc659cd5e783fe0` scored `55.304145` versus program prior `55.552066` and regressed delayed lateral drift plus held-out generalization and motion-quality gates.
- 2026-07-23: Session `session-c0a822f0a997d0c4` kept a `0.002` micro-residual relative to the previous learned Policy (`55.530158`, Policy Revision `quadruped-p-ed7ad2ff20dd`) and reverted a larger frontier attempt (`55.710588`) for delay/generalization regressions.
- 2026-07-23: After adding the mandatory program reference, session `session-731f9ca179aaf909` tested a `0.0005` near-prior residual. It scored `55.645683` but was REVERTED for `reference-controller: no-lexicographic-improvement` and a held-out `delay-plus-reset` lateral-drift regression. No deployment source changed.
- 2026-07-23: Current hardware boundary `hardware-584b6ed827b92f7f` is `PROTOCOL-VERIFIED` by `verification-d1f15a0fed045160`; `hardwareVerified` remains false because all capture evidence is dry-run synthetic.
- 2026-07-23: Final verification passed TypeScript/Core/CLI/Studio `52/52` and Python Runtime `35/35`; all thirteen Benchmark locks were regenerated against the final Runtime/Harness.
