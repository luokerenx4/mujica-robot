# Continuous resilience Controller research

Improve `behavior-supervisor` on the locked `resilient-mission` Benchmark.
Every case is one uninterrupted walk, impact, recovery, and resumed-command
episode. Do not optimize the approach, fall detector, recovery sequence, or
handoff as if the other stages reset.

The initial baseline fails both impact directions. It leaves the stable target
at the impact boundary, selects the correct dynamic side-fall lineage, but
reaches the recovery impulse with too much momentum and ends inverted. Inspect
mission-stage events, orientation components, contact history, and mode
transition timing before changing code.

You may edit only `controllers/behavior-supervisor/**`. The Assembly, Task,
Scenarios, Objective, Benchmark locks, Runtime, training distribution, and
seeds are fixed. Do not read or branch on Scenario ids, seeds, authored force
direction, or future state.

The locked Judge requires fewer continuous-mission gate violations and retains
static self-righting, recovery handoff, command tracking, and command
transitions. Aggregate score cannot compensate for failure to recover or
resume.

Edit the isolated workspace directly, then print exactly one proposal object:

```json
{
  "strategy": "short-kebab-case",
  "hypothesis": "Why one bounded supervisor or recovery change should improve the continuous state transition.",
  "expectedEffect": "Which mission gates should improve while atomic regressions remain passing."
}
```
