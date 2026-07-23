# Visual simulation debugger

## Purpose

The visual simulation debugger lets a human inspect the same MuJoCo state that Mujica evaluates. It is a derived view over immutable Simulation Run evidence, not a browser simulation, editor, or acceptance authority.

## Authority boundary

A completed Run owns the exact compiled Assembly and inputs, its frozen `model.xml` and model hash, the full state/action trajectory, semantic Events, metrics, score, and result hash.

The Python Runtime loads that frozen model (or, for a legacy Run, its exact content-addressed compiled cache), assigns each recorded `qpos` to `MjData`, calls `mj_forward`, and renders the resulting scene. Studio only chooses which derived frame to display. It never integrates state, invokes a Controller, or repairs a trajectory.

This separation prevents a visually plausible browser animation from disagreeing with the Run that passed or failed a Benchmark.

## Replay artifact

Derived replays live outside the immutable Run:

```text
.mujica/
  replays/
    <replay-id>/
      manifest.json
      frames/
        000000.png
        000001.png
        ...
```

Replay identity covers the Run id/result hash, Assembly/model hashes, trajectory byte hash, Runtime renderer identity, MuJoCo version, camera, resolution, and frame stride.

Publishing uses a temporary directory and atomic rename. The manifest records every PNG's SHA-256; cache reuse and Studio projection recheck the complete ordered frame set and every frame hash. An existing identity must have the same manifest or the operation fails closed. Rendering never writes beneath `runs/<id>`.

The Studio snapshot copies the selected replay into its content-addressed offline projection. This keeps `index.html` usable under a simple static server without depending on hidden absolute paths.

## Interaction model

The perspective replay, top-down trajectory, Event timeline, and telemetry share one selected frame index.

Controls include play/pause, previous and next frame, quarter/half/real/double speed, scrubbing, Event seeking, current health and motion telemetry, and copying a structured frame context with Run id, result hash, frame index, time, and telemetry.

Copying context does not edit the robot or Run. It gives the human an exact reference to paste into a Coding Agent conversation. The Agent can then inspect the same trajectory row, Events, and fixed inputs instead of working from an ambiguous visual description.

An optional comparison Run adds a second independently verified replay to the same snapshot. Both panels follow one simulation-time cursor and map that time to their own nearest recorded frame, so unequal episode lengths or render strides do not create false synchronization. Aggregate quality deltas and copied comparison context follow the [Motion-quality Judge](motion-quality-judge.md) contract.

## Camera and visual semantics

The first renderer uses a tracking perspective camera centered on the robot torso. MuJoCo renders the actual MJCF geoms, lighting, floor, body attitude, and articulated joints at `640 × 480`.

Health remains explicit in the surrounding UI rather than tinting rendered pixels, because changing model appearance could hide the original scene. Contact force is numeric per-foot telemetry synchronized to the frame.

## Failure behavior

Replay generation rejects missing or incomplete Run artifacts, a missing frozen model (or legacy content-addressed Assembly cache), trajectory rows with the wrong `qpos` size, a model hash differing from the Run input, an incomplete frame set, or an existing replay identity with different evidence.

Studio may still open a legacy Run without a replay and explain how to regenerate it, but it must not substitute a generic robot animation.

## Relationship to live debugging

Completed-Run replay is deterministic and directly shareable, so it is the first human-in-the-loop boundary. A future live mode can stream Runtime-rendered frames and telemetry while a simulation executes, but it must preserve the same rule: the browser observes MuJoCo state and never becomes a second dynamics engine or evaluator.
