# Integrated resilience articulated-waist co-design

Treat the waist as a bounded complete-robot hypothesis, not as a guaranteed fix for recovery.

The primary authority is the locked `integrated-resilience-mission` Benchmark. Every Case is one no-reset Episode through approach, impact, recovery, resumed locomotion, redirection, lateral traversal, and stop. Do not replace it with separate recovery or locomotion tasks.

The rigid `resilient-command-conditioned-history-3dof/behavior-supervisor` subject is the baseline. The proposed plant adds two orthogonal waist joints and actuators. A four-step raw history at fourteen actions would raise the Observation width from 145 to 165 and violate the Charter. The first articulated candidate therefore removes raw commanded/applied history and retains only the measured actuator-delay scalar, yielding a 53-coordinate Observation ABI. This observability trade is part of the design and must remain visible.

Each proposal must state which coupled mechanism it changes:

- waist roll/pitch range, leverage, damping, or mass distribution;
- dynamic fall classification and leg/waist recovery sequencing;
- waist stabilization during locomotion and the recovery handoff;
- non-neighbor self-contact geometry; or
- actuator-history removal and delay observability.

Judge lexicographically by enforced gate violations, normalized violation severity, and score. Then run the locked self-righting, recovery-handoff, and command-tracking regressions. A score gain cannot pay for a failed stable recovery, unsafe self-contact, action/observation envelope violation, or lost command capability.

Promote only if the articulated robot improves the complete Mission enough to justify `+2` actuators, extra mechanism mass, a wider hardware ABI, more collision geometry, and lower history depth. Otherwise keep the rigid torso and preserve the articulated result as negative design evidence.

## Current contact-geometry hypothesis

The accepted waist controller and three articulated residual Policies all
entered retry near `bodyTiltRad = π` with every foot `0.3–0.5 m` above the
floor. Doubling training and assigning `2 Nm` to each waist action never
created one-foot support; the centered waist moved only about `0.08 rad`.

The next bounded design change is therefore a light, segmented dorsal rollover
keel. Two longitudinal capsules, one on each torso half, add `0.12 kg` and
replace the broad upside-down torso rest with a narrow, mechanically unstable
support line. The Controller, waist range, Task, Scenarios, Objective, and
Judge remain unchanged. The hypothesis is falsified if the complete Mission
does not leave the inverted basin, never creates a foot-contact opportunity,
or loses previously passing command/collision gates.

The first implementation was reverted. It did produce the intended structural
signal: final Mission tilt moved from roughly `3.08–3.14 rad` to
`1.97–2.83 rad`, while final torso height rose from `0.06–0.08 m` to
`0.12–0.15 m`. However, the two capsules overlapped by `4–6 mm` at the waist,
injecting forces during ordinary locomotion and increasing primary violations
from `41 → 46`. The next experiment retains the same outer profile but leaves
a `90 mm` surface gap around the waist and reduces added mass to `0.06 kg`.

That clearance-corrected version removed the broad locomotion regression:
primary violations stayed `41 → 41`, normalized severity improved
`177.781 → 168.220`, aggregate score improved by `2.175`, and the whole
command-tracking regression suite preserved its gates. It was still reverted
because the `0.13 m` outer profile regressed one exact yaw gate, one degraded
collision gate, and front/back atomic recovery boundaries. The next bounded
point lowers the outer profile to `0.10 m` and total added mass to `0.04 kg`
without changing its waist clearance or longitudinal footprint.

That low-profile point was also reverted and was substantially worse:
violations rose `41 → 46` and score fell by `3.065`. Contact topology is
therefore not monotonic in keel height. The better `0.13 m` clearance geometry
is restored for the next complete-robot hypothesis. Its atomic front failure
was a `knee-fl` overshoot to `0.102 rad` against a `0.1 rad` joint limit, and
its back handoff failure reached `hip-fr = -1.217 rad` against a `-1.2 rad`
limit. The next point raises only static sagittal recovery damping
`2.4 → 3.0` and reduces retry-only waist magnitude `0.18 → 0.14 rad`; all
locomotion gains and authored test inputs remain fixed.

That geometry-conditioned control point was also reverted. It improved the
primary aggregate by `2.926` and reduced normalized severity
`177.781 → 169.951`, but primary violations rose `41 → 44`: exact Missions
lost progress/collision gates, the left-degraded Mission retained yaw and
collision regressions, and the same front/back atomic joint boundaries
remained unsafe. The three keel profiles plus the coupled damping point now
form a completed, non-monotonic negative family. Do not repeat any of their
strategy identifiers. Return the Lab exhaustion signal when cross-session
history contains
`rollover-keel-with-geometry-conditioned-recovery-damping`.

The best structural signal remains the clearance-corrected `0.13 m` keel:
it left the fully inverted basin and improved height, severity, and score
without increasing the primary violation count, but did not create foot
support and did regress safety gates. A future design family should change
the lateral support/contact pair or leg reach geometry, not scan another keel
height, mass, damping, or retry magnitude in this bounded program.
