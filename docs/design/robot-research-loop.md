# Robot research loop

Status: V1 implemented.

Related: [robot development harness](robot-development-harness.md), [CLI](../CLI.md), and [project format](../PROJECT_FORMAT.md).

## Purpose

Mujica Research turns a locked robot Benchmark into a repeatable experiment loop for a Coding Agent. The first implementation tunes a program controller's declared numeric configuration; the same governance can later wrap Trainer configuration, Policy replacement, Component configuration, and coordinated Development Candidates.

The loop is inspired by Karpathy's small autoresearch protocol: humans program the research organization in Markdown, the Agent gets one explicit editable surface, evaluation stays fixed, every experiment has a bounded budget, and a compact ledger prevents repeated dead ends. Mujica does not use git reset as the evidence model. It keeps immutable project-local Experiment artifacts and advances a Robot Revision only after Core independently verifies KEEP.

## Authored contract

`research/<id>.research.json` declares:

- the locked Benchmark, Assembly, and program Controller;
- a project-local Markdown program for human research intent;
- exactly one editable JSON file;
- numeric JSON-pointer parameters with minimum, maximum, step, and preferred direction order;
- a minimum aggregate-score improvement;
- the maximum experiment count per invocation.

The V1 editable file must be the selected Controller's `controller.json`. Every parameter path must start with `/config/`, already exist, and contain a finite number. Proposals may change only listed paths and must stay inside bounds. Dependencies, entry program, Assembly, Component catalog, tasks, scenarios, objectives, and Benchmark locks remain fixed.

## Proposal boundary

Without `--agent-command`, Core uses deterministic coordinate proposals. It tries one bounded step in the human-declared direction order and skips candidate hashes already present in the experiment ledger.

An external Agent command receives one JSON value on stdin containing the Markdown program, current controller config/hash, locked Benchmark summary, current best evaluation, editable parameter contract, and prior compact experiment history. It must return exactly:

```json
{
  "strategy": "support-geometry-knee",
  "hypothesis": "A slightly straighter knee raises the body and improves push recovery.",
  "expectedEffect": "Increase upright score without violating energy or survival gates.",
  "values": { "/config/neutralKnee": -0.53 }
}
```

The command has no write authority. Core validates and applies its proposal only in memory for evaluation.

## Experiment transaction

Each attempt follows one transaction:

```text
read lineage head + controller hash + Benchmark lock
  -> propose bounded values
  -> evaluate temporary controller definition on every fixed case
  -> reject any passing-to-failing capability regression
  -> compare lexicographically: fewer gate violations first,
     then lower normalized violation severity, then aggregate score
  -> decide KEEP / REVERT / CRASH
  -> on KEEP only: recheck controller hash, atomically write controller.json,
     then publish a child Robot Revision with source and evaluation snapshots
  -> publish the immutable Experiment and append the compact results.tsv row
```

The Benchmark baseline remains immutable. "Current best" means the selected research Controller before an attempt, not the Benchmark baseline Controller. A REVERT or CRASH never changes project source or Revision lineage.

Once a gate passes, later candidates must continue to pass it. When several gates remain infeasible, a candidate may trade movement among those still-failing metrics only when it improves the lexicographic feasibility state: first violation count, then summed normalized severity. This avoids deadlock on coupled robot behavior while forbidding regression of already solved capabilities. Score-regression is itself an ordinary locked gate measured against the immutable Benchmark baseline.

Selection is lexicographic. Reducing enforced violations outranks lowering their normalized severity, which outranks aggregate score. The authored minimum aggregate improvement is required only when violation count and severity are equal. This prevents a high-scoring infeasible robot from blocking actual capability progress; the decision and before/after counts and severities are stored in new Experiment and Revision evidence.

## Memory and identity

Experiments live under `research-runs/<research-id>/<sequence>-<experiment-hash>/`. The hash covers the Research definition, program hash, Benchmark lock, before-controller hash, proposal, candidate-controller hash, and fixed-case result hashes or crash identity. `manifest.json` is written last. Seen-candidate memory is scoped to the same Research, program, and Benchmark lock, so evaluator changes reopen configurations that need new evidence.

`research-runs/<research-id>/results.tsv` is a bounded human/Agent orientation index with sequence, experiment id, score, delta, verdict, strategy, and description. Immutable Experiment directories remain authoritative.

## Safety and claims

Research is autonomous only inside its declared file and parameter envelope. It cannot install packages, change Runtime code, weaken a gate, relock a Benchmark, or apply an Assembly/Component change. A future source-editing mode must add syntax/test sandboxes and an equally explicit write set; it may not silently broaden V1.

Benchmark locks include Runtime source, production Core/CLI evaluator source, and Python/Bun dependency locks. A version label alone is not accepted as evaluator identity.
