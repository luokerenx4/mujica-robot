# Harness requirements found while onboarding Solo12

Updated: 2026-07-28

This is the requirement ledger from using Mujica on a source-grounded robot
rather than the original demo fixture. It records product needs, not a wish
list for generic framework abstractions.

| ID | Class | Requirement | Evidence from use | Status |
| --- | --- | --- | --- | --- |
| `design-provenance` | missing requirement | Compiled Assemblies and frozen Runtime inputs preserve source URL, revision, license, parameter assumptions, and validation status. | The clean-room model mixes sourced dimensions with explicit collision and numerical hypotheses. | resolved |
| `assembly-qualified-capability` | misleading evidence | An accepted capability is scoped to the exact Assembly, Controller, Benchmark, and optional Revision that earned it. A new Assembly starts unqualified. | The project charter said self-righting was accepted even though `solo12-informed` had never attempted it. | resolved |
| `adaptive-design-camera` | usability | Local Design Preview and Design Analysis frame the compiled robot from its home bounds. | The 0.55 m candidate occupied a small fraction of a camera fixed at 2.2 m. | resolved |
| `controller-smoke-test` | usability defect | A Controller may declare one compatible smoke-test route; inspect must emit that command instead of unrelated project defaults. | Inspecting the Solo12 stand Controller suggested the old integrated-resilience task. | resolved |
| `task-assembly-applicability` | missing requirement | Tasks with absolute plant assumptions, such as healthy base height, may declare compatible Assemblies; execution rejects incompatible combinations before Runtime. | The old `stand` task false-failed the smaller robot at 0.18 m. | resolved for explicit applicability; geometry-derived thresholds remain future work |
| `contact-pair-diagnostics` | diagnosis usability | Dynamic Runs preserve named self-contact pairs per frame plus first-time and dominant-step summaries in Metrics. | Finding the illegal torso/upper-leg impulse previously required a separate MuJoCo script. | resolved |
| `asset-fidelity-route` | evidence gap | The clean-room primitive model needs an intentional route to licensed CAD/mesh clearance comparison or physical measurement before sim-to-real claims. | Primitive collision envelopes are sufficient for mechanism screening but are not a digital twin. | open; retain as a design hypothesis |

The standing failure was not a request for more optimization budget. Four upper
legs intentionally pass through their hip mounting envelopes, but the first
primitive MJCF allowed those overlaps to generate contact forces. At the initial
state MuJoCo reported four 49 mm penetrations and approximately 17 Nm of
constraint force around each hip. Explicit assembly exclusions removed the
false contact; the same sourced PD gains then stood for the full two-second,
2,000-step probe with no fall, no disallowed collision, and 0.623 Nm peak
actuation.

The next behavior work is therefore bounded: declare a Solo12-specific
disturbance/standing suite, then probe locomotion or recovery. RL remains out of
scope until a readable Controller demonstrates the required mechanism.
