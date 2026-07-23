# Studio Research Timeline

Status: complete

## Goal

Make Studio a shared training cockpit for a human and a Coding Agent. A human
must be able to understand research progress and select an iteration by its
meaningful training context. The Agent must receive the exact immutable
Session, Experiment, Run, Review, and frame selector behind the same view.

## Product contract

- Enter the cockpit with a Research Lab selector. Session and Experiment are
  optional refinements, not mandatory artifact trivia.
- Show every completed iteration in the selected Lab with sequence, verdict,
  score delta, gate movement, hypothesis, and visual-witness availability.
- Filter by Session and verdict. Sort chronologically, by newest iteration,
  score delta, or fewest candidate violations.
- A reviewed iteration opens its accepted and candidate Runs as a synchronized
  MuJoCo comparison without starting a new evaluation.
- A legacy iteration without an immutable Review remains visible as
  metrics-only and is never presented as replayable evidence.
- Copying context from any selected replay preserves the exact Research Review
  lineage and headless reproduction command.

## Authority

The Timeline is a read-only projection. It does not train, score, promote,
reject, or mutate project state. KEEP/REVERT remains the locked Judge verdict.
Visual interpretation remains a human hypothesis. Replay frames are copied
from verified immutable Run replays into a deterministic offline snapshot.

## Implementation checklist

- [x] CLI accepts `--research-lab` with optional `--session` and `--experiment`.
- [x] All available Reviews in the selected scope are integrity-verified.
- [x] Unique accepted/candidate Runs are rendered once and copied into the
      offline snapshot.
- [x] Studio shows progress KPIs, filters, sorting, selected iteration detail,
      and synchronized A/B replay switching.
- [x] Metrics-only legacy iterations are explicit and disabled for replay.
- [x] Snapshot and CLI tests cover timeline integrity and selection.
- [x] Browser validation confirms selection, playback, and Agent context.

## Delivered slice

- `mujica studio . --research-lab transition-controller-review` builds
  `studio-7c3dcba637a8d0ec`.
- The selected Review compares 325 accepted frames with 325 candidate frames
  over one synchronized 6.5-second simulation clock.
- Browser checks covered progress rendering, KEEP filtering, and playback from
  frame 1 through frame 37.
- The CLI source change refreshed all 13 Benchmark locks and published current
  Bundle/verification pairs `hardware-6059e16c3caf1e67` /
  `verification-41ad520caee2945c` and `hardware-2883d6f82926d3fc` /
  `verification-c22f4a202ce0c639`.
- The complete TypeScript/Python suite and all nine Runtime model validations
  pass.
