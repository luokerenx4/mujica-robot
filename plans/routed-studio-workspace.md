# Routed Studio workspace

Status: completed
Updated: 2026-07-28

## Outcome

One generated Mujica Studio is a navigable project workspace rather than one
ever-growing page. A human can open project status, embodiment lineage, the Run
ledger, one exact Run replay, an A/B comparison, or the complete evidence
debugger through stable deep links.

## Context

The React Studio foundation made the replay usable, but project charter,
summary, playback, comparison, and the transitional evidence debugger still
share one page. Adding design studies, iteration history, Training diagnostics,
and future hardware evidence to that surface would make both navigation and
page ownership ambiguous.

## Scope

- Add project-level hash routes for overview, designs, Runs, Run detail,
  comparison, and complete evidence.
- Split the React data projection into route-owned static JSON documents.
- Package full trajectory and replay metadata only for Runs explicitly selected
  by the Studio command.
- Keep the complete legacy evidence debugger reachable without changing its
  evidence semantics.
- Do not add a mutable frontend store, server API, arbitrary historical Run
  loading, robot editing, Training, evaluation, or promotion authority.

## Development emphasis

- Mode: `balanced`.
- Evidence: this is a Harness presentation and artifact-structure slice; it
  changes no robot morphology, Controller, Policy, Benchmark, or Judge.
- Budget bias: establish deterministic deep-link and data boundaries before
  adding more visual panels.
- Exit condition: every declared route can be loaded directly from a generated
  Studio, reads only its route projection, and preserves exact replay identity.
- Switch-back condition: if route projections cannot preserve selected Run,
  replay, or renderer identity, stop UI decomposition and repair the generated
  artifact contract before adding another page.

## Acceptance

- `#/overview`, `#/designs`, `#/runs`, `#/runs/:runId`, `#/compare`, and
  `#/evidence` are first-class routes with shared project navigation.
- Refreshing or directly opening any hash route retains the selected page.
- Overview presents the development proposition, active capability stages,
  current emphasis, and evidence counts without mounting replay UI.
- Designs presents Assembly variants, the current Design Study candidates, and
  kept Robot Revision lineage without mixing it into Run playback.
- Runs presents the immutable Run ledger and clearly distinguishes Runs whose
  complete details/replays are packaged in this Studio.
- Run detail and comparison reuse the synchronized typed replay workbench and
  preserve exact Run/frame copy context.
- Generated `data/project.json`, `data/designs.json`, `data/runs.json`,
  `data/runs/<id>.json`, and `data/compare.json` are deterministic projections;
  the React shell embeds only their manifest, not the monolithic Snapshot.
- Type checks, targeted and full tests, and browser deep-link/playback checks
  pass.

## Work

1. Freeze a route manifest and deterministic page-projection contract.
2. Build the shared application shell and project navigation.
3. Implement overview, design lineage, Run ledger, Run detail, comparison, and
   evidence pages.
4. Publish route JSON atomically with the existing content-addressed artifact.
5. Verify deep links, navigation, playback, comparison, and legacy evidence.

## Findings and decisions

- Hash routing is deliberate: a generated Studio remains a portable static
  directory and does not require an HTTP history-fallback rule.
- Page routes own presentation, while immutable files remain the authority.
- The Run ledger may name every completed Run, but only CLI-selected Runs carry
  full trajectory and rendered replay data in one Studio artifact. This keeps
  the project index useful without silently packaging the entire evidence
  history.

## Progress log

- 2026-07-28: Started after the first React replay showed that project,
  embodiment, iteration, comparison, and debugger concerns no longer fit one
  coherent page.
- 2026-07-28: Added the hash-routed React shell, Overview, Designs, Runs, Run
  detail, Compare, and Evidence pages. The generated shell now embeds only a
  route manifest and loads deterministic project/design/ledger/Run/comparison
  JSON projections on demand.
- 2026-07-28: Browser verification caught a mixed development/production JSX
  runtime in the first bundle. Fixing the Vite JSX contract produced a clean
  renderer; direct route refresh, 300-frame single replay, synchronized A/B
  playback, and the complete Evidence iframe then passed.
- 2026-07-28: Final verification passed 96 TypeScript tests, 78 Python/MuJoCo
  tests, the 9 targeted Studio tests, and route-level browser smoke checks. The
  final artifact also carries route-script mirrors for direct `file://`
  opening. The generated deliverable is `studio-04d922338ab37a31`.
