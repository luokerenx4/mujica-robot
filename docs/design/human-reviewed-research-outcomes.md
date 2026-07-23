# Human-reviewed Research Outcomes

## Purpose

A Research Review closes the return path from a governed experiment to a human.
It preserves an exact accepted/candidate MuJoCo Run pair after the Judge has
decided KEEP or REVERT, including when the candidate source is about to disappear
with its isolated workspace.

The Review is a visual witness, not a second Judge. Human interpretation may
create the next hypothesis or Research Brief, but it cannot rewrite a stored
verdict, promote source, or claim that one displayed case proves the full
Benchmark suite.

## Lifecycle

1. The isolated Researcher proposes and executes a source change.
2. The locked primary and regression Benchmarks produce the complete evaluation.
3. The Judge fixes KEEP or REVERT before any visual Review is captured.
4. Mujica deterministically selects one primary-Benchmark witness case:
   the first gate-regression case named by the Judge, otherwise the largest
   absolute weighted case-score delta, otherwise the first primary case.
5. While both source states still execute, Mujica publishes immutable accepted
   and candidate Simulation Runs for that exact case.
6. `review.json` binds both Run byte identities to the Lab, program, Benchmark
   lock, optional Brief and Observations, Session, Experiment, proposal, and
   locked Judge decision.
7. `research review inspect` independently verifies the complete lineage and
   both Run directories. Its Studio handoff opens the exact pair.

A Review capture failure is recorded as `UNAVAILABLE` on the Experiment and in
the Session failure count. It cannot change the already locked Judge decision.
CRASH experiments use `NOT_APPLICABLE`.

## Authority boundary

| Surface | Authority |
| --- | --- |
| Human visual interpretation | `hypothesis-only` |
| Accepted/candidate trajectories | `immutable-runs` |
| KEEP/REVERT decision | `locked-judge` |
| Source or Revision promotion | `verdict-governed` |

`authority=derived-human-review` and `claimKind=visual-witness` make that
boundary machine-readable. The Review carries the full Judge result even when
the selected witness improved locally, because a different gate or the complete
suite may still require REVERT.

## Artifact shape

```text
research-runs/<lab>/sessions/<session>/
  manifest.json
  experiments/<experiment>/
    evaluation.json
    verdict.json
    review.json
    manifest.json

runs/
  run-<accepted-hash>/
  run-<candidate-hash>/
```

The Experiment manifest stores Review availability, hash, case id, and both Run
ids. The Session counts available and failed Reviews. The Run artifact hash,
manifest, metrics, score, `runKey`, and `resultHash` are all rechecked during
inspection; matching an id alone is insufficient.

## Human and Agent projections

The Agent/headless entry point is:

```text
mujica research review inspect <project> \
  --lab <lab> --session <session> --experiment <experiment>
```

The human projection uses the same verified record:

```text
mujica studio <project> \
  --research-lab <lab> --session <session> --experiment <experiment>
```

Studio synchronizes both MuJoCo replays on one clock and exposes proposal,
Brief/Observation lineage, verdict, gates, witness-selection reason, and a
copyable headless handoff. A new observation drafted from this view binds the
currently displayed Run frame, not browser-only interpretation.

## Checked-in example

The `transition-controller-review` Lab contains a real source-level experiment.
The candidate reduced lateral lean and improved aggregate score from
`68.1943` to `68.8866`, but caused `yaw-redirection` to regress from passing to
failing. The Judge therefore returned REVERT. Review
`f901aff3ebc04c9d…` preserves accepted Run `run-6f9c6481f208e927` and candidate
Run `run-b05629b197f18ee9` for that exact gate witness without retaining or
promoting the rejected source.
