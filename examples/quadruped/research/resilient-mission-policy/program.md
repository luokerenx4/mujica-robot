# Continuous resilience residual Policy autoresearch

Train a bounded residual Policy across the full fourteen-second
`resilient-forward-mission`. Episodes continuously randomize plant dynamics and
impact time, force, and direction around the two authored base Scenarios.

The serialized `behavior-supervisor` is the reference Controller and retains
exclusive authority during recovery and handoff. The Policy may improve only
the pre-recovery locomotion/contact basin through its gated residual. Do not
remove the residual gate, expose Scenario identity, or substitute training
reward for locked evaluation.

The first 8,192-step candidate improved joint-limit margin and aggregate score
slightly but recovered in neither case. Prefer hypotheses that measurably alter
the pre-impact body state or fall-entry momentum across the continuous Domain
Profile. Keep exploration and residual authority small enough to preserve the
program prior.

The locked `resilient-mission` Judge compares every frozen Policy against both
the current learned candidate and the program reference, then runs static
self-righting, recovery-handoff, command-tracking, and transition regressions.
Only the Judge may publish a Policy Revision.

Edit the isolated workspace directly, then print exactly one proposal object:

```json
{
  "strategy": "short-kebab-case",
  "hypothesis": "Why the bounded training or residual change should improve the continuous impact basin.",
  "expectedEffect": "Which locked mission gates should improve without atomic regressions."
}
```
