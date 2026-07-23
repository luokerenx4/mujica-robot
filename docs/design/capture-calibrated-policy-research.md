# Capture-calibrated Policy research

## Closed evidence loop

This lane starts from a promoted Domain Profile whose evidence is an immutable
Hardware Capture and Calibration Run. The Profile is a Training input, not a
release claim. PPO samples its bounded mass, damping, actuator-strength, and
delay ranges while exact low-friction and lateral-push Scenarios supply the
failure modes observed by the locked Judge.

The authority chain is:

```text
Hardware Capture → Calibration Run → Domain Profile
        → Training Run → frozen Policy → locked robot Benchmarks
```

No arrow upgrades provenance. The current capture is MuJoCo-backed `dry-run`
evidence, so every derived Policy remains synthetic.

## Agent authority

The Research Lab gives the Agent one dedicated Trainer package, one Training
definition, and one Policy Controller pointer. It may change network/training
source, bounded optimization settings, residual authority, and the declared
Training scenario mix. It cannot edit:

- Capture, Calibration, or Domain Profile evidence;
- Assembly, Components, program Controller prior, Task, or evaluation seed;
- Runtime physics/reward;
- Objective, Benchmark, lock, capability gates, or regression suites.

Every proposal runs in an isolated project copy. Mujica imports the immutable
Training Run and Policy before judgement, but copies mutable source back only
for KEEP.

The isolated project must include the Profile's Calibration Run and Hardware
Capture dependencies. They are generated evidence, but not disposable caches:
Training revalidates their bytes and provenance. The workspace guard hashes
them, rejects any Researcher mutation, and excludes them from the editable
closure.

## Selection

`spatial-robustness` is primary because it contains the two measured failures:
low-friction forward progress and strong-push survival. Capability gates are
compared before aggregate score. A candidate that removes a violation may KEEP
despite a small score decrease; when the violation tier is unchanged it must
improve by the Lab threshold.

`spatial-generalization` and `motion-quality` are locked regressions. A primary
gain cannot buy a new fall, lost progress, excessive drift, or motion-quality
gate failure there. Training reward is useful diagnostics but never selection
authority.

## Initial hypotheses

1. Hard-case exposure: train across nominal, reset, low-friction, and
   strong-push episodes while reducing residual authority and exploration.
2. Safety-neighborhood recovery: if hard-case learning regresses, shrink toward
   the frozen program prior with stronger residual regularization.
3. Bounded expansion: only after a KEEP, spend more transitions and cautiously
   expand residual authority to attack the remaining failure.

The reference Researcher makes these choices deterministically from the compact
Experiment history. A different Coding Agent may propose different source
changes through the same authority boundary.

Training Run reuse compares the immutable manifest plus stable result identity
(`trainingRunId`, Policy ID, model hash, and Training metrics). Volatile absolute
workspace paths and wall-clock duration are deliberately not identity. The
frozen Policy directory must still match byte-for-byte. This lets a repeated
deterministic proposal reuse prior evidence without accepting a different model.

## Experimental result

The Lab executed five real PPO Policies:

| Hypothesis | Primary score | Violations | Result |
| --- | ---: | ---: | --- |
| hard-case residual `0.10` | `61.3694` | `5` | REVERT |
| prior recovery `0.05` | `60.9217` | `3` | REVERT |
| quality-guarded residual `0.02` | `60.3422` | `2` | REVERT |
| recovery distillation `0.01` | `60.1860` | `2` | REVERT |
| program-neighborhood residual `0.002` | `60.4366` | `2` | REVERT |

The original head has score `60.6407` and three primary violations. The three
micro-residuals therefore reached a better primary feasibility tier and
recovered strong-push survival. None was promotable: each caused at least one
new passing-to-failing gate in delay generalization or delayed motion quality,
most often forward progress, actuator saturation, or foot impact. The Judge
correctly rejected an appealing primary-only improvement.

The measured frontier points to observation/controller co-design rather than a
larger parameter sweep. The 3-DOF Assembly has no bounded command/applied Action
history, while the regression suite spans 20–60 ms delay plus disturbances.
The next learned lane should use the history Assembly and a delay-aware frozen
program prior, then prove that the added observation contract—not weaker gates—
resolves the conflict.
