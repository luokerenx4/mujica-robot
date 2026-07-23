# Sim-to-real Domain Profiles

## Purpose

A simulator becomes useful for hardware development only when model uncertainty is explicit. Mujica Domain Profiles make one bounded assumption about the robot plant and operating environment executable, hashable, and inspectable during Training.

They do not prove that simulation matches hardware. A Profile declares where its numbers came from:

- `synthetic` is an engineering envelope with no physical measurement claim.
- `hil` is derived from hardware-in-the-loop evidence.
- `real` is derived from a serialized physical device.

The provenance label, optional evidence path, and evidence-file content hash are
part of Profile identity. Editing captured evidence therefore invalidates cached
Training and produces a new Policy identity even when the Profile JSON is unchanged.

## Parameter contract

Each Profile may bound:

- body-mass scale;
- joint-damping scale;
- actuator-strength scale;
- contact-friction scale;
- added observation noise;
- integer actuator-delay jitter.

Continuous parameters use uniform numeric ranges. Delay uses an inclusive discrete
uniform range. A missing parameter is exactly neutral. Each training episode
samples a complete domain using a dedicated RNG derived from Training seed and
episode index.

The Runtime applies the sample to a fresh MuJoCo model before reset. Scenario
values remain the base condition: scales multiply Scenario/model values,
observation noise is additive, and delay jitter is added to Scenario delay. A
fixed payload is added after structural body-mass scaling, because it represents
carried load rather than robot manufacturing tolerance. This preserves the
distinction between an intentional task disturbance and plant uncertainty.
Body inertia is scaled with body mass; changing only mass would produce a
physically inconsistent rigid body.

## Evidence and authority

The Training request and Policy identity include the complete Profile, evidence
hash, and combined identity hash. `training-metrics.json` records every episode's
sample, consumed step count, completion state, and coverage summary. This makes an
apparently successful Policy auditable for missing range coverage or an unused
final sample.

Evaluation never receives a Domain Profile. A locked Benchmark selects exact Scenario parameters and seeds, so a frozen Policy cannot obtain a favorable random draw or continue adapting. Held-out Scenario combinations should sit near or just beyond the Training envelope and remain hidden from the Trainer.

## Calibration boundary

The first checked-in quadruped Profile is a hand-authored `synthetic` pre-HIL
envelope. Mujica now also accepts content-hashed Run v3 or external capture
series through an explicit Calibration definition. Its deterministic one-step
estimator fits bounded plant parameters, reports a whole-source validation loss,
and proposes a Profile bound to an immutable Calibration Run. Promotion is
separate and fails closed when evidence, Runtime, model, or validation authority
changes. A synthetic Calibration still remains synthetic; changing only the
provenance string is never calibration.

This boundary is deliberate:

```text
measured hardware evidence
→ system identification
→ versioned Domain Profile
→ domain-randomized Training
→ frozen Policy
→ fixed held-out simulation
→ HIL / real verification
```

Domain randomization reduces sensitivity to plausible model error. It cannot substitute for HIL, emergency-stop validation, timing verification, or real-device evidence.
