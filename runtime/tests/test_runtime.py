from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from mujica_runtime.controllers import load_program_controller, transform_policy_action
from mujica_runtime.environment import RobotEnvironment
from mujica_runtime.simulation import episode_survival_rate, motion_metrics, score_metrics
from mujica_runtime.training import PPOTrainer, effective_action_transform


ROOT = Path(__file__).resolve().parents[2]
PROJECT = ROOT / "examples" / "quadruped"


def compiled_assembly(assembly_id: str) -> tuple[Path, dict]:
    for manifest_path in (PROJECT / ".mujica" / "cache" / "assemblies").glob("*/compiled-assembly.json"):
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
    def test_training_residual_scale_is_frozen_into_the_effective_transform(self):
        base = {"kind": "spatial-gait-residual", "residualScale": 1.0}
        effective = effective_action_transform(base, {"residualScale": 0.25})
        self.assertEqual(effective["residualScale"], 0.25)
        self.assertEqual(base["residualScale"], 1.0)
        with self.assertRaisesRegex(RuntimeError, "requires a Trainer action transform"):
            effective_action_transform(None, {"residualScale": 0.25})
    def test_survival_is_measured_against_the_requested_episode(self):
        self.assertAlmostEqual(episode_survival_rate(56, 250), 0.224)
        self.assertAlmostEqual(episode_survival_rate(250, 250), 1.0)

    def test_locomotion_score_requires_net_forward_progress(self):
        task = {"targetVelocity": [0.2, 0.0, 0.0], "durationSeconds": 3.0}
        stationary = motion_metrics(np.zeros(3), np.array([0.03, 0.0, 0.0]), 0.1, task, 3.0)
        walking = motion_metrics(np.zeros(3), np.array([0.6, 0.02, 0.0]), 0.65, task, 3.0)
        self.assertAlmostEqual(stationary["forwardProgress"], 0.05)
        self.assertAlmostEqual(walking["forwardProgress"], 1.0)
        self.assertAlmostEqual(walking["lateralDrift"], 0.02)
        objective = {"weights": {"survival": 0, "velocityTracking": 0, "forwardProgress": 35, "upright": 0, "lateralDrift": 5, "energy": 0, "smoothness": 0, "componentMass": 0, "sensorChannels": 0, "trainingSteps": 0}}
        base = {"survivalRate": 1, "meanVelocityTrackingError": 0, "meanUpright": 1, "meanEnergy": 0, "meanSmoothness": 0}
        compiled = {"totalMassKg": 0, "sensorChannelCount": 0}
        stationary_score = score_metrics({**base, **stationary}, objective, compiled)["total"]
        walking_score = score_metrics({**base, **walking}, objective, compiled)["total"]
        self.assertGreater(walking_score - stationary_score, 30)

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

    def test_force_component_is_visible_in_observation(self):
        model, compiled = compiled_assembly("force-sensing")
        task = json.loads((PROJECT / "tasks" / "stand.task.json").read_text())
        scenario = json.loads((PROJECT / "scenarios" / "nominal.scenario.json").read_text())
        environment = RobotEnvironment(model, compiled, task, scenario, 42)
        observation = environment.reset()
        self.assertEqual(environment.vector(observation).shape, (37,))
        self.assertEqual(observation["foot-contact-force"].shape, (4,))

    def test_actuator_telemetry_exposes_commanded_and_delayed_actions(self):
        model, compiled = compiled_assembly("force-sensing-telemetry-3dof")
        task = json.loads((PROJECT / "tasks" / "forward-walk.task.json").read_text())
        scenario = json.loads((PROJECT / "scenarios" / "actuator-delay.scenario.json").read_text())
        environment = RobotEnvironment(model, compiled, task, scenario, 42); observation = environment.reset()
        self.assertEqual(environment.vector(observation).shape, (69,))
        command = np.linspace(-1, 1, 12); result = environment.step(command)
        np.testing.assert_allclose(result.observation["last-commanded-action"], command)
        np.testing.assert_allclose(result.observation["last-applied-action"], np.zeros(12))

    def test_host_rejects_wrong_action_shape(self):
        model, compiled = compiled_assembly("baseline")
        task = json.loads((PROJECT / "tasks" / "stand.task.json").read_text())
        scenario = json.loads((PROJECT / "scenarios" / "nominal.scenario.json").read_text())
        environment = RobotEnvironment(model, compiled, task, scenario, 42)
        environment.reset()
        with self.assertRaisesRegex(RuntimeError, "expected 8 values"):
            environment.step(np.zeros(7))

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
