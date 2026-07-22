# Command-tracking gait research program

Improve `command-conditioned-history-3dof` plus `command-tracking-gait` against the locked `command-tracking` Benchmark without modifying any Task, Scenario, Objective, seed, Assembly, interface, source file, or Runtime.

The baseline Controller can stop and walk forward but does not deliberately track reverse, lateral, or yaw commands. The development Controller has explicit world-to-body command transformation and bounded sagittal, abduction, and steering surfaces. Treat this mechanism description as a hypothesis; use the per-case gate values as evidence.

Capability selection is lexicographic. A candidate may never turn a previously passing gate into a failure. Among infeasible candidates, fewer violations wins; at equal count, lower summed normalized violation severity wins; score is considered only after feasibility and severity tie. Fixed-case regression stays anchored to the immutable locked baseline.

Only return numeric proposals declared by `research/command-tracking-gait.research.json`. Prefer one coherent mechanism at a time: command amplitudes first, then feedback, then stability under the disturbed lateral case. Do not loosen gates or trade stop/forward/delay survival for attractive turning motion.
