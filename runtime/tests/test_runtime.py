from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from mujica_runtime.controllers import transform_policy_action
from mujica_runtime.environment import RobotEnvironment
from mujica_runtime.training import PPOTrainer


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

    def test_force_component_is_visible_in_observation(self):
        model, compiled = compiled_assembly("force-sensing")
        task = json.loads((PROJECT / "tasks" / "stand.task.json").read_text())
        scenario = json.loads((PROJECT / "scenarios" / "nominal.scenario.json").read_text())
        environment = RobotEnvironment(model, compiled, task, scenario, 42)
        observation = environment.reset()
        self.assertEqual(environment.vector(observation).shape, (37,))
        self.assertEqual(observation["foot-contact-force"].shape, (4,))

    def test_host_rejects_wrong_action_shape(self):
        model, compiled = compiled_assembly("baseline")
        task = json.loads((PROJECT / "tasks" / "stand.task.json").read_text())
        scenario = json.loads((PROJECT / "scenarios" / "nominal.scenario.json").read_text())
        environment = RobotEnvironment(model, compiled, task, scenario, 42)
        environment.reset()
        with self.assertRaisesRegex(RuntimeError, "expected 8 values"):
            environment.step(np.zeros(7))

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
