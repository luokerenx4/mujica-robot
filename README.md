# Mujica

**Mujica** is an AI-native robot development harness built on MuJoCo. It lets Coding Agents modify robot assemblies, add components, compile explicit observation/action contracts, develop controllers, train policies, run simulations, diagnose failures, and decide complete Robot Revisions through locked benchmarks.

> A robot is a folder. Assemblies are hardware programs. Components are packages. Controllers and trainers are programs. Tasks are tests. Objectives are benchmarks. MuJoCo is the runtime. Events are the debugging protocol.

Mujica is a clean sister project of [Integrated Industry Maker](https://github.com/luokerenx4/integrated-industry-maker). It inherits INM's file-native, compile-before-run, immutable-evidence, locked-benchmark, and agent CLI principles—not its industrial domain model.

## Quick start

Requires Bun and uv.

```bash
bun install
uv sync --project runtime

bun run mujica validate examples/quadruped
bun run mujica controller inspect examples/quadruped --controller bounded-traction-gait
bun run mujica assembly compare examples/quadruped --from baseline --to force-sensing
bun run mujica simulate examples/quadruped \
  --assembly force-sensing --controller forward-gait \
  --task forward-walk --scenario nominal --seed 101

bun run mujica simulate examples/quadruped \
  --assembly force-sensing-3dof --controller spatial-forward-gait \
  --task forward-walk --scenario actuator-delay --seed 606

bun run mujica evaluate examples/quadruped \
  --assembly force-sensing --controller forward-gait \
  --benchmark forward-locomotion
bun run mujica diagnose examples/quadruped \
  --assembly force-sensing-history-3dof --controller latency-aware-spatial-gait \
  --benchmark spatial-generalization
bun run mujica train examples/quadruped --training forward-residual-locomotion --seed 42
bun run mujica policies examples/quadruped
bun run mujica studio examples/quadruped --run run-e8bd80892b0f0123
bun run mujica studio examples/quadruped --run run-3404db433e7eb644 --compare-run run-35cd362b2def8a20
bun run mujica hardware export examples/quadruped --target spatial-dry-run
bun run mujica research list examples/quadruped
bun run mujica research inspect examples/quadruped --lab upright-residual-policy
bun run mujica research run examples/quadruped --lab upright-residual-policy \
  --iterations 1 --agent-command ./my-coding-agent
bun run mujica research status examples/quadruped --lab upright-residual-policy
bun run mujica research examples/quadruped --research forward-gait --iterations 6
bun run mujica train-research examples/quadruped --research forward-residual-policy --iterations 6
```

Research Lab V2 is the canonical source-level autoresearch protocol. A human `program.md`, an explicit Agent-editable source closure, and a locked Judge divide authority cleanly. Each candidate runs in a disposable project copy; only declared files may change, every Training Run and Policy remains immutable, and frozen robot Benchmark evidence—not training reward—decides KEEP, REVERT, or CRASH. The checked-in upright residual Lab contains a real experiment whose score improved `76.0910 → 76.1612` but was correctly REVERT because it introduced three regression-gate failures.

The bundled development slice adds a four-foot force sensor component to a quadruped, extends the Observation contract, and evaluates the complete assembly/controller change against nominal, low-friction, and lateral-push cases. Its bounded autoresearch loop keeps fixed inputs locked, records every KEEP/REVERT/CRASH attempt, updates only the declared controller parameters, and publishes each accepted result as a child Robot Revision.

The same hardware change also has an independent frozen-policy Development Candidate. It explicitly records the Assembly, contract, training configuration, Controller, and Policy transition. That candidate is honestly REVERT: the 1024-step force-aware PPO policy scores `43.3281` versus `44.0822` and misses every survival gate. Mujica records this as evidence that a real training run is not automatically a successful robot revision.

The checked-in research ledger contains 43 real MuJoCo experiments. Ten accepted controller changes improved the force-sensing quadruped from `83.3599` to `84.2544`; the built-in search then exhausted every one-step neighbor in its declared envelope without weakening the `0.02` KEEP threshold.

The Python/PyTorch lane uses a serialized force-aware PD residual prior instead of starting PPO from zero torque. Its checked-in Training Research ledger contains 11 frozen-policy experiments. One KEEP reduced the sample budget from 4096 to 2048 steps and improved the budget-aware learned-policy score from `84.1888` to `84.2398`. It remains slightly below the program-controller Robot Revision, so Mujica records it as a Policy Revision without making a false whole-robot promotion claim.

The current north-star slice closes the standing loophole. `forward-locomotion` scores net displacement toward a 1.25 m target, velocity, survival, uprightness, lateral drift, energy, model cost, and training cost across seven fixed cases. The promoted symmetric bound reaches `0.65–0.98 m` in every gating case, survives two seeded resets, low friction, payload, and a lateral push, and improves the stationary baseline by `23.5860` points. The 40 ms actuator-delay case remains visible as a scored, non-gating challenge because the current 2-DOF legs cannot yet recover it.

The periodic residual-policy lane ran 29 governed experiments. Four KEEP decisions improved its frozen score from `67.0765` to `71.2307` while reducing the selected budget to 4096 steps. It remains below the program controller's `72.9459`, so the program controller is the default Robot Revision and the learned lane remains an inspectable Policy Revision.

The spatial development slice adds abduction authority to every leg. Its 3-DOF controller passes a gating 50 N lateral push and the former 40 ms actuator-delay challenge, improving the locked development score from `59.7765` to `62.6170`. The accepted assembly is Robot Revision `quadruped-r-b1a3d1f7161a`; see [the spatial quadruped decision](docs/design/spatial-quadruped-development.md).

Native PPO then learns a governed half-scale residual over that predictive controller. Under the original Runtime it scored `63.0350` and was promoted as Policy Revision `quadruped-p-7423506a0965`. The friction-correct Runtime re-evaluates it at `60.4130`: six cases still pass and actuator-delay progress remains `0.694` with `0.030 m` drift, but the now-real low-friction case survives while sliding backward and fails forward progress. The immutable historical Revision remains inspectable; low-friction locomotion is reopened rather than falsely reported as solved.

A separate held-out audit tests mirrored pushes, unseen delay durations, and compound disturbances. It exposes delay-duration overfitting and adds an explicit 69-value actuator-telemetry Assembly without falsely promoting the unsuccessful generalized policies; see [the spatial generalization audit](docs/design/spatial-generalization-audit.md).

The follow-up adds a replayable four-step history contract, a bounded GRU history encoder, calibrated-latency priors, and governed residual regularization. Pure 20–60 ms latency was solved analytically. Evidence-guided compound research then reduced held-out violations from two to zero: all seven cases survive and progress, delay-plus-push drifts `0.1013 m`, and delay-plus-reset drifts `0.0676 m`, producing Robot Revision `quadruped-r-cb6b31bc8f4a`.

`mujica studio` projects the file-native evidence into a content-addressed, offline, read-only debugger. The Python Runtime reconstructs every recorded `qpos` with the Run's exact MuJoCo model and renders an authoritative 3D replay; Studio synchronizes it with play/pause, frame stepping, speed, scrubbing, semantic Event seeking, the top-down path, and frame telemetry. Add `--compare-run` to put a baseline and subject on one simulation-time clock with motion-quality deltas. A human can copy the exact immutable Run/frame comparison back to a Coding Agent without making the browser a second simulator or evaluator.

The hardware boundary exports a kept Robot Revision as an immutable, contract-bound driver Bundle and validates separately captured Evidence. The checked-in 250-sample conformance run is deliberately labeled `PROTOCOL-VERIFIED` and `hardwareVerified=false`; Mujica will not represent a simulated serial number as HIL or real-robot proof.

Components now carry explicit physical, geometry/collision, joint, actuator, and sensor inventories. This metadata migration changed every Assembly provenance hash but not one MJCF byte. Six frozen Policies were requalified into new immutable artifacts using old/new model and contract hash proofs. A later Runtime audit found that low-friction scenarios had changed only the floor geom; corrected contact friction invalidates the old all-seven-gates interpretation while preserving those immutable artifacts as historical evidence.

Component instance parameters are executable too: closed primitive schemas bind explicitly into MJCF with `{{config.<key>}}`, resolved defaults appear in semantic diffs, and inert or out-of-range values fail compilation. The configurable IMU example compiles 50 Hz and 200 Hz variants into distinct MuJoCo models without changing their Observation/Action ABI.

Mounts now compose physical structure, not only validate labels. Base-owned structural slots accept a Component `mountFragment`; the payload example adds a real 0.2 kg torso geom, and Python MuJoCo validation independently observes the extra geometry and mass while the control ABI stays fixed.

Program Controllers now declare the named Observation subset they consume and the complete ordered Action contract they produce. `mujica controller list|inspect` exposes legal Assembly combinations to humans and Agents, and an invalid pair fails before MuJoCo starts with the missing or mismatched channel instead of a late Python `KeyError`.

Task motion intent is now an executable ABI. Task v2 names bounded world planar velocity and body yaw rate explicitly; command-capable Assemblies expose a noise-independent `motion-command` channel, and every trajectory records command beside measured motion. Under the friction-correct Runtime, the promoted `command-tracking-gait` passes locked stop, forward, reverse, lateral, yaw, delayed-forward, and disturbed-lateral gates with score `76.4775` (`+5.2030` over baseline), while also retaining zero violations on the prior `spatial-generalization` suite.

Task v3 extends that ABI with exact, bounded intra-episode schedules while exposing only the active command to the Controller. The promoted `transition-aware-gait` removes all six baseline transition violations across stop, reversal, lateral/yaw redirection, three-step delayed braking, and payload variation, retains zero violations on both `command-tracking` and `spatial-generalization`, and publishes Robot Revision `quadruped-r-d7f3f01c8faa`. Its transition score is `68.1943` versus the infeasible baseline's `69.3280`; Mujica records the lower score and selects KEEP for reaching the zero-violation feasibility tier, with per-case regression gates still enforced. A 35 N delayed-push case remains visible as non-gating stress evidence.

The traction lane now reaches `friction = 0.1` without exposing Scenario identity to the Controller. Runs distinguish clipped and signed progress, backward displacement, signed pitch/pitch rate, and per-foot contact force. `bounded-traction-gait` preserves the proven mild-slip authority, then latches a lower severe mode only after measured backward pitch crosses `0.15 rad`. The expanded eleven-case Benchmark includes three hard seeded extreme reset cases; all ten hard cases pass with zero backward displacement, while `friction = 0.05` remains honest non-gating failure evidence. Candidate KEEP removes 20 baseline violations, improves `47.5783 → 66.0074`, retains zero violations on four prior capability suites, and publishes Robot Revision `quadruped-r-1101a73a0752`. See [traction recovery](docs/design/traction-recovery.md).

`mujica diagnose` turns a locked evaluation into signed gate margins, a ranked worst case, and an exact `simulate` reproduction command. It keeps measured failures separate from intervention hypotheses; those findings drove the command Controller from eight initial violations to zero without weakening either Benchmark.

Read [the architecture](docs/ARCHITECTURE.md), [Research Lab V2](docs/design/research-lab-v2.md), [component hardware inventory](docs/design/component-hardware-inventory.md), [typed Component configuration](docs/design/component-configuration.md), [structural Mount slots](docs/design/structural-mount-slots.md), [Program Controller interface](docs/design/program-controller-interface.md), [motion command contract](docs/design/motion-command-contract.md), [traction recovery](docs/design/traction-recovery.md), [read-only Studio design](docs/design/read-only-studio.md), [visual simulation debugger](docs/design/visual-simulation-debugger.md), [hardware verification boundary](docs/design/hardware-verification-boundary.md), [forward locomotion benchmark](docs/design/forward-locomotion-benchmark.md), [project format](docs/PROJECT_FORMAT.md), [controller research design](docs/design/robot-research-loop.md), [policy training research](docs/design/policy-training-research.md), and [CLI reference](docs/CLI.md).
