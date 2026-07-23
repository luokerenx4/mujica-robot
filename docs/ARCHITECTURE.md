# Mujica architecture

> Mujica turns robot development into an executable, testable, trainable, and agent-operable software process.

## Concrete package boundaries

- `@mujica/core` owns strict schemas, project/workspace loading, path confinement, content hashes, Robot Assembly compilation, contract diffs, benchmark locks, and revision governance.
- `@mujica/cli` owns the `mujica` command, human summaries, versioned JSON envelopes, exit behavior, and invocation of Core and the Python Runtime.
- `@mujica/studio` owns a read-only, content-addressed projection of project source and immutable evidence into an offline debugger.
- `mujica_runtime` owns MuJoCo model validation, episodes, controllers, trajectories, semantic events, metrics, PPO training, Policy Artifacts, and frozen evaluation.

There is no generic plugin framework. New Runtime and Trainer backends split only when they have an independent implementation and lifecycle.

## Compile and execution pipeline

```text
mujica.json + Robot Base + Component packages + Robot Assembly
  -> strict schema validation and root-confined resolution
  -> mount compatibility and instance/name validation
  -> deterministic MJCF fragment composition
  -> observation/action contract compilation
  -> Task motion-command injection for command-capable Assemblies
  -> Controller interface compatibility validation
  -> content-addressed compiled robot directory
  -> MuJoCo load validation
  -> controller or trainer program
  -> optional static or periodic force-aware PD prior + learned residual action
  -> episode events + trajectory + net-motion/robustness metrics
  -> immutable Simulation Run or Policy Artifact
  -> locked multi-case evaluation
  -> evidence/hypothesis-separated gate diagnosis
  -> Candidate review or bounded Research proposal
  -> KEEP/REVERT/CRASH evidence and optional child Robot Revision
  -> Robot Revision actuation Bundle or Policy Revision shadow-only Bundle
  -> external driver Evidence -> shadow/protocol/HIL/real verification
```

The autonomous path borrows autoresearch's small loop—human program, one editable surface, fixed evaluator, compact memory, keep/discard—but keeps authority in Core. The proposer may suggest bounded numeric controller values; it cannot write project files, change the evaluator, waive gates, or publish revisions.

Research selection is lexicographic. A candidate may not turn a passing gate into a failure. Among infeasible candidates, fewer violations wins; at equal count, lower summed normalized violation severity wins; the authored minimum score improvement applies only when feasibility and severity tie. Development Candidate promotion follows the same capability ordering: reaching zero locked violations outranks aggregate score, while per-case regression gates remain absolute; once both baseline and proposal are feasible, score must improve. New Experiment and Revision evidence records counts, severities, and the selection reason.

The training path freezes every candidate Policy before scoring it. Training reward never decides KEEP. Whole-robot Revisions and Policy Revisions are distinct lineages, so a learned-lane improvement cannot silently replace a stronger robot controller. Development Candidate change declarations are compiled and verified before evaluation; kept Revisions freeze component, contract, Controller, and Policy identities in addition to source/evaluation snapshots. Benchmark locks include production evaluator source and dependency locks, not only authored JSON inputs. Locomotion evaluation uses net displacement and target distance, so standing or oscillating cannot masquerade as walking; seeded reset perturbations make multi-seed cases physically distinct.

Full Assembly provenance and executable compatibility are separate identities. `assemblyHash` changes for any Component-package edit; `executionHash` is a hash of composed MJCF plus ordered contracts. Frozen Policies bind execution identity. Metadata migration never edits an artifact: requalification produces a derived Policy only after proving byte-identical old/new MJCF and contract hashes against the old content-addressed cache.

Assembly Component config is compiled through explicit typed MJCF bindings. Resolved defaults are part of the compiled Component and semantic diff; a declared value that is unbound is rejected rather than allowed to become inert provenance.

Program Controller input/output requirements are source-level contracts, not implicit Python dictionary access. Required Observations may be a stable subset of a richer Assembly, while produced Actions match the complete ordered Assembly contract including bounds. Core rejects an incompatible pair before starting MuJoCo; `controller list|inspect` makes legal combinations discoverable to both humans and Coding Agents. Frozen policies continue to require exact immutable contract hashes.

Motion intent is executable input, not Controller configuration folklore. Task v2 distinguishes constant world planar linear velocity from body yaw rate; Task v3 schedules bounded command transitions on exact control steps while exposing no future segment to the Controller. A zero-mass Runtime Component contributes the active `motion-command` channel to opt-in Assemblies. Runs store commanded and measured motion at every step plus terminal, settling, braking-only settling, overshoot, and unsettled-transition evidence. Task v1 is rejected because its third velocity element historically measured vertical motion and cannot be silently reinterpreted.

Benchmark diagnosis is deterministic and read-only. It computes signed gate margins from the same locked Objective and fixed cases, ranks bottlenecks, and emits exact reproduction commands. Measurements are explicitly tagged as evidence; suggested Controller, Assembly, or training interventions are hypotheses and never affect KEEP or REVERT authority.

Traction evidence preserves sign instead of clipping every target-direction displacement to `[0, 1]`. `signedForwardProgress` and `backwardDisplacement` coexist with the original score-compatible `forwardProgress`, while signed pitch/pitch-rate evidence and optional per-foot forces make sagittal divergence and early unloading inspectable from immutable trajectories. The bounded traction Controller uses only deployable Observation channels: measured progress for zero-delay slip, signed pitch to latch lower severe-slip authority, contact unloading plus declared actuator delay for a conservative delayed gait, and bounded release state when a command changes. Scenario friction and future Task segments remain outside the Controller ABI.

Mechanical Components enter MuJoCo through explicit Base-owned Mount slots. Root fragments remain suitable for global sensor/actuator sections; mount fragments are inserted only into their selected body context. The compiler enforces slot cardinality and occupancy and removes unused markers from executable MJCF.

Hardware export is downstream of Revision governance. The Bundle freezes the deployable contracts, safety envelope, and complete project Driver Package; verification never trusts a mutable project pointer and re-hashes the embedded Revision, Controller, Target, contracts, Driver package, and executable entry. Capture launches only the Bundle copy and requires the executing Harness source and dependency lock to match the authorized identity. Dry-run protocol conformance is explicitly distinct from HIL or physical-hardware evidence.

The executable device boundary negotiates freshness, applied-Action,
decision-deadline, stop acknowledgement, and device-health capabilities.
Per-motor temperature/current and typed actuator state, bus voltage, Driver
faults, physical E-stop, and watchdog state are checked before Controller
evaluation. A learned Policy therefore cannot emit a proposal from a faulted
state. An acknowledged trip enters a stop-latched health window; continuously
healthy evidence may recommend a new session, but the current process has no
rearm transition and cannot recover actuation authority.

See [the harness design](design/robot-development-harness.md), [ML motion-quality research](design/ml-motion-quality-research.md), [component hardware inventory](design/component-hardware-inventory.md), [typed Component configuration](design/component-configuration.md), [structural Mount slots](design/structural-mount-slots.md), [Program Controller interface](design/program-controller-interface.md), [motion command contract](design/motion-command-contract.md), [traction recovery](design/traction-recovery.md), [read-only Studio](design/read-only-studio.md), [hardware verification boundary](design/hardware-verification-boundary.md), [forward locomotion benchmark](design/forward-locomotion-benchmark.md), [controller research](design/robot-research-loop.md), [policy training research](design/policy-training-research.md), [project format](PROJECT_FORMAT.md), and [CLI reference](CLI.md).
