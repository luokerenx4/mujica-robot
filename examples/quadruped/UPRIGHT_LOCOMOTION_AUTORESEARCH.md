# Upright locomotion autoresearch

Improve `upright-traction-gait` against the locked `upright-locomotion` Benchmark while retaining the separately locked extreme-traction, command-tracking, command-transitions, and spatial-generalization capabilities.

Maximum absolute pitch and yaw-invariant body tilt are hard capabilities, not score preferences. Every hard case must also retain its authored progress, drift, and command-tracking gates; standing still is not an upright-locomotion solution. Scenario identity, friction, reset seed, and future command segments may never enter the Controller. Use only the declared command, orientation, body motion, joint, contact-force, and actuator-delay Observation channels.

The Controller has three deliberate deployable regimes. Normal zero-delay progress uses a four-beat crawl. An early measured-progress ratio selects the proven traction bound when the surface cannot support that crawl. Three-step delayed forward motion uses a slower diagonal pace only above the bounded command-speed threshold; lower-speed transition sequences retain the previously locked traction bound. The threshold must stay strictly above `0.20 m/s` and below `0.25 m/s`, so it expresses a command-speed domain rather than a Benchmark case label.

Change one declared value at a time. KEEP first requires zero enforced upright violations, then zero violations on all four locked regression Benchmarks. Aggregate score cannot compensate for a fall, excessive pitch or tilt, lost signed progress, or a newly unsettled command transition.
