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
| `readable-replay-framing` | usability | Simulation and twin replays use a robot-readable default camera distance instead of inheriting the old 2.2 m overview framing. | Solo12 leg exchange occupied too few pixels for a human to distinguish the active foot. | resolved; replay and twin defaults now use a 1.4 m tracking camera |
| `simulation-time-playback` | usability defect | Replay speed follows recorded simulation time and may skip dense rendered frames without changing evidence identity. | A 1 kHz trajectory advanced one PNG per 8 ms browser timer, so “1×” played at roughly 0.125× and made a four-second gait take more than thirty seconds. | resolved; sparse evidence keeps exact delays while dense evidence advances to the frame at the next 16 ms simulation-time budget |
| `declared-gait-contact-witness` | missing metric | A Controller gait declaration should bind intended swing/support feet to measured contact exchange and expose a Judge gate, rather than requiring an ad hoc trajectory query. | The first positive-displacement probe passed progress gates while only the forefeet lifted; shell inspection of contact bit patterns was required to reject it. | open; the final crawl records typed swing-leg telemetry and all four measured off-ground turns, but Judge does not yet score declaration/contact agreement |
| `controller-smoke-test` | usability defect | A Controller may declare one compatible smoke-test route; inspect must emit that command instead of unrelated project defaults. | Inspecting the Solo12 stand Controller suggested the old integrated-resilience task. | resolved |
| `task-assembly-applicability` | missing requirement | Tasks with absolute plant assumptions, such as healthy base height, may declare compatible Assemblies; execution rejects incompatible combinations before Runtime. | The old `stand` task false-failed the smaller robot at 0.18 m. | resolved for explicit applicability; geometry-derived thresholds remain future work |
| `contact-pair-diagnostics` | diagnosis usability | Dynamic Runs preserve named self-contact pairs per frame plus first-time and dominant-step summaries in Metrics. | Finding the illegal torso/upper-leg impulse previously required a separate MuJoCo script. | resolved |
| `stable-standing-without-failure` | misleading evidence | Stability dwell and time-to-stable begin at the declared evaluation boundary even when the robot is already stable; self-righting remains a separate witness. | The nominal Solo12 case originally reported zero dwell and the full episode as recovery time because the counter required a preceding failure. | resolved |
| `stability-intent-label` | misleading UI | Runtime identifies standing, disturbance recovery, and fallen-pose self-righting; Studio uses the corresponding status, heading, and summary metrics. | A push-recovery Run was labelled “Self-righting”, while a stable nominal Run appeared as “Not recovered”. | resolved |
| `transient-planar-excursion` | missing metric | Runs and gates preserve maximum planar displacement from the Episode initial base pose, not only post-recovery net drift. | The old `lateralDrift` showed fractions of a millimetre after its late mobility boundary while the push trajectory actually moved 5–6 cm. | resolved |
| `benchmark-assembly-applicability` | cross-project coupling | A Benchmark declares compatible Assemblies; Development Review evaluates only suites applicable to its selected subject and reports the others as `NOT_EVALUATED`. | Adding a Solo12 stage otherwise made Review attempt old demo tasks on Solo12 and Solo12 pushes on the old robot. | resolved |
| `next-capability-inception-routing` | workflow gap | When the selected robot passes every applicable stage but the project north star has no applicable Benchmark yet, Work Order should route creation of the next capability Plan/Benchmark instead of stopping at `NO_ELIGIBLE_LANES`. | Solo12 standing passes with zero blockers, while old locomotion stages are correctly out of scope; there is therefore no failed case from which the current Work Order can derive a lane. | resolved; Work Order now emits a typed mechanism-first inception contract and routes this readable Solo12 locomotion slice |
| `asset-fidelity-route` | evidence gap | The clean-room primitive model needs an intentional route to licensed CAD/mesh clearance comparison or physical measurement before sim-to-real claims. | Primitive collision envelopes are sufficient for mechanism screening but are not a digital twin. | open; retain as a design hypothesis |

The standing failure was not a request for more optimization budget. Four upper
legs intentionally pass through their hip mounting envelopes, but the first
primitive MJCF allowed those overlaps to generate contact forces. At the initial
state MuJoCo reported four 49 mm penetrations and approximately 17 Nm of
constraint force around each hip. Explicit assembly exclusions removed the
false contact; the same sourced PD gains then stood for the full two-second,
2,000-step probe with no fall, no disallowed collision, and 0.623 Nm peak
actuation.

The first two bounded behavior slices are now complete. The locked eight-case
Solo12-specific suite covers nominal standing, four 20 N cardinal pushes, a
300 g payload, lower friction, and a delayed/noisy diagonal disturbance. A
source-governed Research Lab kept two gain changes and rejected one, improving
the fixed-plant Controller from `kp=5, kd=0.1` to `kp=6, kd=0.2` with zero gate
violations. On the left-push visual witness, maximum planar excursion fell from
6.33 cm to 5.25 cm and stable recovery time from 0.615 s to 0.313 s.

The readable-locomotion slice then rejected its own first numerical PASS:
forward progress hid roughly 0.50 m of cumulative foot slip and the intended
diagonal pair never achieved honest contact exchange. The accepted replacement
is a conservative four-beat crawl. It advances in all four locked cases, keeps
mean foot slip at 0.0160–0.0199 m/s, preserves the eight standing regressions,
and makes FL, RR, FR, and RL take distinct measured swing turns. The next Work
Order routes a Solo12-specific command-foundation inception. RL remains
unauthorized until that readable mechanism has stop, reverse, lateral, yaw, and
transition evidence.
