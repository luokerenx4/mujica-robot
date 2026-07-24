# Executable Development Review

## Authority

The Development Charter is the human-owned requirement source. It declares the
project proposition, operational design domain, capability stages, one
north-star stage/Benchmark, whether human review is required, and a small
compiled resource envelope.

A Development Review is derived evidence. It may measure the selected compiled
Assembly, run fixed Benchmark cases, and propose next intervention surfaces. It
cannot edit the Charter, Benchmark, Objective, robot source, Controller,
Training, or any accepted Revision.

## Requirement trace

Each Review binds:

- the exact Charter and morphology hashes;
- the selected Assembly identity and Controller identity;
- every unique Benchmark lock named by the Charter;
- per-case metrics, scores, enforced gates, findings, and hypotheses;
- compiled resource measurements and margins;
- stage-level observed PASS/FAIL;
- the declared north-star stage and its observed result.

Authored `planned`, `active`, and `accepted` statuses express development
intent. Review `PASS` and `FAIL` express evidence for one exact subject. They
are deliberately separate.

## Stage semantics

A Charter Task/Scenario pair is a human-facing witness into one Benchmark.
Core validates that the pair exists. Review evaluates every gating case in each
unique Benchmark named by the stage. This prevents a visually convenient
witness from standing in for the complete locked test suite.

Development-only witnesses remain useful context, but Benchmark `gating` is the
only numerical release authority. Human observations remain hypotheses and do
not alter gate outcomes. If the Charter requires human review, passing
structure and numerical gates produces `HUMAN_REVIEW_REQUIRED`, not a completed
north-star claim. A future acceptance protocol must bind an explicit human
decision without upgrading hypothesis data into measured evidence.

## Design envelope

V1 measures total compiled mass, Component cost proxy, Action size,
Observation size, and contact-point count. These are intentionally simple,
exact, and available for every current Assembly. They are not a substitute for
geometry, payload, power, thermal, manufacturability, or hardware acceptance
requirements. Later constraints should extend this same compiled,
margin-carrying protocol rather than live in prose or reward shaping.

## HCI contract

`mujica project review` emits the full schema-versioned result and exact next
commands for Coding Agents. Studio reads the immutable Review and presents the
same design margins, stage results, worst case, and reproduction handoff to a
human.

Studio is read-only. A person may use the replay to record a Human Observation
and bind it into a Research Brief, but only the existing locked Judge protocols
can accept a design, Controller, or Policy change.
