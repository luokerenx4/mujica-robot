# Project inception research

## Decision

Mujica treats prior-art research as Stage 0 of robot development. The Harness
does not begin a real robot at “optimize this assembly.” It first asks what
should be built, which existing designs have already paid down that uncertainty,
and what may legally and technically be reused.

This is a small operational gate, not a literature-review ceremony. Its output
is a checked-in source ledger, a short recommendation, and one architecture
route that the next design Plan can test.

## Entry and exit

Run a Prior Art Study before a new robot's first capability Plan or substantial
embodiment iteration. Start with the mission, operating environment, required
capabilities, hardware constraints, and the design question that outside work
could answer.

The study is complete when it has:

1. compared at least four materially different primary references;
2. inspected at least two promising repositories through temporary shallow
   clones and recorded their exact commits;
3. separated evidence for hardware, CAD, electronics, software, simulation
   models, documentation, and trained artifacts;
4. recorded license evidence and unresolved boundaries for each useful asset;
5. chosen `adapt`, `fork`, `combine`, or `original` with a falsifiable reason;
6. produced a bounded design brief and named the human visual-review point.

The next Plan begins from that decision. It does not silently turn every
reference into a dependency.

## Research protocol

Prefer primary sources in this order:

- the upstream repository and its license files;
- official build and model documentation;
- the architecture paper from its authors;
- manufacturer documentation for components and commercial robots.

Discovery pages, videos, and secondary summaries can suggest candidates but
cannot establish reuse rights or engineering facts. For each candidate, record:

- source URL, upstream commit, maintenance state, and inspected paths;
- the problem the design solves and the mission assumptions it embeds;
- degrees of freedom, actuation, sensing, packaging, and available physical
  evidence relevant to the project;
- which concrete assets exist rather than which assets the README promises;
- license and attribution evidence per asset layer;
- fit, customization surface, missing evidence, and rejection or selection
  reason.

Keep clones under a disposable directory outside the workspace. Do not commit
downloaded screenshots, papers, videos, generated renders, or repository
archives as research evidence. Stable links, commits, extracted engineering
facts, and our own text/JSON are the durable record.

## Reuse routes

### Adapt

Choose `adapt` when an upstream physical architecture fits the mission but
Mujica should own a new parameterized Assembly and MuJoCo representation. Copy
only selected licensed assets, preserve notices and provenance, and document
every intentional departure from the upstream geometry or hardware envelope.

### Fork

Choose `fork` when the selected upstream source itself should remain the working
tree and its history is useful. Preserve history, upstream remote, license,
notices, and attribution. A GitHub fork is an implementation action after this
decision, not a substitute for the study.

### Combine

Choose `combine` when mechanical, simulation, and control references come from
different sources. Keep their licenses and source identities separate. In
particular, a permissively licensed simulation model may calibrate a twin
without granting rights to manufacture or redistribute the corresponding
commercial robot.

### Original

Choose `original` only after recording why the credible candidates fail the
mission, licensing, availability, safety, or customization requirements.
Original design still uses prior work as engineering evidence; it simply
copies no protected source assets.

## License boundary

“Public on GitHub” is not a license. A root repository license may not cover
submodules, linked cloud CAD, model subdirectories, meshes, photographs,
weights, or vendor files. The source ledger therefore records `verified`,
`partial`, `reference-only`, or `unknown` for each asset layer. Unknown assets
are not copied.

Before vendoring, add an attribution record that names the upstream URL and
commit, copied paths, applicable license, local destination, modifications,
and required notices. If that record cannot be made confidently, use the work
as reference only.

## Human checkpoint

After research and before baseline selection, generate the candidate designs
locally and ask a human to inspect the overall form, plausible force paths,
packaging, ground contact, and obvious recovery limitations. The Agent supplies
dimensions and evidence; the human may reject a form using ordinary physical
judgment. That rejection becomes a design hypothesis for a cheap probe, not an
invitation to hide the problem with more Training.

## Demo-fixture exception

A tutorial or Harness smoke project may declare itself a `demo-fixture` and
skip the full comparison. The declaration states its narrow purpose and must
not make a real capability claim. Before it becomes a development baseline,
receives substantial optimization budget, or informs hardware, it must complete
Stage 0 retroactively.

The first Mujica quadruped crossed this boundary: it was useful Harness
scaffolding, but repeated self-righting work exposed that no architecture had
ever been selected. Its retroactive study is recorded in
`examples/quadruped/prior-art-study.json` and `examples/quadruped/PRIOR_ART.md`.
