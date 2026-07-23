# Frozen Hardware State ABI

## Outcome

Every exported Hardware Bundle gives a real Driver one immutable, named
coordinate contract for device state. Capture, Digital Twin Audit, Studio, and
Agent inspection all refer to the same joint order, units, frames, quaternion
convention, and contract hash.

## Context

Hardware Capture previously required correctly sized `qpos` and `qvel` arrays,
but size alone cannot distinguish vendor encoder order, reversed joint signs,
zero offsets, degrees from radians, base-frame transforms, or `xyzw` from
MuJoCo's `wxyz` quaternion order. A valid-looking Driver could therefore feed
the Harness the wrong robot state while RL, Calibration, and Digital Twin Audit
optimized that mistaken meaning.

## Scope

- Derive the ABI from the exact Bundle-frozen MuJoCo model.
- Freeze it into new Bundles and bind its hash into Driver handshake, Capture,
  Verification, and Digital Twin Audit identity.
- Preserve legacy Bundle/Capture readability by deriving a clearly labelled ABI
  from their frozen model; never rewrite legacy evidence.
- Add named joint residuals to CLI and Studio.
- Do not invent vendor-specific encoder-map schemas before a real vendor Driver
  makes those fields concrete.

## Acceptance

- [x] Every `qpos` and `qvel` coordinate has a unique name, index, unit, and frame.
- [x] Free-root world/body-local semantics and `wxyz` quaternion order are explicit.
- [x] Bundle v2 freezes `state-contract.json` and a content hash.
- [x] Driver capability and hello exchange bind `state-abi-v1`.
- [x] new Captures preserve the ABI hash in their immutable identity.
- [x] Twin Audit rejects a mismatched ABI and reports named per-joint residuals.
- [x] Studio shows State ABI provenance and named worst joints.
- [x] Legacy Bundle/Capture evidence remains readable without mutation.
- [x] protocol smoke, full tests, validation, refreshed locks/evidence, docs,
  commit, and remote push pass.

## Work

1. Audit current implicit state semantics.
2. Implement MuJoCo-derived named state contract.
3. Bind Bundle, Driver, Capture, Verification, and Audit identities.
4. Surface named residuals to Agent and human interfaces.
5. Re-lock governed evidence and verify the complete project.

## Findings and decisions

- MuJoCo free-joint position, orientation, and linear velocity are in the model
  world frame, while angular velocity is body-local. MuJoCo quaternions are
  ordered `wxyz`; these are ABI fields, not documentation folklore.
- The Bundle export Runtime derives the ABI from compiled `mjModel`. Core does
  not grow a second, partial MJCF parser.
- The Driver owns conversion from native device semantics into normalized ABI
  semantics. Its complete package is already frozen by the Bundle. A separate
  vendor mapping artifact will be introduced only when a concrete device needs
  one.
- Legacy artifacts get `derived-from-frozen-model` ABI authority. New Bundle v2
  artifacts get `bundle-frozen` authority.
- The 11-frame historical Twin view is intentionally a 10-step, 0.2-second
  Shadow safety window. A longer Shadow attempt correctly stopped when
  zero-applied-action telemetry fell below the base-height gate; long learned
  gait viewing belongs to an actuated Simulation Replay, not a weakened Shadow
  protocol.

## Progress log

- 2026-07-24: Published Bundle v2 `hardware-414f568f15334180`
  (`qpos=19`, `qvel=18`, 13 named joints) and Policy Shadow Bundle
  `hardware-d474a4b669d2e3f6`, each with a different model-bound ABI hash.
- 2026-07-24: Published `verification-45b888818048f32f`
  (`PROTOCOL-VERIFIED`) and `verification-e02d4f747d465297`
  (`SHADOW-VERIFIED`). Neither claims physical hardware.
- 2026-07-24: Completed ABI-negotiated Capture
  `capture-b6d4e6918972f58c`; its manifest and hello transcript preserve
  `b69162417ca16e32...`.
- 2026-07-24: Published named Audit `twin-audit-d39ba3a31ffe9539`
  and Studio `studio-7ff64ddd3ba18d97`. The State ABI is bundle-frozen and
  transition rows name all 12 actuated joint residuals.

