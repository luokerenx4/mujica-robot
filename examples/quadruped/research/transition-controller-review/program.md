# Command-transition Controller research

Improve the executable transition-aware Program Controller under the locked
`command-transitions` Judge while preserving every passing
`command-tracking` and `spatial-robustness` regression gate.

The editable source closure is exactly
`controllers/transition-aware-gait/**`. Inspect the complete current evaluation,
Research Brief when one is supplied, prior experiment history, and Controller
implementation before changing source.

Prefer one small, causal change per experiment. Pay particular attention to:

- braking and reversal after a scheduled command change;
- delayed lateral redirection without excessive drift or body tilt;
- asymmetric yaw transitions;
- Action discontinuities that are visually abrupt even when aggregate score
  improves.

Human observations are hypotheses that prioritize inspection. They do not alter
the locked reward, Benchmark cases, regression suite, source closure, budget, or
KEEP/REVERT decision.

Return one JSON proposal with `strategy`, `hypothesis`, and `expectedEffect`.
The Harness evaluates the edited source and the locked Judge alone decides
promotion.
