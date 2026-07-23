# Traction recovery

## Capability boundary

The friction-correct Runtime exposed a false-positive robustness claim: the frozen spatial policy survived `friction = 0.35` for the full episode while moving `0.238 m` backward. Survival and clipped forward progress could describe the failure, but they could not express its sign or make backward slip a first-class gate.

Mujica now reports `signedForwardProgress = forwardDisplacement / targetDistance` and `backwardDisplacement = max(0, -forwardDisplacement)` alongside the score-compatible clipped `forwardProgress`. Objectives can gate both values. Every trajectory row also stores the four-value `footContactForce` Observation when the Assembly provides it, so a human or Agent can reproduce contact hypotheses without reading Scenario labels.

Sagittal stability is explicit evidence too. Trajectories carry signed `pitchRad` and `pitchRateRadPerSec` using MuJoCo's `wxyz` quaternion convention. Run metrics retain mean, minimum, maximum, maximum absolute, maximum backward, and maximum-rate values. Objectives may gate the dangerous signed backward excursion independently of absolute pitch, because the established gait's forward rotation and the observed backward traction tumble are behaviorally distinct.

Full torso quality is specified separately in [Upright locomotion](upright-locomotion.md). Its quaternion-derived body tilt complements signed pitch without confusing yaw with inclination.

## Deployable controller response

`traction-aware-gait` receives the same named Observation subset as the prior command Controller. It cannot read Scenario identity, the authored friction coefficient, global evaluator state, or future Task segments.

For zero actuator delay, it integrates commanded and measured forward progress over a bounded `1.5 s` assessment window. A progress deficit greater than `0.18 m` latches a larger sagittal gait. For three-step delay, waiting for measured displacement is too late because commands are already queued. The Controller therefore enters a conservative delayed traction gait after the first control tick and observes a bounded initial contact sequence. First contact above `10 N/foot` followed by unloading below `2 N/foot` records measured traction risk; normal contact remains classified separately even though the conservative gait is retained until a command boundary.

The delayed gait uses `1.8×` hip amplitude, `1.5×` sagittal damping, zero added phase lead, and `0.049` episode-relative lateral-position feedback. These are bounded Controller config values, not Runtime branches. On a command change, a `0.15 s` blend releases phase and sagittal authority into the transition controller while retaining lateral stabilization. Reversal uses `0.3` forward-velocity feedback, braking uses `0.5`, and a small reachable `0.1` yaw damping term settles asymmetry without previewing the command schedule.

This design deliberately prefers a safe high-delay mode over a brittle post-slip mode. Experiments that waited until `0.1–0.2 s` to switch either fell or survived without recovering the required distance. Experiments that released the conservative gait during a constant command introduced phase drift. Both failure families remain immutable Runs.

`bounded-traction-gait` extends the zero-delay response without reading friction. Mild recovery retains the proven `2.0×` hip amplitude. If signed body pitch crosses `-0.15 rad`, severe mode latches and bounds recovery at `1.74×`. This avoids the `2.0×` backward-tumble boundary while preserving the authority required by the earlier low-friction reset. An attempted instantaneous forward-velocity classifier was rejected: within-stride velocity oscillation falsely classified a passing `friction = 0.35` case. Pitch is continuous deployable state rather than a proxy Scenario label.

## Locked evidence

The original `traction-recovery` Benchmark contains eight hard cases and one non-gating stress case. The kept bounded Controller still has zero hard violations:

- nominal, reset, payload, 50 N lateral push, and normal three-step delay remain within their gates;
- `friction = 0.35`, its reset variant, and its three-step-delay variant all survive and advance;
- hard `friction = 0.2` survives and advances;
- the former `friction = 0.1` failure now survives and advances without backward displacement.

The `extreme-traction` Benchmark contains ten hard cases and one non-gating stress case. Three seeded `friction = 0.1` reset cases prevent a single lucky reset from defining the capability. All hard cases survive, have zero backward displacement, stay below `0.5 rad` backward pitch, and reach signed progress at least `0.25`. The selected cases record `0.468` on unperturbed extreme traction and `0.366`, `0.497`, and `0.430` across the reset seeds. `friction = 0.05` remains explicit non-gating evidence and currently fails.

The final governed Candidate improves the expanded extreme score from `47.5783` to `66.0074`, removes all 20 baseline violations, and publishes child Robot Revision `quadruped-r-1101a73a0752`. Its parent, the earlier locked KEEP `quadruped-r-b77621e855a4`, remains immutable but was not promoted after an independent reset seed exposed late pitch intervention. Separate locked diagnoses report zero violations for `traction-recovery` (`65.5714`, `+15.1246`), `command-tracking` (`76.0241`, `+4.7497`), `command-transitions` (`67.1619`, `-2.1661` within gates), and `spatial-generalization` (`56.6273`, `+5.0687`).

## Human and Agent surface

Humans can inspect signed motion, pitch, pitch rate, and foot forces in Runs and Studio, reproduce the ranked worst case with `mujica diagnose`, and read the explicit capability boundary above. Agents receive the same evidence through versioned JSON. `research/extreme-traction-gait.research.json` exposes only the severe hip scale and signed pitch boundary; `EXTREME_TRACTION_AUTORESEARCH.md` fixes the no-Scenario-leak and full-regression rules.
