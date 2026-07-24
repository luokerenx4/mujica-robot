# Human–AI debugging workspace

Mujica has two users at the same time:

- a human notices motion, timing, sound, contact, and “that looks wrong” patterns
  that are expensive to encode before the problem is understood;
- a Coding Agent needs exact identities, typed values, bounded context, and a
  command it can replay without guessing what the human saw.

They share evidence, not UI state.

## One context, two projections

For Simulation Runs, `mujica evidence inspect --run ... --time ...` resolves the
trajectory row at or before the requested shared simulation time. It returns the
Run/result identities, row index and step, nearby Events, complete row, metrics,
score, hashes of every consumed artifact file, optional comparison Run, quality
deltas, and a `contextHash`.

For Hardware Captures, `mujica evidence inspect --capture ... --event ...`
first verifies Capture identity and transcript bytes. It then returns the exact
protocol event, a bounded two-event window on each side, Capture status/reasons,
transcript hashes, and a `contextHash`.

A completed governed episode also supports
`mujica evidence inspect --capture ... --episode ... --time ...`. It verifies
the episode bytes and returns the device row at or before the requested time,
two neighboring rows on each side, `qpos/qvel`, device health,
proposed/commanded/applied Action, and source hashes. Studio can project that
same `qpos` through the Capture's exact frozen Bundle model. This is
device-kinematic evidence rendered with digital-twin geometry, not camera,
motion-capture, contact, Calibration, or hardware-verification evidence.

Studio uses those same selectors. A copied frame contains an executable
`headlessArgv`; a human-observation draft contains only the exact source ids,
hashes, time or event index, and the typed assessment. Recording the draft makes
the CLI reconstruct the context independently. Browser memory is never trusted
as evidence.

## Authority boundary

Three claims must remain visibly different:

| Claim | Authority | May decide KEEP / safety? |
| --- | --- | --- |
| Run/Capture measurement | `immutable-evidence` or `immutable-device-telemetry` | Only through its fixed Judge or safety contract |
| Human visual observation | `human`, `hypothesis` | No |
| Agent diagnosis/intervention | `hypothesis` | No |

A human observation therefore cannot say that a gate passed. It may say that a
foot appears to slap, that lateral wobble begins near a frame, or that a stop
looks delayed. Severity expresses triage priority, not proof. Confidence
expresses the observer's confidence, not statistical certainty.

## Observation lifecycle

Studio is deliberately offline and read-only:

1. The human seeks a Run frame, a completed Capture episode frame, or clicks a
   Capture protocol event in the attention queue.
2. Studio composes a `mujica-human-observation-draft` in browser memory.
3. The human copies or downloads the JSON.
4. `mujica observation record --input ... --observer ...` validates the closed
   schema, independently reconstructs the immutable context, checks source
   hashes, and publishes `human-observations/observation-<hash>/`.
5. `observation list|inspect` exposes it to an Agent. A new Studio snapshot
   projects the same verified artifact.
6. When the human explicitly chooses a Research Lab, `research brief` can bind
   the Observation and its full context into a governed research handoff. The
   Brief remains hypothesis-only and cannot widen the Lab or Judge.
7. A completed KEEP/REVERT experiment preserves an accepted/candidate Research
   Review. Human inspection may record the next Observation, but the Review
   cannot alter the locked verdict.

The artifact freezes `draft.json`, full `context.json`, and `manifest.json`.
Its identity includes observer, timestamp, source, assessment, draft hash, and
context hash. Editing any byte makes inspection and Studio projection fail.
See [Human-guided Research Briefs](human-guided-research-briefs.md) for the
optional Observation-to-Research lifecycle.
See [Human-reviewed Research Outcomes](human-reviewed-research-outcomes.md) for
the verified Research-to-Observation return path.

## Attention queue

Studio orders measured blocking failures before investigations and informational
human hypotheses. Selected Run falls/failed Events are seekable. Aborted or
safety-intervened Hardware Captures expose an exact transcript event, including
Driver-originated lease expiry. Clicking a Capture changes only the observation
draft source. A completed episode is renderable only when it recorded verified
`qpos` and remains bound to its exact frozen Bundle; transcript-only state is
never promoted into an invented pose.

## Frozen Policy evidence

Training reward is diagnostic evidence, not promotion evidence. Studio projects
each frozen Policy together with the Training Run, seed, step budget, completed
episodes, exact Domain Profile coverage, and actual actor-authority exposure.
For a residual Policy, actor authority is the fraction of experience in which
the learned residual could affect the applied Action; whole-episode critic
experience must not be mistaken for whole-episode control authority.

The projection verifies the Policy directory id, model hash, Action and
Observation contract hashes, completed Training Run, and Training result before
showing it. Historical source-hash formats remain visible as
`LEGACY-SOURCE-HASH`; a broken model, contract, or Training lineage fails
closed. Exact-plant training is named explicitly rather than implied to provide
domain robustness.

A frozen Policy is `UNREVIEWED` until a Candidate binds it to a locked Judge,
`CANDIDATE` while that comparison exists without promotion, and `PROMOTED` only
when an immutable Policy Revision selects it. The copied
`mujica-policy-training-context` carries the exact retraining and Candidate
commands and preserves three distinct authorities:

- training reward is diagnostic-only;
- the locked Candidate Judge alone may decide promotion;
- visual inspection may produce a hypothesis, never a KEEP claim.

## Snapshot identity

The Studio snapshot includes the offline renderer source hash. A UI-code change
therefore produces a new content address even when selected evidence is
unchanged. An unchanged project, renderer, selection, and observation set reuse
the same snapshot.
