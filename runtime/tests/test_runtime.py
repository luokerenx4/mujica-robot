from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

import mujoco
import numpy as np
import torch

from mujica_runtime.calibration import OneStepEstimator, _fit
from mujica_runtime.controllers import POLICY_WARMUP_PASSES, create_policy_network, load_policy_controller, load_program_controller, program_residual_gate_scale, transform_policy_action
from mujica_runtime.environment import RobotEnvironment, compile_motion_command_schedule
from mujica_runtime.hardware_capture import _command_lease_expiration, _device_health, _device_health_assessment, _device_health_reasons, _driver_deadline_rejection, _state_age_reason, _state_safety_reasons, _stopped_acknowledged
from mujica_runtime.io import hash_directory, hash_file, hash_json
from mujica_runtime.replay import RENDERER_ID, render_replay
from mujica_runtime.simulation import episode_survival_rate, motion_metrics, motion_quality_metrics, quaternion_body_tilt, quaternion_pitch, read_controller_telemetry, score_metrics, transition_response_metrics
from mujica_runtime.state_abi import STATE_ABI_KIND, describe_state
from mujica_runtime.training import PPOTrainer, assert_domain_profile_plant_compatible, effective_action_transform, quality_reward_penalty, sample_domain_profile, summarize_domain_samples
from mujica_runtime.twin_audit import AUDITOR_ID, audit_twin


ROOT = Path(__file__).resolve().parents[2]
PROJECT = ROOT / "examples" / "quadruped"
HEXAPOD = ROOT / "examples" / "hexapod"


def compiled_assembly(assembly_id: str, project: Path = PROJECT) -> tuple[Path, dict]:
    manifests = sorted((project / ".mujica" / "cache" / "assemblies").glob("*/compiled-assembly.json"), key=lambda path: path.stat().st_mtime_ns, reverse=True)
    for manifest_path in manifests:
        manifest = json.loads(manifest_path.read_text())
        if manifest["id"] != assembly_id:
            continue
        observation = json.loads((manifest_path.parent / "observation-contract.json").read_text())
        action = json.loads((manifest_path.parent / "action-contract.json").read_text())
        compiled = {
            **manifest,
            "observationContract": observation,
            "actionContract": action,
            "actionLow": [-6.0] * action["size"],
            "actionHigh": [6.0] * action["size"],
            "sensorChannelCount": sum(channel["size"] for channel in observation["channels"] if channel["kind"] == "sensor"),
        }
        return manifest_path.parent / "model.xml", compiled
    raise AssertionError(f"Assembly '{assembly_id}' was not compiled by the TypeScript test phase")


class RuntimeContractTest(unittest.TestCase):
    def test_hardware_state_abi_names_every_mujoco_coordinate(self):
        model, compiled = compiled_assembly("force-sensing-history-3dof")
        described = describe_state({
            "assembly": compiled["id"],
            "assemblyHash": compiled["assemblyHash"],
            "modelHash": hash_file(model),
            "modelPath": str(model),
        })
        contract = described["stateContract"]
        mujoco_model = mujoco.MjModel.from_xml_path(str(model))
        self.assertEqual(contract["kind"], STATE_ABI_KIND)
        self.assertEqual(described["stateContractHash"], hash_json(contract))
        self.assertEqual(contract["qpos"]["size"], mujoco_model.nq)
        self.assertEqual(contract["qvel"]["size"], mujoco_model.nv)
        self.assertEqual([item["index"] for item in contract["qpos"]["coordinates"]], list(range(mujoco_model.nq)))
        self.assertEqual([item["index"] for item in contract["qvel"]["coordinates"]], list(range(mujoco_model.nv)))
        self.assertEqual(contract["qpos"]["coordinates"][3]["name"], "root.orientation.w")
        self.assertEqual(contract["qvel"]["coordinates"][3]["frame"], "body-local")
        self.assertEqual(contract["quaternionConvention"]["order"], "wxyz")
        self.assertIn("hip-fl", [joint["name"] for joint in contract["joints"]])

    def test_digital_twin_audit_publishes_one_step_device_residuals(self):
        capture_id = "capture-5c09b673d06e0385"
        episode_id = "learned-policy-shadow"
        capture_root = PROJECT / "hardware-captures" / capture_id
        capture = json.loads((capture_root / "manifest.json").read_text())
        episode = next(item for item in capture["episodes"] if item["id"] == episode_id)
        bundle_root = PROJECT / "hardware-bundles" / "hardware-457fe145a8371cf0"
        bundle = json.loads((bundle_root / "manifest.json").read_text())
        model = bundle_root / "revision" / "compiled" / "model.xml"
        trajectory = capture_root / episode["path"]
        described = describe_state({
            "assembly": "history",
            "assemblyHash": bundle["assemblyHash"],
            "modelHash": hash_file(model),
            "modelPath": str(model),
        })
        with tempfile.TemporaryDirectory() as directory:
            request = {
                "runtimeVersion": "test-runtime",
                "runtimeSourceHash": "runtime-source",
                "harnessSourceHash": "harness-source",
                "source": {
                    "kind": "hardware-capture-episode",
                    "captureId": capture_id,
                    "captureHash": capture["captureHash"],
                    "episodeId": episode_id,
                    "episodeHash": episode["hash"],
                    "bundleId": bundle["id"],
                    "bundleHash": bundle["bundleHash"],
                    "environment": capture["environment"],
                    "mode": capture["mode"],
                    "stateContractHash": described["stateContractHash"],
                    "stateContractAuthority": "derived-from-frozen-model",
                },
                "assemblyHash": bundle["assemblyHash"],
                "modelHash": hash_file(model),
                "modelPath": str(model),
                "trajectoryHash": hash_file(trajectory),
                "trajectoryPath": str(trajectory),
                "controlHz": 50,
                "stateContract": described["stateContract"],
                "stateContractHash": described["stateContractHash"],
                "outputRoot": str(Path(directory) / "twin-audits"),
            }
            first = audit_twin(request)
            second = audit_twin(request)
            self.assertFalse(first["cached"])
            self.assertTrue(second["cached"])
            self.assertEqual(first["id"], second["id"])
            self.assertEqual(first["manifest"]["identity"]["auditor"], AUDITOR_ID)
            self.assertEqual(first["manifest"]["transitionCount"], 10)
            self.assertGreater(first["summary"]["metrics"]["jointPositionRad"]["rmse"], 0)
            self.assertEqual(first["summary"]["metrics"]["jointVelocityRadPerSec"]["worstTransition"], 6)
            self.assertEqual(first["summary"]["perJoint"]["names"][0], "abd-fl")
            self.assertFalse(first["summary"]["authority"]["grantsActuation"])
            transitions = [json.loads(line) for line in (Path(first["path"]) / "transitions.ndjson").read_text().splitlines()]
            self.assertEqual(transitions[6]["residual"]["joints"][0]["name"], "abd-fl")
            self.assertEqual(transitions[6]["fromStep"], 6)
            self.assertEqual(transitions[6]["toStep"], 7)
            self.assertEqual(len(transitions[6]["appliedAction"]), 12)
            self.assertEqual(len(transitions[6]["measured"]["qpos"]), 19)
            self.assertEqual(len(transitions[6]["predicted"]["qpos"]), 19)
            (Path(first["path"]) / "summary.json").write_text("{}")
            with self.assertRaisesRegex(RuntimeError, "summary.json integrity"):
                audit_twin(request)

    def test_training_rejects_a_domain_profile_from_another_plant(self):
        compatible = {"compiled": {"id": "history", "plantHash": "a" * 64}, "domainProfile": {"id": "profile", "plantHash": "a" * 64}}
        assert_domain_profile_plant_compatible(compatible)
        assert_domain_profile_plant_compatible({"compiled": compatible["compiled"], "domainProfile": {"id": "legacy"}})
        with self.assertRaisesRegex(RuntimeError, "plantHash does not match"):
            assert_domain_profile_plant_compatible({
                "compiled": compatible["compiled"],
                "domainProfile": {"id": "wrong", "plantHash": "b" * 64},
            })

    def test_visual_replay_is_content_addressed_and_reuses_only_complete_frames(self):
        model, compiled = compiled_assembly("force-sensing-3dof")
        run_root = PROJECT / "runs" / "run-e8bd80892b0f0123"
        source_row = next(line for line in (run_root / "trajectory.ndjson").read_text().splitlines() if line.strip())
        run_manifest = json.loads((run_root / "manifest.json").read_text())
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            trajectory = root / "trajectory.ndjson"
            trajectory.write_text(source_row + "\n")
            request = {
                "runtimeVersion": "test-runtime",
                "runtimeSourceHash": "test-source",
                "runId": run_manifest["id"],
                "resultHash": run_manifest["resultHash"],
                "assemblyHash": compiled["assemblyHash"],
                "modelHash": hash_file(model),
                "modelPath": str(model),
                "trajectoryPath": str(trajectory),
                "trajectoryHash": hash_file(trajectory),
                "outputRoot": str(root / "replays"),
                "settings": {"width": 160, "height": 120, "stride": 1, "camera": {"azimuth": 135, "elevation": -22, "distance": 2.2}},
            }
            first = render_replay(request)
            second = render_replay(request)
            self.assertFalse(first["cached"])
            self.assertTrue(second["cached"])
            self.assertEqual(first["id"], second["id"])
            self.assertEqual(first["manifest"]["renderer"], RENDERER_ID)
            self.assertEqual(first["manifest"]["frameCount"], 1)
            self.assertEqual(len(first["manifest"]["frameHashes"]), 1)
            frame = Path(first["path"]) / "frames" / "000000.png"
            self.assertEqual(frame.read_bytes()[:8], b"\x89PNG\r\n\x1a\n")
            frame.write_bytes(frame.read_bytes() + b"corrupt")
            with self.assertRaisesRegex(RuntimeError, "integrity"):
                render_replay(request)
            frame.unlink()
            with self.assertRaisesRegex(RuntimeError, "incomplete"):
                render_replay(request)

            capture_request = {
                **request,
                "source": {
                    "kind": "hardware-capture-episode",
                    "captureId": "capture-example",
                    "captureHash": "a" * 64,
                    "bundleId": "hardware-example",
                    "bundleHash": "b" * 64,
                    "episodeId": "commissioning",
                    "episodeHash": hash_file(trajectory),
                    "environment": "dry-run",
                    "mode": "shadow",
                },
            }
            capture = render_replay(capture_request)
            self.assertEqual(capture["manifest"]["version"], 2)
            self.assertEqual(capture["manifest"]["kind"], "mujica-hardware-capture-replay")
            self.assertEqual(capture["manifest"]["source"]["episodeId"], "commissioning")
            self.assertNotEqual(capture["id"], first["id"])
            with self.assertRaisesRegex(RuntimeError, "episode hash"):
                render_replay({**capture_request, "source": {**capture_request["source"], "episodeHash": "0" * 64}})
            with self.assertRaisesRegex(RuntimeError, "source hashes are invalid"):
                render_replay({**capture_request, "source": {**capture_request["source"], "captureHash": "capture"}})
            prediction_request = {
                **request,
                "source": {
                    "kind": "digital-twin-audit-prediction",
                    "auditId": "twin-audit-example",
                    "auditHash": "c" * 64,
                    "captureId": "capture-example",
                    "captureHash": "a" * 64,
                    "bundleId": "hardware-example",
                    "bundleHash": "b" * 64,
                    "episodeId": "commissioning",
                    "episodeHash": "d" * 64,
                    "predictionHash": hash_file(trajectory),
                },
            }
            prediction = render_replay(prediction_request)
            self.assertEqual(prediction["manifest"]["version"], 1)
            self.assertEqual(prediction["manifest"]["kind"], "mujica-digital-twin-prediction-replay")
            self.assertEqual(prediction["manifest"]["source"]["auditId"], "twin-audit-example")
            with self.assertRaisesRegex(RuntimeError, "prediction hash"):
                render_replay({**prediction_request, "source": {**prediction_request["source"], "predictionHash": "0" * 64}})

    def test_program_prior_policy_freezes_the_exact_controller_source(self):
        policy_root = PROJECT / "policies" / "upright-residual-locomotion-1d4c901d04ccfabb"
        architecture = json.loads((policy_root / "architecture.json").read_text())
        transform = architecture["actionTransform"]
        self.assertEqual(transform["kind"], "program-controller-residual")
        self.assertEqual(transform["controllerId"], "upright-traction-gait")
        self.assertEqual(hash_directory(policy_root / "prior"), transform["controllerHash"])
        prior = json.loads((policy_root / "prior" / "controller.json").read_text())
        self.assertEqual(prior["id"], transform["controllerId"])

    def test_frozen_policy_is_preheated_before_a_device_can_connect(self):
        _, compiled = compiled_assembly("force-sensing-history-3dof")
        compiled["observationContractHash"] = hash_json(compiled["observationContract"])
        compiled["actionContractHash"] = hash_json(compiled["actionContract"])
        definition = json.loads((PROJECT / "controllers" / "capture-calibrated-history-residual-gait" / "controller.json").read_text())
        controller = load_policy_controller(PROJECT, definition, compiled)
        self.assertEqual(POLICY_WARMUP_PASSES, 2)
        self.assertEqual(controller.warmup_passes, POLICY_WARMUP_PASSES)

    def test_latency_controller_integrates_lateral_velocity_from_reset(self):
        root = PROJECT / "controllers" / "latency-aware-spatial-gait"
        definition = json.loads((root / "controller.json").read_text())
        controller = load_program_controller(root, definition); controller.reset(7)
        observation = {
            "joint-position": np.zeros(12), "joint-velocity": np.zeros(12), "base-velocity": np.array([0.0, 0.25, 0.0, 0.0, 0.0, 0.0]),
            "base-orientation": np.array([1.0, 0.0, 0.0, 0.0]), "imu-angular-velocity": np.zeros(3), "foot-contact-force": np.zeros(4), "actuator-delay-steps": np.array([2.0]),
        }
        controller.act(observation, 0.0); controller.act(observation, 0.02)
        self.assertAlmostEqual(controller.lateral_position, 0.005)
        controller.reset(8); self.assertEqual(controller.lateral_position, 0.0); self.assertIsNone(controller.last_time)

    def test_bounded_history_gru_is_a_stateless_replayable_policy_encoder(self):
        architecture = {"kind": "history-gru-actor-critic", "observationSize": 141, "actionSize": 12, "hiddenSizes": [16], "history": {"commandStart": 41, "appliedStart": 89, "steps": 4, "actionSize": 12, "recurrentSize": 8}}
        network = create_policy_network(architecture); observation = torch.linspace(-1, 1, 141).unsqueeze(0)
        first = network(observation); second = network(observation)
        self.assertEqual(first[0].shape, (1, 12)); self.assertEqual(first[1].shape, (1,)); self.assertEqual(first[2].shape, (1, 12))
        torch.testing.assert_close(first[0], second[0]); torch.testing.assert_close(first[1], second[1])
    def test_training_residual_scale_is_frozen_into_the_effective_transform(self):
        base = {"kind": "spatial-gait-residual", "residualScale": 1.0}
        effective = effective_action_transform(base, {"residualScale": 0.25})
        self.assertEqual(effective["residualScale"], 0.25)
        self.assertEqual(base["residualScale"], 1.0)
        with self.assertRaisesRegex(RuntimeError, "requires a Trainer action transform"):
            effective_action_transform(None, {"residualScale": 0.25})

    def test_program_residual_gate_fails_closed_and_ramps_inside_allowed_mode(self):
        class Prior:
            def __init__(self, telemetry):
                self.value = telemetry

            def telemetry(self):
                return self.value

        transform = {
            "residualGate": {
                "kind": "prior-telemetry-mode",
                "allowedModes": ["locomotion"],
                "requiredTelemetry": {"recoveryCompleted": False},
                "rampSeconds": 0.5,
            }
        }
        self.assertEqual(program_residual_gate_scale(transform, Prior({"mode": "recovery"})), 0.0)
        self.assertEqual(
            program_residual_gate_scale(
                transform,
                Prior(
                    {
                        "mode": "locomotion",
                        "modeDwellSeconds": 1.0,
                        "recoveryCompleted": True,
                    }
                ),
            ),
            0.0,
        )
        self.assertEqual(
            program_residual_gate_scale(
                transform,
                Prior(
                    {
                        "mode": "locomotion",
                        "modeDwellSeconds": 0.1,
                        "recoveryCompleted": False,
                    }
                ),
            ),
            0.2,
        )
        self.assertEqual(
            program_residual_gate_scale(
                transform,
                Prior(
                    {
                        "mode": "locomotion",
                        "modeDwellSeconds": 1.0,
                        "recoveryCompleted": False,
                    }
                ),
            ),
            1.0,
        )
        self.assertEqual(program_residual_gate_scale(transform, object()), 0.0)
        with self.assertRaisesRegex(RuntimeError, "Unsupported program residual gate"):
            program_residual_gate_scale(
                {"residualGate": {"kind": "unknown"}},
                Prior({"mode": "locomotion"}),
            )

    def test_quality_reward_is_explicit_normalized_and_neutral_when_omitted(self):
        info = {"motionQuality": {
            "jointAccelerationMeanAbsRadPerSec2": 500.0,
            "bodyAngularAccelerationMeanAbsRadPerSec2": 50.0,
            "actionSlewMeanAbsPerSec": 400.0,
            "actuatorSaturationRate": 0.5,
            "footSlipMeanMps": 0.5,
            "footContactImpactMeanNPerSec": 10000.0,
        }}
        penalty, terms = quality_reward_penalty(info, {name: 1.0 for name in ["jointAcceleration", "bodyAngularAcceleration", "actionSlew", "actuatorSaturation", "footSlip", "footImpact"]})
        self.assertAlmostEqual(penalty, 3.0)
        self.assertEqual(terms, {name: 0.5 for name in terms})
        self.assertEqual(quality_reward_penalty(info, None)[0], 0.0)

    def test_domain_profile_sampling_is_separate_reproducible_and_applied_to_mujoco(self):
        profile = {"parameters": {
            "bodyMassScale": {"minimum": 0.9, "maximum": 1.1},
            "jointDampingScale": {"minimum": 0.8, "maximum": 1.2},
            "actuatorStrengthScale": {"minimum": 0.85, "maximum": 1.15},
            "frictionScale": {"minimum": 0.7, "maximum": 1.3},
            "observationNoiseStd": {"minimum": 0.001, "maximum": 0.003},
            "actuatorDelayJitterSteps": {"minimum": 1, "maximum": 2},
            "pushTimeOffsetSeconds": {"minimum": -0.2, "maximum": 0.2},
            "pushForceScale": {"minimum": 0.8, "maximum": 1.2},
            "pushDirectionJitterRad": {"minimum": -0.3, "maximum": 0.3},
        }}
        first = sample_domain_profile(profile, 19); second = sample_domain_profile(profile, 19)
        self.assertEqual(first, second)
        self.assertEqual(sample_domain_profile(None, 19), {})
        self.assertIn(first["actuatorDelayJitterSteps"], [1, 2])
        summary = summarize_domain_samples([
            {"parameters": {"bodyMassScale": 0.9, "actuatorDelayJitterSteps": 1}},
            {"parameters": {"bodyMassScale": 1.1, "actuatorDelayJitterSteps": 2}},
        ])
        self.assertEqual(summary["bodyMassScale"], {"minimum": 0.9, "mean": 1.0, "maximum": 1.1})

        model, compiled = compiled_assembly("command-conditioned-history-3dof")
        task = json.loads((PROJECT / "tasks" / "stand.task.json").read_text())
        scenario = json.loads((PROJECT / "scenarios" / "mission-impact-left.scenario.json").read_text())
        nominal = RobotEnvironment(model, compiled, task, scenario, 7)
        sample = {
            "bodyMassScale": 1.1,
            "jointDampingScale": 0.5,
            "actuatorStrengthScale": 0.8,
            "frictionScale": 0.6,
            "observationNoiseStd": 0.002,
            "actuatorDelayJitterSteps": 2,
            "pushTimeOffsetSeconds": 0.15,
            "pushForceScale": 0.8,
            "pushDirectionJitterRad": np.pi / 2,
        }
        randomized = RobotEnvironment(model, compiled, task, scenario, 7, sample)
        self.assertAlmostEqual(float(randomized.model.body_mass.sum()), float(nominal.model.body_mass.sum()) * 1.1)
        np.testing.assert_allclose(randomized.model.body_inertia, nominal.model.body_inertia * 1.1)
        np.testing.assert_allclose(randomized.model.dof_damping, nominal.model.dof_damping * 0.5)
        np.testing.assert_allclose(randomized.model.actuator_gainprm[:, 0], nominal.model.actuator_gainprm[:, 0] * 0.8)
        np.testing.assert_allclose(randomized.model.geom_friction[:, 0], float(scenario["friction"]) * 0.6)
        self.assertEqual(randomized.scenario["actuatorDelaySteps"], int(scenario["actuatorDelaySteps"]) + 2)
        self.assertAlmostEqual(randomized.scenario["observationNoiseStd"], float(scenario["observationNoiseStd"]) + 0.002)
        self.assertAlmostEqual(randomized.external_push["timeSeconds"], 2.65)
        self.assertAlmostEqual(randomized.external_push["forceNewton"], 80.0)
        np.testing.assert_allclose(randomized.external_push["directionXY"], [-1.0, 0.0], atol=1e-12)
        randomized.reset()
        self.assertEqual(randomized.events[0]["plant"]["actuatorDelaySteps"], int(scenario["actuatorDelaySteps"]) + 2)
        self.assertEqual(randomized.events[0]["disturbance"], randomized.external_push)

    def test_system_identification_recovers_an_independent_hidden_plant(self):
        hidden = {
            "bodyMassScale": 1.125,
            "jointDampingScale": 0.9,
            "actuatorStrengthScale": 1.175,
            "actuatorDelaySteps": 2,
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            model = root / "pendulum.xml"
            model.write_text("""<mujoco model="calibration-pendulum">
  <option timestep="0.002" gravity="0 0 -9.81"/>
  <worldbody>
    <body name="link-1" pos="0 0 0">
      <joint name="joint-1" type="hinge" axis="0 1 0" damping="0.8"/>
      <geom name="link-1-geom" type="capsule" fromto="0 0 0 0 0 -0.45" size="0.035" density="700"/>
      <body name="link-2" pos="0 0 -0.45">
        <joint name="joint-2" type="hinge" axis="0 1 0" damping="0.5"/>
        <geom name="link-2-geom" type="capsule" fromto="0 0 0 0 0 -0.35" size="0.03" density="600"/>
      </body>
    </body>
  </worldbody>
  <actuator>
    <motor name="motor-1" joint="joint-1" gear="1" ctrllimited="true" ctrlrange="-8 8"/>
    <motor name="motor-2" joint="joint-2" gear="1" ctrllimited="true" ctrlrange="-8 8"/>
  </actuator>
</mujoco>
""")
            hidden_model = mujoco.MjModel.from_xml_path(str(model))
            hidden_model.body_mass[:] *= hidden["bodyMassScale"]
            hidden_model.body_inertia[:] *= hidden["bodyMassScale"]
            hidden_model.dof_damping[:] *= hidden["jointDampingScale"]
            hidden_model.actuator_gainprm[:, 0] *= hidden["actuatorStrengthScale"]
            sources = []
            for source_index, seed in enumerate([101, 202, 303]):
                data = mujoco.MjData(hidden_model)
                data.qpos[:] = [0.15 * (source_index + 1), -0.1 * (source_index + 1)]
                mujoco.mj_forward(hidden_model, data)
                rng = np.random.default_rng(seed)
                command_history = []
                rows = []
                action = np.zeros(hidden_model.nu)
                for step in range(80):
                    if step % 4 == 0:
                        action = rng.uniform(-4.0, 4.0, hidden_model.nu)
                    rows.append({
                        "episode": f"excitation-{source_index + 1}",
                        "step": step,
                        "time": step / 50.0,
                        "qpos": data.qpos.tolist(),
                        "qvel": data.qvel.tolist(),
                        "commandedAction": action.tolist(),
                    })
                    command_history.append(action.copy())
                    delayed = command_history[step - hidden["actuatorDelaySteps"]] if step >= hidden["actuatorDelaySteps"] else np.zeros(hidden_model.nu)
                    data.ctrl[:] = delayed
                    for _ in range(10):
                        mujoco.mj_step(hidden_model, data)
                rows.append({
                    "episode": f"excitation-{source_index + 1}",
                    "step": len(rows),
                    "time": len(rows) / 50.0,
                    "qpos": data.qpos.tolist(),
                    "qvel": data.qvel.tolist(),
                    "commandedAction": np.zeros(hidden_model.nu).tolist(),
                })
                path = root / f"capture-{source_index + 1}.ndjson"
                path.write_text("\n".join(json.dumps(row, separators=(",", ":")) for row in rows) + "\n")
                sources.append({"kind": "capture", "id": f"capture-{source_index + 1}", "path": str(path), "hash": hash_file(path)})
            definition = {
                "sources": [{}, {}, {}],
                "parameters": {
                    "bodyMassScale": {"minimum": 0.9, "maximum": 1.2},
                    "jointDampingScale": {"minimum": 0.6, "maximum": 1.2},
                    "actuatorStrengthScale": {"minimum": 0.8, "maximum": 1.3},
                    "actuatorDelaySteps": {"minimum": 0, "maximum": 3},
                },
                "optimizer": {"rounds": 3, "samplesPerAxis": 5, "validationSources": 1},
            }
            estimator = OneStepEstimator(model, 50.0, {"friction": 1.0, "payloadKg": 0.0}, sources)
            first = _fit(estimator, definition)
            second = _fit(estimator, definition)
            self.assertEqual(first["parameters"], second["parameters"])
            self.assertEqual(first["parameters"]["actuatorDelaySteps"], 2)
            self.assertLess(first["validation"]["loss"], 0.001)
            for name, expected in [
                ("bodyMassScale", 1.125),
                ("jointDampingScale", 0.9),
                ("actuatorStrengthScale", 1.175),
            ]:
                self.assertAlmostEqual(first["parameters"][name], expected, delta=0.02)
    def test_survival_is_measured_against_the_requested_episode(self):
        self.assertAlmostEqual(episode_survival_rate(56, 250), 0.224)
        self.assertAlmostEqual(episode_survival_rate(250, 250), 1.0)

    def test_motion_quality_uses_control_grid_applied_action_and_planted_foot_sites(self):
        positions = [
            np.zeros((4, 3)),
            np.tile([0.01, 0.0, 0.0], (4, 1)),
            np.tile([0.03, 0.0, 0.0], (4, 1)),
        ]
        rows = []
        for index, (joint_velocity, action, force) in enumerate([(0.0, 0.0, 2.0), (1.0, 0.5, 3.0), (3.0, 1.0, 1.0)]):
            qvel = np.zeros(8); qvel[3:6] = [0.0, 0.0, joint_velocity]; qvel[6:] = joint_velocity
            rows.append({"qvel": qvel.tolist(), "action": [action, action], "footPositionWorld": positions[index].tolist(), "footContactForce": [force] * 4})
        metrics = motion_quality_metrics(rows, 10, [-1, -1], [1, 1])
        self.assertTrue(metrics["motionQualityFootEvidenceAvailable"])
        self.assertAlmostEqual(metrics["meanJointJerkRadPerSec3"], 100.0)
        self.assertAlmostEqual(metrics["peakBodyAngularJerkRadPerSec3"], 100.0)
        self.assertAlmostEqual(metrics["meanActionSlewRatePerSec"], 5.0)
        self.assertAlmostEqual(metrics["actuatorSaturationRate"], 1.0 / 3.0)
        self.assertAlmostEqual(metrics["meanFootSlipSpeedMps"], 0.1)
        self.assertAlmostEqual(metrics["totalFootSlipDistanceM"], 0.04)
        self.assertAlmostEqual(metrics["peakFootContactImpactNPerSec"], 10.0)
        self.assertEqual(rows[2]["motionQuality"]["jointJerkRadPerSec3"], [100.0, 100.0])

    def test_motion_quality_marks_missing_foot_evidence_without_inventing_slip(self):
        rows = [{"qvel": [0.0] * 8, "action": [0.0, 0.0], "footPositionWorld": None, "footContactForce": None}]
        metrics = motion_quality_metrics(rows, 50, [-1, -1], [1, 1])
        self.assertFalse(metrics["motionQualityFootEvidenceAvailable"])
        self.assertEqual(metrics["meanFootSlipSpeedMps"], 0.0)
        self.assertIsNone(rows[0]["motionQuality"]["footSlipSpeedMps"])

    def test_pitch_uses_mujoco_wxyz_sign_and_radian_conventions(self):
        angle = 0.4
        positive = np.array([np.cos(angle / 2), 0.0, np.sin(angle / 2), 0.0])
        negative = np.array([np.cos(angle / 2), 0.0, -np.sin(angle / 2), 0.0])
        self.assertAlmostEqual(quaternion_pitch(np.array([1.0, 0.0, 0.0, 0.0])), 0.0)
        self.assertAlmostEqual(quaternion_pitch(positive), angle)
        self.assertAlmostEqual(quaternion_pitch(negative), -angle)

    def test_body_tilt_is_yaw_invariant_and_geometric_near_pitch_singularity(self):
        angle = 0.4
        yaw = np.array([np.cos(angle / 2), 0.0, 0.0, np.sin(angle / 2)])
        roll = np.array([np.cos(angle / 2), np.sin(angle / 2), 0.0, 0.0])
        pitch = np.array([np.cos(angle / 2), 0.0, np.sin(angle / 2), 0.0])
        near_horizontal = np.array([np.cos((np.pi / 2 - 1e-6) / 2), 0.0, np.sin((np.pi / 2 - 1e-6) / 2), 0.0])
        self.assertAlmostEqual(quaternion_body_tilt(yaw), 0.0)
        self.assertAlmostEqual(quaternion_body_tilt(roll), angle)
        self.assertAlmostEqual(quaternion_body_tilt(pitch), angle)
        self.assertAlmostEqual(quaternion_body_tilt(near_horizontal), np.pi / 2 - 1e-6)

    def test_locomotion_score_requires_net_forward_progress(self):
        task = {"version": 2, "motionCommand": {"frame": "world", "linearVelocityMps": [0.2, 0.0], "yawRateRadPerSec": 0.0}, "durationSeconds": 3.0, "controlHz": 50}
        stationary = motion_metrics(np.zeros(3), np.array([0.03, 0.0, 0.0]), 0.1, task, 3.0)
        walking = motion_metrics(np.zeros(3), np.array([0.6, 0.02, 0.0]), 0.65, task, 3.0)
        self.assertAlmostEqual(stationary["forwardProgress"], 0.05)
        self.assertAlmostEqual(walking["forwardProgress"], 1.0)
        self.assertAlmostEqual(walking["lateralDrift"], 0.02)
        slipping = motion_metrics(np.zeros(3), np.array([-0.2, 0.01, 0.0]), 0.25, task, 3.0)
        self.assertAlmostEqual(slipping["signedForwardProgress"], -1.0 / 3.0)
        self.assertAlmostEqual(slipping["backwardDisplacement"], 0.2)
        objective = {"weights": {"survival": 0, "velocityTracking": 0, "forwardProgress": 35, "upright": 0, "lateralDrift": 5, "energy": 0, "smoothness": 0, "componentMass": 0, "sensorChannels": 0, "trainingSteps": 0}}
        base = {"survivalRate": 1, "meanVelocityTrackingError": 0, "meanUpright": 1, "meanEnergy": 0, "meanSmoothness": 0}
        compiled = {"totalMassKg": 0, "sensorChannelCount": 0}
        stationary_score = score_metrics({**base, **stationary}, objective, compiled)["total"]
        walking_score = score_metrics({**base, **walking}, objective, compiled)["total"]
        self.assertGreater(walking_score - stationary_score, 30)

    def test_scheduled_command_switches_on_the_exact_pre_action_boundary(self):
        model, compiled = compiled_assembly("command-conditioned-history-3dof")
        task = {"version": 3, "id": "boundary", "name": "Boundary", "durationSeconds": 0.06, "controlHz": 50, "healthyHeight": [0.19, 0.7], "terminateOnFall": True, "motionCommandSchedule": [
            {"atSeconds": 0.0, "command": {"frame": "world", "linearVelocityMps": [0.25, 0.0], "yawRateRadPerSec": 0.0}},
            {"atSeconds": 0.02, "command": {"frame": "world", "linearVelocityMps": [0.0, 0.0], "yawRateRadPerSec": 0.5}},
        ]}
        scenario = json.loads((PROJECT / "scenarios" / "nominal.scenario.json").read_text())
        environment = RobotEnvironment(model, compiled, task, scenario, 7)
        observation = environment.reset(); np.testing.assert_allclose(observation["motion-command"], [0.25, 0.0, 0.0])
        first = environment.step(np.zeros(environment.model.nu))
        self.assertEqual(first.info["commandStep"], 0); np.testing.assert_allclose(first.info["motionCommand"], [0.25, 0.0, 0.0])
        np.testing.assert_allclose(first.observation["motion-command"], [0.0, 0.0, 0.5])
        second = environment.step(np.zeros(environment.model.nu))
        self.assertEqual(second.info["commandStep"], 1); np.testing.assert_allclose(second.info["motionCommand"], [0.0, 0.0, 0.5])
        self.assertEqual(environment.events[-1], {"type": "motion-command.changed", "time": 0.02, "step": 1, "motionCommand": [0.0, 0.0, 0.5]})

    def test_transition_metrics_expose_settling_terminal_error_and_overshoot(self):
        task = {"version": 3, "durationSeconds": 2.0, "controlHz": 10, "motionCommandSchedule": [
            {"atSeconds": 0.0, "command": {"frame": "world", "linearVelocityMps": [0.5, 0.0], "yawRateRadPerSec": 0.0}},
            {"atSeconds": 1.0, "command": {"frame": "world", "linearVelocityMps": [0.0, 0.0], "yawRateRadPerSec": 0.0}},
        ]}
        objective = {"transientMeasurement": {"planarToleranceMps": 0.12, "yawRateToleranceRadPerSec": 0.1, "holdSeconds": 0.2}}
        rows = [{"step": step + 1, "commandStep": step, "measuredMotion": measured} for step, measured in [(10, [0.4, 0, 0]), (11, [0.11, 0, 0]), (12, [0.1, 0, 0]), (13, [-0.03, 0, 0])]]
        metrics = transition_response_metrics(rows, task, objective); transition = metrics["transitions"][0]
        self.assertEqual(compile_motion_command_schedule(task)[1]["atStep"], 10)
        self.assertAlmostEqual(transition["planarSettlingTimeSeconds"], 0.3)
        self.assertAlmostEqual(transition["terminalPlanarTrackingError"], 0.035)
        self.assertAlmostEqual(transition["planarOvershootMps"], 0.03)
        self.assertTrue(transition["planarSettled"])
        self.assertTrue(transition["planarBraking"])
        self.assertAlmostEqual(metrics["maximumPlanarBrakingSettlingTimeSeconds"], 0.3)

    def test_scenario_friction_applies_to_every_contact_geometry(self):
        model, compiled = compiled_assembly("baseline")
        task = json.loads((PROJECT / "tasks" / "stand.task.json").read_text())
        scenario = {**json.loads((PROJECT / "scenarios" / "nominal.scenario.json").read_text()), "friction": 0.37}
        environment = RobotEnvironment(model, compiled, task, scenario, 7)
        np.testing.assert_allclose(environment.model.geom_friction[:, 0], 0.37)

    def test_recovery_task_applies_an_exact_fallen_pose_without_ordinary_fall_termination(self):
        model, compiled = compiled_assembly("self-righting-rigid-3dof")
        task = json.loads((PROJECT / "tasks" / "self-right.task.json").read_text())
        scenario = json.loads((PROJECT / "scenarios" / "fallen-left.scenario.json").read_text())
        environment = RobotEnvironment(model, compiled, task, scenario, 6103)
        observation = environment.reset()
        np.testing.assert_allclose(environment.data.qpos[:3], scenario["initialBasePose"]["positionM"])
        np.testing.assert_allclose(environment.data.qpos[3:7], scenario["initialBasePose"]["orientationWxyz"])
        np.testing.assert_allclose(observation["base-orientation"], scenario["initialBasePose"]["orientationWxyz"])
        self.assertEqual(environment.events[0]["initialBasePose"], scenario["initialBasePose"])
        self.assertEqual(compile_motion_command_schedule(task)[0]["command"].tolist(), [0.0, 0.0, 0.0])
        environment.data.qpos[2] = 0.01
        result = environment.step(np.zeros(environment.model.nu))
        self.assertFalse(result.terminated)

    def test_scheduled_recovery_task_keeps_exact_post_recovery_command_boundary(self):
        task = json.loads((PROJECT / "tasks" / "recover-forward.task.json").read_text())
        schedule = compile_motion_command_schedule(task)
        self.assertEqual([segment["atStep"] for segment in schedule], [0])
        np.testing.assert_allclose(schedule[0]["command"], [0.2, 0.0, 0.0])
        self.assertEqual(task["mobilityMeasurementStartSeconds"], 5)
        metrics = motion_metrics(
            np.array([0.4, 0.0, 0.4]),
            np.array([0.8, 0.02, 0.4]),
            0.5,
            task,
            4.0,
            measurement_start_seconds=5.0,
        )
        self.assertAlmostEqual(metrics["targetDistance"], 0.8)
        self.assertAlmostEqual(metrics["forwardProgress"], 0.5)

    def test_phased_self_right_controller_classifies_pose_and_exposes_phase_telemetry(self):
        root = PROJECT / "controllers" / "phased-self-right"
        definition = json.loads((root / "controller.json").read_text())
        controller = load_program_controller(root, definition)
        controller.reset(6101)
        observation = {
            "joint-position": np.zeros(12),
            "joint-velocity": np.zeros(12),
            "base-height": np.array([0.18]),
            "base-orientation": np.array([2 ** -0.5, 0.0, 2 ** -0.5, 0.0]),
            "base-velocity": np.zeros(6),
            "foot-contact-force": np.array([5.0, 5.0, 0.0, 0.0]),
        }
        self.assertEqual(controller.act(observation, 0.0).shape, (12,))
        self.assertEqual(read_controller_telemetry(controller), {
            "phase": "impulse",
            "fallenPose": "front",
            "supportFeet": 2,
            "recoveryTargetSatisfied": False,
            "targetStreakSteps": 0,
        })
        controller.act(observation, 0.9)
        self.assertEqual(read_controller_telemetry(controller)["phase"], "capture")
        controller.act(observation, 1.3)
        self.assertEqual(read_controller_telemetry(controller)["phase"], "rise")

    def test_behavior_supervisor_distinguishes_gait_excursion_from_resting_fall(self):
        root = PROJECT / "controllers" / "behavior-supervisor"
        definition = json.loads((root / "controller.json").read_text())
        controller = load_program_controller(root, definition)
        observation = {
            "joint-position": np.zeros(12),
            "joint-velocity": np.zeros(12),
            "base-height": np.array([0.44]),
            "base-orientation": np.array([1.0, 0.0, 0.0, 0.0]),
            "base-velocity": np.zeros(6),
            "imu-angular-velocity": np.zeros(3),
            "foot-contact-force": np.full(4, 5.0),
            "actuator-delay-steps": np.zeros(1),
            "motion-command": np.array([0.2, 0.0, 0.0]),
        }
        controller.reset(6201)
        controller.act(observation, 0.0)
        self.assertEqual(read_controller_telemetry(controller)["mode"], "locomotion")
        dynamic_tilt = {**observation, "base-height": np.array([0.25]), "base-orientation": np.array([2 ** -0.5, 0.0, 2 ** -0.5, 0.0])}
        for step in range(10):
            controller.act(dynamic_tilt, (step + 1) * 0.02)
        self.assertEqual(read_controller_telemetry(controller)["mode"], "locomotion")
        controller.reset(6201)
        resting_fall = {**dynamic_tilt, "base-height": np.array([0.18])}
        controller.act(resting_fall, 0.0)
        telemetry = read_controller_telemetry(controller)
        self.assertEqual(telemetry["mode"], "recovery")
        self.assertEqual(telemetry["phase"], "recovery.impulse")
        controller.locomotion.config["hipAmplitude"] = 0.205
        controller.locomotion.config["kneeAmplitude"] = 0.07
        controller.reset(6202)
        self.assertEqual(controller.locomotion.config["hipAmplitude"], definition["config"]["locomotion"]["hipAmplitude"])
        self.assertEqual(controller.locomotion.config["kneeAmplitude"], definition["config"]["locomotion"]["kneeAmplitude"])

    def test_program_controller_can_compose_package_local_modules(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "helper.py").write_text(
                "import numpy as np\n"
                "class Child:\n"
                "    def reset(self, seed): self.seed = seed\n"
                "    def act(self, observation, time_seconds): return np.asarray([self.seed + time_seconds])\n"
            )
            (root / "controller.py").write_text(
                "from .helper import Child\n"
                "def create_controller(config): return Child()\n"
            )
            controller = load_program_controller(root, {
                "id": "composed",
                "entry": "controller.py",
                "config": {},
            })
            controller.reset(3)
            np.testing.assert_allclose(controller.act({}, 0.5), [3.5])

    def test_self_righting_score_rewards_success_and_penalizes_slow_recovery(self):
        objective = {
            "weights": {
                "survival": 0, "velocityTracking": 0, "upright": 0, "energy": 0, "smoothness": 0,
                "componentMass": 0, "sensorChannels": 0, "trainingSteps": 0,
                "selfRighting": 100, "recoveryTime": 2, "jointLimitMargin": 1,
            },
        }
        base = {
            "survivalRate": 1, "meanVelocityTrackingError": 0, "forwardProgress": 1, "meanUpright": 0,
            "lateralDrift": 0, "meanEnergy": 0, "meanSmoothness": 0, "selfRightingSuccess": 1,
            "minimumJointLimitMarginRad": 0.1,
        }
        compiled = {"totalMassKg": 0, "sensorChannelCount": 0}
        fast = score_metrics({**base, "timeToStableStandSeconds": 1.5}, objective, compiled)["total"]
        slow = score_metrics({**base, "timeToStableStandSeconds": 4.0}, objective, compiled)["total"]
        failed = score_metrics({**base, "selfRightingSuccess": 0, "timeToStableStandSeconds": 6.0}, objective, compiled)["total"]
        self.assertGreater(fast, slow)
        self.assertGreater(slow, failed)

    def test_transition_controller_is_exact_for_an_unchanged_forward_command(self):
        baseline_root = PROJECT / "controllers" / "command-tracking-gait"; transition_root = PROJECT / "controllers" / "transition-aware-gait"
        baseline = load_program_controller(baseline_root, json.loads((baseline_root / "controller.json").read_text())); baseline.reset(7)
        transition = load_program_controller(transition_root, json.loads((transition_root / "controller.json").read_text())); transition.reset(7)
        observation = {
            "joint-position": np.linspace(-0.2, 0.2, 12), "joint-velocity": np.linspace(0.1, -0.1, 12),
            "base-velocity": np.array([0.2, 0.01, 0, 0, 0, 0]), "base-orientation": np.array([1.0, 0, 0, 0]),
            "imu-angular-velocity": np.zeros(3), "foot-contact-force": np.array([5, 10, 15, 20]),
            "actuator-delay-steps": np.array([2.0]), "motion-command": np.array([0.25, 0, 0]),
        }
        for time_seconds in [0.0, 0.02, 0.04]: np.testing.assert_array_equal(transition.act(observation, time_seconds), baseline.act(observation, time_seconds))

    def test_traction_controller_classifies_contact_loss_and_keeps_transition_yaw_damping_reachable(self):
        root = PROJECT / "controllers" / "traction-aware-gait"
        definition = json.loads((root / "controller.json").read_text())

        def observation(contact_force, command=(0.25, 0.0, 0.0), yaw_rate=0.0):
            return {
                "joint-position": np.linspace(-0.2, 0.2, 12), "joint-velocity": np.linspace(0.1, -0.1, 12),
                "base-velocity": np.array([0.1, 0.0, 0.0, 0.0, 0.0, yaw_rate]), "base-orientation": np.array([1.0, 0.0, 0.0, 0.0]),
                "imu-angular-velocity": np.zeros(3), "foot-contact-force": np.asarray(contact_force, dtype=np.float64),
                "actuator-delay-steps": np.array([3.0]), "motion-command": np.asarray(command, dtype=np.float64),
            }

        normal = load_program_controller(root, definition); normal.reset(7)
        slipping = load_program_controller(root, definition); slipping.reset(7)
        for controller in (normal, slipping):
            controller.act(observation(np.zeros(4)), 0.0)
            controller.act(observation(np.full(4, 12.0)), 0.02)
        normal.act(observation(np.full(4, 5.0)), 0.04)
        slipping.act(observation(np.zeros(4)), 0.04)
        self.assertTrue(normal.traction_classification_complete); self.assertFalse(normal.traction_recovery)
        self.assertTrue(slipping.traction_classification_complete); self.assertTrue(slipping.traction_recovery)
        self.assertEqual(normal.traction_control_blend, 1.0)
        self.assertEqual(slipping.traction_control_blend, 1.0)

        def transition_action(yaw_rate):
            controller = load_program_controller(root, definition); controller.reset(7)
            controller.act(observation(np.zeros(4)), 0.0)
            controller.act(observation(np.full(4, 12.0)), 0.02)
            controller.act(observation(np.zeros(4)), 0.04)
            action = controller.act(observation(np.zeros(4), (-0.15, 0.0, 0.0), yaw_rate), 0.06)
            self.assertAlmostEqual(controller.traction_transition_started_at, 0.06)
            return action

        self.assertFalse(np.allclose(transition_action(0.0), transition_action(0.2)))

    def test_bounded_traction_controller_latches_severity_from_deployable_pitch(self):
        root = PROJECT / "controllers" / "bounded-traction-gait"
        definition = json.loads((root / "controller.json").read_text())

        def observation(forward_velocity, pitch=0.0):
            return {
                "joint-position": np.linspace(-0.2, 0.2, 12), "joint-velocity": np.linspace(0.1, -0.1, 12),
                "base-velocity": np.array([forward_velocity, 0.0, 0.0, 0.0, 0.0, 0.0]),
                "base-orientation": np.array([np.cos(pitch / 2), 0.0, np.sin(pitch / 2), 0.0]),
                "imu-angular-velocity": np.zeros(3), "foot-contact-force": np.full(4, 5.0),
                "actuator-delay-steps": np.array([0.0]), "motion-command": np.array([0.25, 0.0, 0.0]),
            }

        mild = load_program_controller(root, definition); mild.reset(7)
        mild.act(observation(0.1), 0.0); mild.act(observation(0.1), 1.3)
        self.assertTrue(mild.traction_recovery); self.assertFalse(mild.traction_recovery_severe)
        mild.act(observation(0.1, -0.21), 1.32)
        self.assertTrue(mild.traction_recovery_severe)

        self.assertLess(definition["config"]["tractionRecoverySevereHipScale"], definition["config"]["tractionRecoveryHipScale"])

    def test_motion_command_is_explicit_controller_input_and_tracks_yaw_not_height(self):
        model, compiled = compiled_assembly("command-conditioned-history-3dof")
        task = {**json.loads((PROJECT / "tasks" / "stand.task.json").read_text()), "motionCommand": {"frame": "world", "linearVelocityMps": [0.1, -0.2], "yawRateRadPerSec": 0.3}}
        scenario = json.loads((PROJECT / "scenarios" / "nominal.scenario.json").read_text())
        environment = RobotEnvironment(model, compiled, task, scenario, 7)
        observation = environment.reset()
        np.testing.assert_allclose(observation["motion-command"], np.array([0.1, -0.2, 0.3]))
        environment.data.qvel[0] = 0.1; environment.data.qvel[1] = -0.2; environment.data.qvel[2] = 9.0; environment.data.qvel[5] = 0.3
        result = environment.step(np.zeros(environment.model.nu))
        self.assertLess(result.info["velocityError"], 0.1)
        self.assertLess(result.info["yawRateError"], 0.1)

    def test_command_channel_does_not_shift_existing_observation_noise(self):
        legacy_model, legacy_compiled = compiled_assembly("force-sensing-history-3dof")
        command_model, command_compiled = compiled_assembly("command-conditioned-history-3dof")
        task = json.loads((PROJECT / "tasks" / "forward-walk.task.json").read_text())
        scenario = {**json.loads((PROJECT / "scenarios" / "nominal.scenario.json").read_text()), "observationNoiseStd": 0.01}
        legacy = RobotEnvironment(legacy_model, legacy_compiled, task, scenario, 19); command = RobotEnvironment(command_model, command_compiled, task, scenario, 19)
        legacy_observation = legacy.reset(); command_observation = command.reset()
        for name, values in legacy_observation.items(): np.testing.assert_allclose(command_observation[name], values)
        np.testing.assert_allclose(command_observation["motion-command"], np.array([0.25, 0.0, 0.0]))

    def test_seeded_reset_perturbations_are_reproducible_and_distinct(self):
        model, compiled = compiled_assembly("baseline")
        task = json.loads((PROJECT / "tasks" / "stand.task.json").read_text())
        scenario = {**json.loads((PROJECT / "scenarios" / "nominal.scenario.json").read_text()), "initialJointPositionNoiseStd": 0.02, "initialJointVelocityNoiseStd": 0.05}
        first = RobotEnvironment(model, compiled, task, scenario, 7); first.reset()
        same = RobotEnvironment(model, compiled, task, scenario, 7); same.reset()
        other = RobotEnvironment(model, compiled, task, scenario, 8); other.reset()
        np.testing.assert_allclose(first.data.qpos, same.data.qpos)
        np.testing.assert_allclose(first.data.qvel, same.data.qvel)
        self.assertFalse(np.allclose(first.data.qpos, other.data.qpos))

    def test_residual_policy_transform_preserves_force_aware_pd_prior(self):
        observation = {
            "joint-position": np.array([0.28, -0.50] * 4),
            "joint-velocity": np.zeros(8),
            "foot-contact-force": np.zeros(4),
            "imu-angular-velocity": np.zeros(3),
        }
        transform = {"kind": "force-aware-pd-residual", "target": [0.29, -0.47] * 4, "kp": 32.0, "kd": 1.4, "contactGain": 0.02, "rollGain": 0.02, "residualScale": 0.5}
        prior = transform_policy_action(np.zeros(8), observation, transform)
        with_residual = transform_policy_action(np.ones(8), observation, transform)
        np.testing.assert_allclose(prior, np.array([0.32, 0.96] * 4), atol=1e-9)
        np.testing.assert_allclose(with_residual - prior, np.full(8, 0.5), atol=1e-9)

    def test_periodic_residual_prior_advances_with_simulation_time(self):
        observation = {
            "joint-position": np.array([0.29, -0.47] * 4), "joint-velocity": np.zeros(8),
            "foot-contact-force": np.zeros(4), "imu-angular-velocity": np.zeros(3),
        }
        transform = {
            "kind": "force-aware-gait-residual", "frequencyHz": 1.0, "neutralHip": 0.29, "neutralKnee": -0.47,
            "hipAmplitude": 0.25, "kneeAmplitude": 0.04, "leftRightPhase": 0.0, "frontRearPhase": np.pi,
            "kp": 32.0, "kd": 2.0, "contactGain": 0.02, "rollGain": 0.02, "residualScale": 0.5,
        }
        start = transform_policy_action(np.zeros(8), observation, transform, 0.0)
        quarter = transform_policy_action(np.zeros(8), observation, transform, 0.25)
        np.testing.assert_allclose(start, np.zeros(8), atol=1e-9)
        np.testing.assert_allclose(quarter[[0, 2]], np.full(2, 8.0), atol=1e-9)
        np.testing.assert_allclose(quarter[[4, 6]], np.full(2, -8.0), atol=1e-9)

    def test_spatial_residual_prior_matches_promoted_program_controller(self):
        root = PROJECT / "controllers" / "spatial-forward-gait"
        definition = json.loads((root / "controller.json").read_text())
        controller = load_program_controller(root, definition); controller.reset(7)
        config = definition["config"]
        observation = {
            "joint-position": np.array([0.1, 0.2, -0.3] * 4),
            "joint-velocity": np.linspace(-0.2, 0.2, 12),
            "foot-contact-force": np.array([0.0, 10.0, 20.0, 30.0]),
            "base-orientation": np.array([0.9998, 0.02, 0.0, 0.0]),
            "imu-angular-velocity": np.array([0.1, 0.0, 0.0]),
        }
        transform = {"kind": "spatial-gait-residual", **config, "orientationChannel": "base-orientation", "residualScale": 0.5}
        prior = transform_policy_action(np.zeros(12), observation, transform, 0.37)
        expected = controller.act(observation, 0.37)
        np.testing.assert_allclose(np.clip(prior, -8, 8), expected, atol=1e-9)
        np.testing.assert_allclose(transform_policy_action(np.ones(12), observation, transform, 0.37) - prior, np.full(12, 0.5), atol=1e-9)

    def test_spatial_prior_selects_phase_lead_from_calibrated_actuator_delay(self):
        observation = {
            "joint-position": np.zeros(12), "joint-velocity": np.zeros(12), "foot-contact-force": np.zeros(4),
            "base-orientation": np.array([1.0, 0.0, 0.0, 0.0]), "imu-angular-velocity": np.zeros(3), "actuator-delay-steps": np.array([3.0]),
        }
        common = {"kind": "spatial-gait-residual", "frequencyHz": 1.0, "phaseLeadSeconds": 0.12, "statePredictionSeconds": 0.02, "neutralAbduction": 0.2, "neutralHip": 0.34, "neutralKnee": -0.37, "hipAmplitude": 0.16, "kneeAmplitude": 0.05, "frontRearPhase": np.pi, "kpAbduction": 17.0, "kdAbduction": 3.3, "kpSagittal": 30.5, "kdSagittal": 2.2, "contactGain": 0.02, "rollPositionGain": 0.27, "rollRateGain": 0.13}
        calibrated = transform_policy_action(np.zeros(12), observation, {**common, "delayChannel": "actuator-delay-steps", "phaseLeadByDelaySteps": [0.12, 0.0075, 0.02, 0.225]}, 0.1)
        explicit = transform_policy_action(np.zeros(12), observation, {**common, "phaseLeadSeconds": 0.225}, 0.1)
        np.testing.assert_allclose(calibrated, explicit, atol=1e-9)

    def test_force_component_is_visible_in_observation(self):
        model, compiled = compiled_assembly("force-sensing")
        task = json.loads((PROJECT / "tasks" / "stand.task.json").read_text())
        scenario = json.loads((PROJECT / "scenarios" / "nominal.scenario.json").read_text())
        environment = RobotEnvironment(model, compiled, task, scenario, 42)
        observation = environment.reset()
        self.assertEqual(environment.vector(observation).shape, (37,))
        self.assertEqual(observation["foot-contact-force"].shape, (4,))
        self.assertEqual(environment.foot_positions_world().shape, (4, 3))
        self.assertEqual(environment.foot_contact_forces().shape, (4,))
        result = environment.step(np.zeros(environment.model.nu))
        self.assertTrue(result.info["motionQuality"]["footEvidenceAvailable"])

    def test_hexapod_contact_evidence_uses_all_six_compiled_points(self):
        model, compiled = compiled_assembly("hexapod", HEXAPOD)
        task = json.loads((HEXAPOD / "tasks" / "forward-walk.task.json").read_text())
        scenario = json.loads((HEXAPOD / "scenarios" / "nominal.scenario.json").read_text())
        environment = RobotEnvironment(model, compiled, task, scenario, 601)
        observation = environment.reset()
        self.assertEqual(compiled["morphology"]["limbCount"], 6)
        self.assertEqual(len(compiled["morphology"]["contactPoints"]), 6)
        self.assertEqual(observation["foot-contact-force"].shape, (6,))
        self.assertEqual(environment.foot_positions_world().shape, (6, 3))
        self.assertEqual(environment.foot_contact_forces().shape, (6,))
        self.assertTrue(environment.step(np.zeros(environment.model.nu)).info["motionQuality"]["footEvidenceAvailable"])

    def test_actuator_telemetry_exposes_commanded_and_delayed_actions(self):
        model, compiled = compiled_assembly("force-sensing-telemetry-3dof")
        task = json.loads((PROJECT / "tasks" / "forward-walk.task.json").read_text())
        scenario = json.loads((PROJECT / "scenarios" / "actuator-delay.scenario.json").read_text())
        environment = RobotEnvironment(model, compiled, task, scenario, 42); observation = environment.reset()
        self.assertEqual(environment.vector(observation).shape, (69,))
        command = np.linspace(-1, 1, 12); result = environment.step(command)
        np.testing.assert_allclose(result.observation["last-commanded-action"], command)
        np.testing.assert_allclose(result.observation["last-applied-action"], np.zeros(12))

    def test_actuator_history_is_oldest_to_newest_and_covers_delay_queue(self):
        model, compiled = compiled_assembly("force-sensing-history-3dof")
        task = json.loads((PROJECT / "tasks" / "forward-walk.task.json").read_text())
        scenario = json.loads((PROJECT / "scenarios" / "actuator-delay.scenario.json").read_text())
        environment = RobotEnvironment(model, compiled, task, scenario, 42); observation = environment.reset()
        self.assertEqual(environment.vector(observation).shape, (142,))
        np.testing.assert_allclose(observation["actuator-delay-steps"], np.array([2.0]))
        first = np.linspace(-1, 1, 12); observation = environment.step(first).observation
        np.testing.assert_allclose(observation["command-action-history"][-12:], first)
        np.testing.assert_allclose(observation["applied-action-history"], np.zeros(48))
        second = first * 2; observation = environment.step(second).observation
        np.testing.assert_allclose(observation["command-action-history"][-24:], np.concatenate([first, second]))

    def test_host_rejects_wrong_action_shape(self):
        model, compiled = compiled_assembly("baseline")
        task = json.loads((PROJECT / "tasks" / "stand.task.json").read_text())
        scenario = json.loads((PROJECT / "scenarios" / "nominal.scenario.json").read_text())
        environment = RobotEnvironment(model, compiled, task, scenario, 42)
        environment.reset()
        with self.assertRaisesRegex(RuntimeError, "expected 8 values"):
            environment.step(np.zeros(7))

    def test_hardware_capture_state_gate_rejects_tilt_height_and_joint_speed(self):
        model, _ = compiled_assembly("force-sensing-3dof")
        mujoco_model = mujoco.MjModel.from_xml_path(str(model))
        data = mujoco.MjData(mujoco_model)
        mujoco.mj_resetDataKeyframe(mujoco_model, data, 0)
        safety = {"maximumJointVelocityRadPerSec": 5.0, "minimumBaseHeightM": 0.2, "maximumBaseHeightM": 0.8, "maximumBodyTiltRad": 0.5}
        self.assertEqual(_state_safety_reasons(mujoco_model, data.qpos.copy(), data.qvel.copy(), safety), [])
        data.qvel[6] = 6.0
        data.qpos[2] = 0.1
        data.qpos[3:7] = np.array([np.cos(0.3), np.sin(0.3), 0.0, 0.0])
        reasons = _state_safety_reasons(mujoco_model, data.qpos, data.qvel, safety)
        self.assertTrue(any("joint velocity" in reason for reason in reasons))
        self.assertTrue(any("base height" in reason for reason in reasons))
        self.assertTrue(any("body tilt" in reason for reason in reasons))

    def test_hardware_capture_freshness_and_stop_acknowledgement_are_fail_closed(self):
        self.assertIsNone(_state_age_reason(None, None))
        self.assertEqual(_state_age_reason(None, 20.0), "state age telemetry is missing")
        self.assertIsNone(_state_age_reason(20.0, 20.0))
        self.assertIn("20.100000 ms exceeds maximum 20.000000 ms", _state_age_reason(20.1, 20.0))
        stopped = {"type": "stopped", "episode": "fit-a", "kind": "emergency-stop"}
        self.assertTrue(_stopped_acknowledged(stopped, "fit-a", "emergency-stop"))
        self.assertFalse(_stopped_acknowledged({**stopped, "kind": "safe-stop"}, "fit-a", "emergency-stop"))
        self.assertFalse(_stopped_acknowledged({**stopped, "episode": "fit-b"}, "fit-a", "emergency-stop"))
        rejected = {"type": "deadline-rejected", "episode": "fit-a", "step": 0, "observedDecisionLatencyMs": 20.1}
        self.assertEqual(_driver_deadline_rejection(rejected, "fit-a", 0), 20.1)
        self.assertIsNone(_driver_deadline_rejection({"type": "state"}, "fit-a", 0))
        with self.assertRaisesRegex(RuntimeError, "does not match"):
            _driver_deadline_rejection(rejected, "fit-a", 1)
        with self.assertRaisesRegex(RuntimeError, "finite nonnegative"):
            _driver_deadline_rejection({**rejected, "observedDecisionLatencyMs": float("nan")}, "fit-a", 0)

    def test_driver_command_lease_expiration_is_bounded_and_applies_emergency_action(self):
        health = {
            "motorTemperatureC": [40.0, 40.0],
            "motorCurrentA": [0.0, 0.0],
            "actuatorStates": ["ready", "ready"],
            "busVoltageV": 24.0,
            "faults": [],
            "estopEngaged": False,
            "watchdogHealthy": True,
        }
        expiration = {
            "type": "lease-expired",
            "episode": "host-loss",
            "lastAcceptedStep": 0,
            "commandLeaseMs": 100,
            "observedSilenceMs": 105.0,
            "stopLatched": True,
            "appliedAction": [0.0, 0.0],
            "deviceHealth": health,
        }
        parsed = _command_lease_expiration(expiration, "host-loss", 0, 100, 25.0, 2, np.zeros(2))
        self.assertEqual(parsed["lastAcceptedStep"], 0)
        self.assertEqual(parsed["appliedAction"], [0.0, 0.0])
        with self.assertRaisesRegex(RuntimeError, "before the frozen lease"):
            _command_lease_expiration({**expiration, "observedSilenceMs": 99.9}, "host-loss", 0, 100, 25.0, 2, np.zeros(2))
        with self.assertRaisesRegex(RuntimeError, "overrun bound"):
            _command_lease_expiration({**expiration, "observedSilenceMs": 125.1}, "host-loss", 0, 100, 25.0, 2, np.zeros(2))
        with self.assertRaisesRegex(RuntimeError, "emergency-stop Action"):
            _command_lease_expiration({**expiration, "appliedAction": [0.1, 0.0]}, "host-loss", 0, 100, 25.0, 2, np.zeros(2))

    def test_protocol_driver_rejects_control_after_autonomous_lease_stop(self):
        capture_plan = json.loads((PROJECT / "capture-plans" / "quadruped-host-loss-trip.capture.json").read_text())
        bundle_root = PROJECT / "hardware-bundles" / capture_plan["bundle"]
        bundle = json.loads((bundle_root / "manifest.json").read_text())
        action_size = int(json.loads((bundle_root / "action-contract.json").read_text())["size"])
        target = bundle["target"]
        driver = PROJECT / "hardware-drivers" / "mujoco-protocol-simulator" / "driver.py"
        scenario = PROJECT / "scenarios" / "hardware-capture-hidden-plant.scenario.json"
        process = subprocess.Popen(
            [str(driver), "--scenario", str(scenario)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            env={**os.environ, "MUJICA_HARDWARE_BUNDLE": str(bundle_root)},
        )
        self.assertIsNotNone(process.stdin)
        self.assertIsNotNone(process.stdout)

        def exchange(message):
            process.stdin.write(json.dumps(message, separators=(",", ":")) + "\n")
            process.stdin.flush()
            return json.loads(process.stdout.readline())

        try:
            hello = exchange({
                "type": "hello",
                "protocol": "stdio-jsonl-v1",
                "version": 1,
                "bundleHash": bundle["bundleHash"],
                "observationContractHash": bundle["observationContractHash"],
                "actionContractHash": bundle["actionContractHash"],
                "driverHash": bundle["driverExecutableHash"],
                "environment": target["environment"],
                "commandLeaseMs": target["safety"]["commandLeaseMs"],
            })
            self.assertIn("command-lease", hello["capabilities"])
            initial = exchange({
                "type": "start-episode",
                "episode": "direct-host-loss",
                "seed": 91,
                "steps": 2,
                "controlHz": target["controlHz"],
                "commandLeaseMs": target["safety"]["commandLeaseMs"],
            })
            self.assertEqual(initial["step"], 0)
            expired = json.loads(process.stdout.readline())
            self.assertEqual(expired["type"], "lease-expired")
            self.assertTrue(expired["stopLatched"])
            rejected = exchange({
                "type": "action",
                "episode": "direct-host-loss",
                "step": 0,
                "commandLeaseMs": target["safety"]["commandLeaseMs"],
                "action": [0.0] * action_size,
            })
            self.assertEqual(rejected["type"], "control-rejected")
            self.assertEqual(rejected["reason"], "stop-latched")
            health = exchange({"type": "health-check", "episode": "direct-host-loss", "sequence": 0})
            self.assertTrue(health["stopLatched"])
            self.assertEqual(exchange({"type": "close"})["type"], "completed")
            self.assertEqual(process.wait(timeout=2), 0)
        finally:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=2)
            for stream in (process.stdin, process.stdout, process.stderr):
                if stream is not None:
                    stream.close()

    def test_hardware_capture_device_health_is_typed_and_fail_closed(self):
        healthy = {
            "motorTemperatureC": [40.0, 41.0],
            "motorCurrentA": [1.0, -2.0],
            "actuatorStates": ["ready", "ready"],
            "busVoltageV": 24.0,
            "faults": [],
            "estopEngaged": False,
            "watchdogHealthy": True,
        }
        parsed = _device_health(healthy, 2, "episode", 0, True)
        safety = {
            "requireDeviceHealth": True,
            "maximumMotorTemperatureC": 80,
            "maximumMotorCurrentA": 20,
            "minimumBusVoltageV": 20,
            "maximumBusVoltageV": 30,
        }
        self.assertEqual(_device_health_reasons(parsed, safety), [])
        unsafe = {
            **healthy,
            "motorTemperatureC": [81.0, 40.0],
            "motorCurrentA": [21.0, 0.0],
            "busVoltageV": 19.0,
            "faults": ["drive.overtemp"],
            "estopEngaged": True,
            "watchdogHealthy": False,
        }
        reasons = _device_health_reasons(_device_health(unsafe, 2, "episode", 0, True), safety)
        self.assertTrue(any("motor temperature" in reason for reason in reasons))
        self.assertTrue(any("motor current" in reason for reason in reasons))
        self.assertTrue(any("bus voltage" in reason for reason in reasons))
        self.assertTrue(any("drive.overtemp" in reason for reason in reasons))
        self.assertIn("physical E-stop is engaged", reasons)
        self.assertIn("driver watchdog is unhealthy", reasons)
        isolated = _device_health({**healthy, "actuatorStates": ["ready", "faulted"]}, 2, "episode", 0, True)
        self.assertEqual(_device_health_assessment(isolated, safety), {
            "reasons": ["actuator states are unsafe: 1:faulted"],
            "affectedActuatorIndices": [1],
            "scope": "actuator",
        })
        with self.assertRaisesRegex(RuntimeError, "lacks required"):
            _device_health(None, 2, "episode", 0, True)
        with self.assertRaisesRegex(RuntimeError, "safe nonempty codes"):
            _device_health({**healthy, "faults": ["bad fault\n"]}, 2, "episode", 0, True)
        with self.assertRaisesRegex(RuntimeError, "actuatorStates"):
            _device_health({**healthy, "actuatorStates": ["ready", "unknown"]}, 2, "episode", 0, True)

    def test_training_reward_exposes_benchmark_aligned_lateral_displacement(self):
        model, compiled = compiled_assembly("force-sensing-3dof")
        task = json.loads((PROJECT / "tasks" / "forward-walk.task.json").read_text())
        scenario = json.loads((PROJECT / "scenarios" / "nominal.scenario.json").read_text())
        environment = RobotEnvironment(model, compiled, task, scenario, 42); environment.reset()
        environment.data.qpos[1] += 0.1
        result = environment.step(np.zeros(12))
        self.assertGreater(result.info["lateralDisplacement"], 0.09)

    def test_ppo_performs_a_real_small_training_run(self):
        model, compiled = compiled_assembly("baseline")
        request = {
            "modelPath": str(model),
            "compiled": compiled,
            "task": json.loads((PROJECT / "tasks" / "velocity-track.task.json").read_text()),
            "scenarios": [json.loads((PROJECT / "scenarios" / "nominal.scenario.json").read_text())],
            "seed": 7,
            "training": {
                "totalSteps": 64,
                "rolloutSteps": 32,
                "epochs": 1,
                "minibatchSize": 16,
                "learningRate": 0.0003,
                "gamma": 0.99,
                "gaeLambda": 0.95,
                "clipRatio": 0.2,
                "entropyCoefficient": 0.01,
            },
        }
        with tempfile.TemporaryDirectory() as directory:
            result = PPOTrainer(hidden_sizes=[16]).train(request, Path(directory))
            self.assertEqual(result["totalSteps"], 64)
            self.assertEqual(result["updates"], 2)
            self.assertTrue((Path(directory) / "model.pt").exists())
            metrics = json.loads((Path(directory) / "training-metrics.json").read_text())
            self.assertEqual(metrics["totalSteps"], 64)


if __name__ == "__main__":
    unittest.main()
