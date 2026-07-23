# Human-guided Research Briefs

## Purpose

A Research Brief is Mujica's explicit handoff from human visual judgement to an
Agent-operated Research Lab. It lets “this foot strike looks wrong” influence
what the Agent investigates without letting prose, confidence, or triage
severity change robot source or decide promotion.

The Brief is a derived artifact. Its Human Observations remain hypotheses, their
Run/Capture contexts remain immutable evidence, and the locked Judge remains the
only KEEP/REVERT authority.

## Lifecycle

1. A human records one or more source-bound observations through Studio and
   `observation record`.
2. The human or Agent explicitly chooses a Research Lab and observation ids.
3. `research brief` verifies every observation and freezes the full evidence
   contexts together with the Lab definition, program hash, and primary
   Benchmark lock hash.
4. `research run --brief` verifies the Brief again and rejects it if the Lab,
   program, or lock changed.
5. The isolated Researcher receives the complete Brief in its version-3 JSON
   request. The Session stores `brief.json`; Session and Experiment manifests
   retain the Brief id and hash.
6. The existing editable closure, budget, regression Benchmarks, evaluation,
   and promotion transaction run unchanged.
7. After a KEEP/REVERT verdict, Mujica captures a deterministic accepted versus
   candidate Research Review. Studio can turn that visual witness into a new
   Observation, beginning another explicitly governed loop without rewriting
   the completed verdict.

Brief creation is deterministic. Observation ids are unique, sorted, and
limited to 16. The same Lab and observation set produces the same Brief id.
Editing the Brief, its manifest, an Observation, or an Observation context makes
inspection fail.

## Authority model

The Brief carries a closed boundary:

| Field | Meaning |
| --- | --- |
| `humanInput=hypothesis-only` | Human language prioritizes investigation only. |
| `sourceContext=immutable-evidence` | The cited Run/Capture bytes are independently verified. |
| `sourceEdits=lab-closure-only` | The Agent still owns only the Lab's declared files. |
| `promotion=locked-judge-only` | Human severity/confidence cannot force KEEP. |

Mujica does not infer a Lab, reward term, editable source, or intervention from
observation prose. Studio requires an explicit Lab selection and copies a
headless `research brief` argv. It remains offline and read-only; only the CLI
publishes the artifact.

## Artifact shape

```text
human-observations/
  observation-<hash>/
    draft.json
    context.json
    manifest.json

research-briefs/
  brief-<hash>/
    brief.json
    manifest.json

research-runs/<lab>/sessions/<session>/
  brief.json
  manifest.json
  results.tsv
  experiments/...
```

`brief.json` contains the verified observation assessment and complete
Run/Capture context needed by a sandboxed Researcher. It does not depend on
browser state or on the observation artifact being copied into the disposable
workspace.

See [Human-reviewed Research Outcomes](human-reviewed-research-outcomes.md) for
the post-Judge visual return path.
