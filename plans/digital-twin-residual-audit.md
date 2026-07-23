# Digital Twin Residual Audit

## Outcome

Mujica can replay a completed Hardware Capture against its exact frozen Hardware Bundle, quantify one-step MuJoCo prediction error from the device-applied Action, and hand the same immutable transition evidence to a Coding Agent and a human in Studio.

## Context

Device Telemetry Replay made Hardware Capture state visible, but it cannot yet answer the next sim-to-real question: where does the frozen digital twin disagree with the device, by how much, and on which transition or joint? Calibration already performs one-step fitting internally, while Studio and the CLI lack a durable residual artifact that can guide diagnosis before any model change.

## Scope

- Add one-step digital-twin auditing for completed Hardware Capture episodes.
- Reset the frozen MuJoCo state from device `qpos`/`qvel` on every transition and apply the device-reported `appliedAction`.
- Publish immutable per-transition measured/predicted state and residuals plus aggregate and per-joint summaries.
- Expose exact transition inspection in the CLI and measured-versus-predicted playback in Studio.
- Bind every result to the Capture, episode, Bundle, model, Runtime, and Harness identities.
- Keep the result diagnostic only: it cannot grant actuation, change `hardwareVerified`, or promote a Calibration/Domain Profile.
- Do not add cumulative open-loop prediction, online parameter adaptation, automatic Calibration promotion, or new hardware protocol behavior in this slice.

## Acceptance

- Runtime rejects changed Capture/model bytes, malformed state/action sizes, non-contiguous steps, non-uniform device time, and control intervals that do not align with the frozen MuJoCo timestep.
- Every transition records device-measured next state, frozen-twin predicted next state, applied Action, base pose/velocity residuals, and per-joint position/velocity residuals.
- Summary identifies RMSE, maximum magnitude, worst transition, and per-joint RMSE without hiding quaternion sign equivalence.
- `mujica twin audit ...` creates or reuses one immutable artifact; `mujica twin inspect ...` verifies and reports its exact bytes.
- Studio shows synchronized device and frozen-twin motion plus the selected transition residual and provenance/authority boundary.
- Headless and visual contexts name the same audit, Capture, episode, Bundle, transition, and hashes.
- Unit, CLI, typecheck, project validation, and browser verification pass.
- Stable authority and numerical-semantics decisions are documented under `docs/design/`.

## Work

1. Freeze the request, output, and residual contracts around current Capture/Bundle integrity checks.
2. Implement the Runtime one-step audit and immutable artifact writer.
3. Add CLI audit/inspect commands and exact integrity verification.
4. Render the audit prediction and add synchronized Studio comparison.
5. Exercise the historical quadruped Shadow Capture, verify browser/headless agreement, run the full suite, and publish.

## Findings and decisions

- `hardware_capture.py` records `appliedAction` after the Driver response on row *t*; it is the authoritative Action for the transition from row *t* to row *t+1*. `commandedAction` is not used for residual prediction.
- The audit uses the model embedded in the exact captured Hardware Bundle without applying the protocol simulator's hidden plant Scenario. Applying hidden device parameters to the twin would erase the discrepancy the audit is intended to measure.
- Predictions are one-step and state-reset at each transition. Cumulative rollout is deferred because its error conflates local model mismatch with accumulated prior error.
- Shadow Captures are valid diagnostic input even when they are not calibration-eligible. Their authority remains Shadow telemetry, and the audit does not elevate it into calibration or actuation evidence.

## Progress log

- 2026-07-24: Confirmed row/action timing, terminal-row behavior, frozen target control rate, and reusable Hardware Capture/Bundle integrity boundaries.
- 2026-07-24: Published `twin-audit-1ab2530cd36ec210` from historical Shadow Capture `capture-5c09b673d06e0385` / `learned-policy-shadow` and its exact frozen Bundle `hardware-457fe145a8371cf0`. All 10 transitions use device `appliedAction`; transition 6 is worst across every summary family.
- 2026-07-24: The Audit measured joint-position RMSE `0.000652061 rad`, joint-velocity RMSE `0.065581521 rad/s`, base-position RMSE `0.000077482 m`, and base-orientation RMSE `0.000335582 rad`.
- 2026-07-24: Published synchronized Studio `studio-5ff43e129c09e862` with 11 device frames and 11 one-step twin frames. Browser stepping selected transition 0 at `0.020 s`, updated both frame paths and the exact residual source, and reported no console warnings or errors.
- 2026-07-24: Re-locked all 13 Benchmarks after Runtime/Harness source changes. Exported actuate-capable dry-run Bundle `hardware-1fde31d1e94095a8` and Policy Shadow Bundle `hardware-ba87fac80feb5f33`; published `verification-6a1335359ff7fdf9` as `PROTOCOL-VERIFIED` and `verification-7ce6e2e886db00ad` as `SHADOW-VERIFIED`. Both remain `hardwareVerified=false`.
- 2026-07-24: Passed typecheck, 68 TypeScript tests / 623 assertions, 41 Python Runtime tests, and project validation across 9 Assemblies.
