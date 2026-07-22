# Quadruped policy autoresearch

- Status: `completed`
- Updated: `2026-07-22`
- Related design: [policy training research](../docs/design/policy-training-research.md)

## Outcome

Native Python/PyTorch training now participates in Mujica's governed experiment loop. A force-aware residual PPO policy starts from the stable sensor-aware controller, candidate Training configurations produce immutable Policy Artifacts, fixed evaluation decides KEEP, and accepted results advance a separate Policy Revision lineage.

## Acceptance

- [x] Training and frozen inference share one serialized residual action transform.
- [x] `mujica train-research` validates bounded built-in or external proposals.
- [x] Every candidate Training Run and Policy is immutable; KEEP/REVERT/CRASH attempts have a compact ledger and authoritative artifact.
- [x] KEEP atomically advances Training plus the promoted policy Controller and publishes a child Policy Revision.
- [x] Runtime, Harness, Trainer, and dependency changes invalidate the appropriate cache, lock, and experiment memory context.
- [x] Policy scores include the Objective's training-step cost.
- [x] A real run improves and exhausts the declared neighborhood.
- [x] TypeScript and Python tests pass.

## Findings

- 2026-07-22 — Zero-torque PPO was the wrong starting condition for this robot. A serialized force-aware PD residual transform raised the 4096-step frozen policy from the old PPO lane's roughly `77.54` to `84.19` under budget-aware scoring.
- 2026-07-22 — More optimization was not better: 2048 steps beat 4096 and 6144. Training reward alone would not have revealed the complete locked-Benchmark tradeoff.
- 2026-07-22 — The Objective's `trainingSteps` term had existed but was not passed into policy evaluation. Wiring Policy manifest budget into evaluation lowered claims and kept the program controller as the honest whole-robot best.
- 2026-07-22 — Runtime version strings were insufficient provenance. Benchmark, Run, and Policy identity now cover production evaluator source and dependency locks.

## Verification

- 11 real Training Research experiments: 1 KEEP, 10 REVERT, `exhausted=true`.
- Learned-policy score: `84.18884075657773 -> 84.23980305153188` (`+0.050962294954146614`).
- Policy Revision head: `quadruped-p-9183737b672f`.
- `bun run test`: 12 TypeScript tests and 4 Python tests pass.
- Project validation resolves 5 Controllers, 2 Trainers, 3 Training definitions, and one Training Research definition across both MuJoCo assemblies.
- Independent locked evaluation: old PPO `77.5443010007537`, best program controller `84.25444528948661`, promoted residual Policy `84.23980305153188`.
- All three promoted-policy cases survive fully; each includes the explicit `-0.02048` cost for 2048 training steps.
- Ledger/artifact audit: 11 rows, 11 immutable experiment directories, 1 KEEP, 10 REVERT, one matching Policy Revision, and a byte-identical Policy snapshot hash.
