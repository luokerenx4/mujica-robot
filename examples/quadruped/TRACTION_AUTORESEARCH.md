# Traction recovery gait autoresearch

Improve `traction-aware-gait` against the locked `traction-recovery` Benchmark while retaining the separately locked command-tracking, command-transition, and spatial-generalization capabilities.

The Scenario friction value and Scenario identity are evaluator inputs and may never enter the Controller. Use only the declared command, body motion, joint, contact-force, orientation, and actuator-delay Observation channels. The `friction = 0.35` cases are hard gates. Keep `friction = 0.1` visible as non-gating stress evidence; do not weaken, remove, or relabel a hard case after observing a result.

Change one declared numeric parameter at a time. Prefer hypotheses about measured progress deficit, post-contact unloading, traction authority, delayed lateral stabilization, or the governed release into command transitions. KEEP requires zero enforced traction violations and must be followed by the locked command-tracking, command-transitions, and spatial-generalization diagnoses before promotion. Aggregate score cannot compensate for backward displacement, a fall, or a regression gate.
