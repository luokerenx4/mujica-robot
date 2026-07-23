# Upright locomotion

## Orientation evidence

Euler pitch is useful signed evidence for forward and backward sagittal failure, but it is not a complete torso-orientation measure near its singularity. Mujica therefore records both signed pitch and yaw-invariant body tilt for every simulation step.

For MuJoCo's normalized `wxyz` base quaternion `(w, x, y, z)`, body tilt is the angle between body-up and world-up:

```text
worldUpDotBodyUp = 1 - 2(x² + y²)
bodyTiltRad = acos(clamp(worldUpDotBodyUp, -1, 1))
```

Pure yaw has zero tilt. Roll, pitch, or a compound roll/pitch rotation increases tilt without depending on heading. Trajectories expose `bodyTiltRad`; Run metrics expose `meanBodyTiltRad` and `maximumBodyTiltRad`. Objectives may gate tilt independently from signed pitch, and diagnosis reports the same gate to humans and Agents.

## Controller regimes

`upright-traction-gait` preserves the existing deployable Observation and Action contracts. It cannot read Scenario identity, friction, reset seed, or future Task segments. Its selection rules use only current command, measured body motion, contact, orientation, and actuator delay.

For normal zero-delay forward motion, a four-beat crawl keeps the torso inside the upright envelope. During the first `0.4 s`, the Controller integrates commanded and measured forward progress. A measured/commanded progress ratio below `0.1` selects the proven traction bound with a fixed `-0.075 s` phase offset; otherwise the crawl continues. This classifier separates observed normal/reset/payload ratios from low-friction ratios without exposing evaluator inputs.

Three-step delayed motion needs a separate timing surface. Forward commands at or above `0.225 m/s` use a slower diagonal pace with `0.7×` frequency and fixed normalized drive. Lower-speed commands retain the previously locked traction bound. The boundary is deliberately constrained between the `0.20 m/s` transition domain and the `0.25 m/s` steady-forward domain in bounded Research. Once a command changes, transition behavior returns to the proven bound; action-by-action comparison confirms the delayed braking case remains identical to its passing parent.

This is a small set of measured operating regimes, not a Scenario table. Failed alternatives included contact-only surface classification, dynamic phase alignment, an inertial payload classifier, emergency neutral holds, and broad velocity-gain scans. They either overlapped valid reset states or destabilized delayed support.

## Locked evidence

The `upright-locomotion` Benchmark contains twelve hard cases spanning stand, nominal forward motion, two reset seeds, payload, lateral push, three-step delay, reverse, lateral, yaw, and two extreme-traction cases. It gates maximum absolute pitch at `0.6 rad`, body tilt at `0.65 rad`, and retains case-specific progress, drift, and tracking requirements.

The selected Controller has zero violations and aggregate score `76.4735`. Representative maximum absolute pitch/tilt pairs are `0.1095/0.1114` for nominal forward, `0.2330/0.2344` under payload, `0.2784/0.4100` with three-step delay, and `0.3730/0.3730` for the extreme-traction reset.

Separate locked diagnoses also retain zero violations: `extreme-traction` scores `58.7656` (`+11.1873`), `spatial-generalization` scores `53.2280` (`+1.6694`), `command-tracking` scores `74.7139` (`+3.4395`), and `command-transitions` scores `67.9957` (`-1.3323`, within all gates). Candidate `upright-locomotion` removes all twelve baseline upright violations and publishes child Robot Revision `quadruped-r-72516cc9a6dd` from `quadruped-r-1101a73a0752`.

## Human and Agent surface

Humans receive the same tilt values in Studio snapshots and CLI diagnosis that Agents receive in JSON. `research/upright-locomotion-gait.research.json` bounds the measurable classifier, crawl timing, and delayed speed-domain surface. `UPRIGHT_LOCOMOTION_AUTORESEARCH.md` fixes the no-Scenario-leak, no-standing-still, and full-regression rules.
