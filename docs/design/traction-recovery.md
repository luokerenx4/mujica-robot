# Traction recovery

## Capability boundary

The friction-correct Runtime exposed a false-positive robustness claim: the frozen spatial policy survived `friction = 0.35` for the full episode while moving `0.238 m` backward. Survival and clipped forward progress could describe the failure, but they could not express its sign or make backward slip a first-class gate.

Mujica now reports `signedForwardProgress = forwardDisplacement / targetDistance` and `backwardDisplacement = max(0, -forwardDisplacement)` alongside the score-compatible clipped `forwardProgress`. Objectives can gate both values. Every trajectory row also stores the four-value `footContactForce` Observation when the Assembly provides it, so a human or Agent can reproduce contact hypotheses without reading Scenario labels.

## Deployable controller response

`traction-aware-gait` receives the same named Observation subset as the prior command Controller. It cannot read Scenario identity, the authored friction coefficient, global evaluator state, or future Task segments.

For zero actuator delay, it integrates commanded and measured forward progress over a bounded `1.5 s` assessment window. A progress deficit greater than `0.18 m` latches a larger sagittal gait. For three-step delay, waiting for measured displacement is too late because commands are already queued. The Controller therefore enters a conservative delayed traction gait after the first control tick and observes a bounded initial contact sequence. First contact above `10 N/foot` followed by unloading below `2 N/foot` records measured traction risk; normal contact remains classified separately even though the conservative gait is retained until a command boundary.

The delayed gait uses `1.8×` hip amplitude, `1.5×` sagittal damping, zero added phase lead, and `0.049` episode-relative lateral-position feedback. These are bounded Controller config values, not Runtime branches. On a command change, a `0.15 s` blend releases phase and sagittal authority into the transition controller while retaining lateral stabilization. Reversal uses `0.3` forward-velocity feedback, braking uses `0.5`, and a small reachable `0.1` yaw damping term settles asymmetry without previewing the command schedule.

This design deliberately prefers a safe high-delay mode over a brittle post-slip mode. Experiments that waited until `0.1–0.2 s` to switch either fell or survived without recovering the required distance. Experiments that released the conservative gait during a constant command introduced phase drift. Both failure families remain immutable Runs.

## Locked evidence

The `traction-recovery` Benchmark contains eight hard cases and one non-gating stress case. The kept Controller has zero hard violations:

- nominal, reset, payload, 50 N lateral push, and normal three-step delay remain within their gates;
- `friction = 0.35`, its reset variant, and its three-step-delay variant all survive and advance;
- hard `friction = 0.2` survives with signed progress `0.431`;
- `friction = 0.1` survives only `53.6%`, moves `0.309 m` backward, and remains explicitly non-gating.

The governed Candidate improves the frozen traction score from `50.4468` to `64.1743`, removes all 12 baseline violations, and publishes Robot Revision `quadruped-r-3275cb855510`. Separate locked diagnoses report zero violations for `command-tracking`, `command-transitions`, and `spatial-generalization`. The delayed braking regression settles both planar transitions and both yaw transitions; braking settles in `1.82 s`.

## Human and Agent surface

Humans can inspect signed motion and foot forces in Runs and Studio, reproduce the ranked worst case with `mujica diagnose`, and read the explicit capability boundary above. Agents receive the same evidence through versioned JSON. `research/traction-recovery-gait.research.json` exposes only ten bounded numeric parameters, while `TRACTION_AUTORESEARCH.md` fixes the no-Scenario-leak rule and requires all three regression diagnoses before promotion.
