# Research Lab V2

## Purpose

Research Lab V2 is Mujica's canonical autonomous experiment protocol. It generalizes the V1 Controller Research and Training Research loops from bounded numeric coordinate search to bounded source research while preserving the stronger robot-development guarantees already present in Mujica.

The architecture has three authorities:

1. The human-authored `program.md` defines research intent, simplicity preferences, and operating instructions.
2. The Researcher may change only an explicit project-relative source closure in an isolated project workspace.
3. The Judge is fixed by Benchmark locks and Mujica Runtime/Harness identity. It alone decides KEEP, REVERT, or CRASH.

This is the transferable structure of `autoresearch`. Mujica does not copy its single mutable file, destructive Git reset loop, untracked-only memory, or single unconstrained scalar because complete robot development has compiled hardware, Controller contracts, frozen Policies, hard capability gates, and Revision lineage.

## Canonical project shape

```text
research/
  <lab-id>/
    research.json
    program.md

research-runs/
  <lab-id>/
    sessions/
      <session-id>/
        manifest.json
        results.tsv
        experiments/
          <experiment-id>/
            proposal.json
            patch.diff
            before-source-hashes.json
            after-source-hashes.json
            execution.json
            evaluation.json
            verdict.json
            review.json
            manifest.json
```

Large content-addressed Simulation Runs, Training Runs, Policies, and Revisions remain in their existing top-level artifact stores. Experiment evidence references those immutable identities rather than duplicating model weights and trajectories.

## Lab contract

A V2 Lab declares:

- identity and human research program;
- an execution lane: `controller`, `policy`, or `development`;
- one primary locked Benchmark and optional locked regression Benchmarks;
- exact editable files or directory closures;
- forbidden dependency and Judge surfaces;
- experiment count, training transition budget, and wall-clock ceiling;
- minimum same-tier score improvement;
- promotion target.

An editable path ending in `/**` owns that directory recursively. Other entries own one exact file. Paths are confined to the robot project. Symlinks are never followed. Mujica snapshots the project source before invoking the Researcher and rejects any changed, added, or deleted path outside the declared closure.

The Agent command receives a version-3 JSON request on stdin and runs with the
isolated robot folder as its working directory. It edits files directly and
returns only proposal metadata:

```json
{
  "strategy": "bounded-residual-actor",
  "hypothesis": "A smaller residual actor can smooth the upright prior without replacing its support logic.",
  "expectedEffect": "Reduce body motion and action jerk while retaining every upright gate."
}
```

The source diff, not a claimed list in the proposal, is authoritative.

An optional `researchBrief` carries a verified Human Observation handoff. Its
full evidence context, Brief id/hash, and closed authority boundary are frozen
into the Session and Experiment manifests. The Researcher may use it to
prioritize a hypothesis, but it does not widen the editable closure, budgets,
regressions, or promotion authority. A Brief whose Lab, program, or primary
Benchmark lock changed is stale and cannot execute. See [Human-guided Research
Briefs](human-guided-research-briefs.md).

After a KEEP/REVERT decision is locked, Mujica selects one deterministic
primary-case witness and persists both accepted and exact candidate Simulation
Runs before destroying the isolated workspace. The resulting Research Review
preserves Judge and Brief lineage for post-experiment human inspection. It is
not part of selection authority; a capture error is recorded without changing
the verdict. See [Human-reviewed Research
Outcomes](human-reviewed-research-outcomes.md).

## Execution lanes

### Controller

The staged Controller and Assembly are compiled and evaluated directly. A KEEP may publish a Robot Revision containing the accepted source closure and locked evaluation.

### Policy

The staged Trainer, model, Training definition, and optional policy wrapper are executed first. Training produces an immutable content-addressed Policy Artifact. The Judge then evaluates a temporary Controller that references that frozen Policy; evaluation cannot update weights or normalizers.

Every candidate Training Run and Policy is published even on REVERT. A KEEP atomically advances the declared source files and policy Controller, then publishes a Policy Revision. It does not become the whole-robot head unless a separate complete robot comparison justifies a Robot Revision.

### Development

The staged Development Candidate may coordinate Assembly, Component, Observation/Action contract, Controller, Trainer, and Policy changes, but its `candidate.json` declaration and Lab editable closure must both authorize the diff. The normal Candidate compiler and semantic verifier judge the staged robot. Only a KEEP may publish the new Robot Revision.

The compiler/verifier and the Lab Judge have different authority. The former
proves that the declared morphology, ABI, source closure, Benchmark lock, and
evaluation hashes are the ones actually tested. The latter makes the
lexicographic KEEP/REVERT decision against the current accepted state of that
Lab branch. Publication must not rerun the legacy all-gates-feasible Candidate
selector as a second Judge: coupled robot development often needs several
immutable, monotonically improving revisions before the branch reaches the
North Star.

A Development Lab KEEP is therefore branch-level acceptance, not a claim that
the complete robot is ready. Its Robot Revision records `kind:
research-lab-development`, the parent Revision, Lab/Experiment identity,
before/after violation counts, selection reason, exact changed files, semantic
contract changes, and the complete source closure. The executable Development
Review and Charter remain the whole-robot acceptance authority.

## Isolation and transactions

Each experiment receives a disposable copy of the robot project. Generated caches and prior mutable experiment directories are excluded; immutable Policies needed by the current Controller are included. Agent edits and all candidate execution happen in that copy.

Before promotion, Mujica verifies that every original editable source still matches the experiment's before hash. It then stages accepted files and imported immutable artifacts, verifies their hashes, and atomically swaps the mutable pointers. A failed promotion restores the previous source bytes. REVERT and CRASH never copy candidate source into the project.

This mechanism is deliberately independent of Git. Git remains useful human history, while Research Experiment identities and transactions remain valid for robot folders embedded in any workspace.

## Judge and budget

Robot selection is lexicographic:

1. Never regress a previously passing enforced gate.
2. Prefer fewer enforced gate violations.
3. At equal count, prefer lower normalized violation severity.
4. At equal feasibility, require the declared minimum score improvement.
5. Record sample, compute, model, component, and complexity costs in the score and evidence.

Policy training uses fixed environment transitions as its primary comparable sample budget. A wall-clock ceiling prevents runaway experiments and records platform-specific efficiency without pretending heterogeneous computers are identical. Runtime, Harness, dependencies, Trainer source, contracts, seed, budget, and model bytes remain part of Policy identity.

Training reward is diagnostic. Only frozen-policy evaluation on locked Benchmarks governs promotion.

## Agent topology

Mujica defines Researcher, Integrator, and Judge authorities, not a required number of AI processes. One Agent may work sequentially, or multiple Agents may exchange immutable artifacts. The important separation is:

- a Researcher cannot edit the Judge;
- an Integrator cannot mutate frozen Policy weights;
- the Judge cannot silently train or repair the candidate.

This keeps the development loop reproducible while allowing future multi-Agent research organizations to evolve entirely through `program.md` and external orchestration.

## Compatibility

V1 `research/*.research.json` and `training-research/*.training-research.json` remain executable during migration and retain their historical ledgers. New Labs use `research/<id>/research.json`. They do not rewrite or reinterpret completed V1 Experiments or Revisions.
