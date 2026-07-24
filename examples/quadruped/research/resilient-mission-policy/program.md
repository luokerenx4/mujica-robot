# Continuous resilience residual Policy autoresearch

Train a bounded residual Policy across the full fourteen-second
`resilient-forward-mission`. Stage zero alternates the two authored impact
directions on the exact recoverable plant so the Agent can first demonstrate
useful post-recovery control. A separate wider Domain Profile retains plant,
impact-time, force, and direction variation for the next robustness stage.

The serialized `behavior-supervisor` is the reference Controller and retains
exclusive authority during approach, impact, recovery, and settling. The
Policy may improve only locomotion after the supervisor reports
`recoveryCompleted=true`; its authority ramps in over 0.75 seconds. Do not
remove the residual gate, expose Scenario identity, or substitute training
reward for locked evaluation.

The original 8,192-step candidate was bound to the obsolete 100 N mission and
an older Assembly. Three candidates retrained on the recoverable mission with
pre-impact residual authority all completed recovery, but tiny phase changes
still caused slower recovery, joint-limit use, or self-contact. The learned
lane therefore no longer edits the impact-entry basin. Prefer hypotheses that
improve post-recovery command tracking and motion quality while preserving the
program prior exactly through the stable-recovery witness.

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
