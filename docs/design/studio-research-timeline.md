# Studio Research Timeline

## Why it exists

Robot research is not naturally navigated as a directory of Run IDs. The
useful unit for a person is an iteration: what was tried, whether it was kept,
what improved or regressed, and what the robot looked like. The useful unit for
a Coding Agent is the same iteration plus immutable identities that make every
claim reproducible.

Studio therefore treats a Research Lab as a training history and a Research
Review as the visual-witness boundary.

## Data model

A Research Timeline snapshot contains:

- the selected Lab and optional Session/Experiment scope;
- the existing immutable Session and Experiment ledger;
- one verified entry for every available Review in that scope;
- the accepted and candidate Run projections for each entry;
- one verified MuJoCo replay for each distinct Run.

The snapshot refers to copied replay frames by Run ID, but the visible
interaction is organized by Session and iteration sequence. Multiple
iterations may reuse the same accepted Run; its replay is rendered and copied
only once.

## Selection behavior

The default selection is the explicitly requested Experiment, otherwise the
newest reviewed iteration in scope. Studio stores a user selection in the URL
fragment. Reloading the static snapshot reconstructs both replay sides from
embedded verified data; it does not call a server or evaluate code.

Iterations without a Review remain useful for score and gate history, but are
marked `metrics only`. Studio does not guess which benchmark Run would have
been the correct visual witness for legacy experiments.

## Human and Agent parity

The human sees:

- progress and verdict counts;
- score and gate movement;
- hypothesis and gate reasons;
- accepted/candidate synchronized replay.

The Agent receives:

- Lab, Session, and Experiment lineage;
- Review and Judge hashes;
- accepted/candidate Run and result hashes;
- exact replay frame and shared simulation time;
- headless `mujica studio` and `mujica evidence inspect` selectors.

The UI may change presentation and filtering, but it cannot change the locked
Judge verdict or promote a candidate.
