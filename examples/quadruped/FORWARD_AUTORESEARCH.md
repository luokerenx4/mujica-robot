# Forward locomotion controller research program

Improve the symmetric force-aware quadruped gait under the locked `forward-locomotion` Benchmark.

The score must come from net forward displacement, not oscillation or instantaneous velocity. Every gating case must survive, reach the minimum forward-progress ratio, and stay below the lateral-drift limit. The actuator-delay case is a scored challenge but is not yet a promotion gate; never hide or remove it.

Only propose numeric values declared in `research/forward-gait.research.json`. The Assembly, controller implementation, tasks, scenarios, Objective, Benchmark lock, Runtime, evaluator, and dependencies are fixed. Preserve left-right symmetry. Use the complete multi-seed result, not one nominal trajectory, as evidence.

Return only the proposal JSON requested by the CLI protocol.
