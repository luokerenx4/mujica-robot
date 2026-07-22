# Mujica work plans

Plans coordinate one capability slice across schema, Runtime, Controller, evidence, and tests. They are execution records, not the durable specification; stable invariants move into `docs/design/`.

Each active Plan uses the same contract:

- `Outcome` states the observable robot capability, not an implementation activity.
- `Context` names the measured bottleneck that makes this slice next.
- `Scope` fixes what may and may not change so an Agent cannot broaden the task silently.
- `Acceptance` is the release contract. A Plan completes only when every item has evidence.
- `Work` is the short ordered checklist and may evolve as evidence changes the route.
- `Findings and decisions` records why important choices changed; durable rules are copied into design docs.
- `Progress log` cites immutable Runs, Experiments, Revisions, verification records, scores, and tests.

There is normally one active capability Plan. Follow-on work gets a new Plan instead of extending a completed acceptance contract.

## Active plans

- [Command transitions and braking](plans/command-transitions-and-braking.md) — make time-varying motion intent executable and gate transient response, stopping, reversal, and delayed recovery.

## Completed plans

| Plan | Outcome | Updated |
| --- | --- | --- |
| [Command-conditioned locomotion](plans/command-conditioned-locomotion.md) | Made Task motion intent executable and published a zero-violation controller across stop, forward, reverse, lateral, yaw, delay, and disturbance without regressing spatial robustness. | 2026-07-23 |
| [Evidence-guided compound recovery](plans/evidence-guided-compound-recovery.md) | Added evidence-ranked diagnosis, fixed gate-first research governance, and published an all-gate-passing delay/disturbance recovery Robot Revision. | 2026-07-23 |
| [Executable Controller interfaces](plans/executable-controller-interfaces.md) | Added explicit Program Controller I/O contracts, pre-Runtime compatibility enforcement, and human/Agent discovery of legal Assembly combinations. | 2026-07-23 |
| [Complete harness audit](plans/completion-audit.md) | Closed the audited Candidate, Revision, Component inventory, Policy compatibility, Studio, typed configuration, structural mounting, and hardware-boundary gaps. | 2026-07-23 |
| [Forward locomotion milestone](plans/forward-locomotion-milestone.md) | Added honest net-motion scoring, seeded robustness cases, a promoted walking Robot Revision, and periodic residual-policy research. | 2026-07-22 |
| [Quadruped policy autoresearch](plans/quadruped-policy-autoresearch.md) | Added force-aware residual PPO, complete evaluator identity, immutable training experiments, and a budget-aware Policy Revision. | 2026-07-22 |
| [Quadruped autoresearch loop](plans/quadruped-autoresearch-loop.md) | Delivered a bounded autonomous loop with immutable experiments, compact memory, gates, and child revisions; 43 real experiments improved the controller and exhausted its neighborhood. | 2026-07-22 |
| [Mujica foundation](plans/mujica-foundation.md) | Delivered the first complete robot assembly, execution, training, evaluation, and revision loop. | 2026-07-22 |
