# Sim-to-real domain profiles

- Status: `complete`
- Updated: `2026-07-23`
- Related design: [Sim-to-real domain profiles](../docs/design/sim-to-real-domain-profiles.md), [Hardware verification boundary](../docs/design/hardware-verification-boundary.md), [ML motion-quality research](../docs/design/ml-motion-quality-research.md)

## Outcome

Mujica can train a frozen Policy across an explicit, provenance-bound envelope of robot and environment dynamics, preserve every sampled domain in immutable Training evidence, and judge that Policy on fixed held-out plant combinations without leaking evaluation parameters into training.

## Context

Current Training rotates through fixed Scenario files. That tests a few known disturbances but cannot express manufacturing tolerance, actuator-strength error, damping mismatch, sensor noise, or latency jitter as a coherent sim-to-real assumption. The Hardware boundary verifies protocol shape and timing but deliberately provides no dynamics calibration yet.

## Scope

### In scope

- Add file-native Domain Profiles with explicit `synthetic`, `hil`, or `real` provenance.
- Cover body-mass, joint-damping, actuator-strength, friction, sensor-noise, and actuator-delay uncertainty.
- Sample one complete domain per training episode from a separate deterministic RNG.
- Record the profile hash, exact episode samples, and aggregate sample coverage in immutable Training and Policy evidence.
- Keep evaluation deterministic: Benchmarks use fixed Scenario values and never sample a Training Domain Profile.
- Train and freeze at least one domain-randomized quadruped Policy, then evaluate it on a locked held-out plant Benchmark.

### Out of scope

- Claiming synthetic ranges are measured hardware calibration.
- Online system identification or policy updates during evaluation.
- GPU-scale parallel simulation.
- Automatically widening gates to accommodate a learned Policy.

## Acceptance

- [x] Omitting a Domain Profile preserves existing Training and evaluation behavior.
- [x] `mujica domain list|inspect` exposes profile provenance, ranges, and identity to humans and Agents.
- [x] MuJoCo training applies deterministic body-mass, damping, actuator-strength, friction, noise, and delay samples per episode.
- [x] Training artifacts contain the exact Domain Profile hash and exact sampled domains.
- [x] Policy identity changes when the Domain Profile changes.
- [x] Held-out evaluation uses fixed Scenario parameters and contains no random sampler.
- [x] At least one real PPO Training Run and frozen Policy are evaluated under the held-out Benchmark.
- [x] Validation, full tests, Benchmark locks, and protocol-only hardware evidence pass.
- [x] Design, evidence, commits, and remote push are complete.

## Work

- [x] Audit the present Training/Scenario/Hardware boundary and identify the missing physical-uncertainty contract.
- [x] Implement Domain Profile schema, loading, validation, CLI discovery, Runtime sampling, and evidence.
- [x] Add a synthetic pre-HIL profile plus fixed held-out plant Scenarios and Benchmark.
- [x] Train, evaluate, diagnose, and preserve the most informative evidence.
- [x] Verify, document, commit, and push.

## Findings and decisions

- 2026-07-23 — Domain randomization is a Training input, never an evaluation behavior. Locked Benchmark cases remain exact Scenario/seed pairs.
- 2026-07-23 — The first profile is explicitly `synthetic`; it establishes the executable contract but is not evidence of real-robot dynamics fidelity.
- 2026-07-23 — Domain sampling uses a dedicated RNG so changing an uncertainty range cannot silently change reset/noise draws through shared RNG consumption.
- 2026-07-23 — Profile identity includes referenced evidence bytes, not only a provenance label and path. Editing a HIL/real capture invalidates cached Training.
- 2026-07-23 — The 4096-step Policy improved held-out aggregate score `41.8841 → 48.3719` and light/strong travel `-0.437 m → +0.813 m`, but heavy/weak and slippery/weak remain failures.
- 2026-07-23 — Doubling samples scored `40.2972`; doubling residual authority scored `40.2618`. Both lost the light/strong forward capability and were automatically REVERT. More data and more learned authority are not accepted substitutes for held-out robot behavior.

## Progress log

- Domain Profile: `quadruped-pre-hil-v1`, identity `ea135355bafdd903…`, provenance `synthetic`.
- Canonical Training Run: `training-7edd8de36097b270`; Policy: `sim-to-real-residual-locomotion-b4b867ba57f0fe64`.
- Training evidence: 4096/4096 steps attributed to 21 samples, 20 completed episodes, zero unused samples.
- Agent experiment sessions: `session-f3505e54336acbe6` and `session-9757a0b166ab51e7`; both immutable REVERT evidence.
- Held-out Benchmark: `sim-to-real-audit`; final aggregate `48.371851991986944`.
- Hardware boundary: bundle `hardware-3351a78e34327f23`, verification `verification-8e31288a079172ed`, `PROTOCOL-VERIFIED`, `hardwareVerified=false`.
