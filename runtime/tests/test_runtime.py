from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
import torch

from mujica_runtime.controllers import create_policy_network, load_program_controller, transform_policy_action
from mujica_runtime.environment import RobotEnvironment, compile_motion_command_schedule
from mujica_runtime.io import hash_directory
from mujica_runtime.simulation import episode_survival_rate, motion_metrics, quaternion_body_tilt, quaternion_pitch, score_metrics, transition_response_metrics
from mujica_runtime.training import PPOTrainer, effective_action_transform


ROOT = Path(__file__).resolve().parents[2]
PROJECT = ROOT / "examples" / "quadruped"


def compiled_assembly(assembly_id: str) -> tuple[Path, dict]:
    manifests = sorted((PROJECT / ".mujica" / "cache" / "assemblies").glob("*/compiled-assembly.json"), key=lambda path: path.stat().st_mtime_ns, reverse=True)
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
    def test_program_prior_policy_freezes_the_exact_controller_source(self):
        policy_root = PROJECT / "policies" / "upright-residual-locomotion-1d4c901d04ccfabb"
        architecture = json.loads((policy_root / "architecture.json").read_text())
        transform = architecture["actionTransform"]
        self.assertEqual(transform["kind"], "program-controller-residual")
        self.assertEqual(transform["controllerId"], "upright-traction-gait")
        self.assertEqual(hash_directory(policy_root / "prior"), transform["controllerHash"])
        prior = json.loads((policy_root / "prior" / "controller.json").read_text())
        self.assertEqual(prior["id"], transform["controllerId"])

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
    def test_survival_is_measured_against_the_requested_episode(self):
        self.assertAlmostEqual(episode_survival_rate(56, 250), 0.224)
        self.assertAlmostEqual(episode_survival_rate(250, 250), 1.0)

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
