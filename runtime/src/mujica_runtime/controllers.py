from __future__ import annotations

import importlib.util
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

import numpy as np
import torch


class Controller(Protocol):
    def reset(self, seed: int) -> None: ...
    def act(self, observation: dict[str, np.ndarray], time_seconds: float) -> np.ndarray: ...


def load_python_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load Python module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_program_controller(root: Path, definition: dict[str, Any]) -> Controller:
    entry = (root / definition["entry"]).resolve()
    if root.resolve() not in entry.parents:
        raise RuntimeError("Controller entry escapes package")
    module = load_python_module(entry, f"mujica_controller_{definition['id'].replace('-', '_')}")
    controller = module.create_controller(dict(definition.get("config", {})))
    if not hasattr(controller, "reset") or not hasattr(controller, "act"):
        raise RuntimeError("Program controller must provide reset(seed) and act(observation, time_seconds)")
    return controller


class PolicyNetwork(torch.nn.Module):
    def __init__(self, observation_size: int, action_size: int, hidden_sizes: list[int]):
        super().__init__()
        layers: list[torch.nn.Module] = []
        size = observation_size
        for hidden in hidden_sizes:
            layers.extend([torch.nn.Linear(size, hidden), torch.nn.Tanh()])
            size = hidden
        self.body = torch.nn.Sequential(*layers)
        self.actor = torch.nn.Linear(size, action_size)
        self.critic = torch.nn.Linear(size, 1)
        self.log_std = torch.nn.Parameter(torch.full((action_size,), -0.5))

    def forward(self, observation: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        latent = self.body(observation)
        return self.actor(latent), self.critic(latent).squeeze(-1), self.log_std.expand(observation.shape[:-1] + self.log_std.shape)


def transform_policy_action(raw_action: np.ndarray, observation: dict[str, np.ndarray], transform: dict[str, Any] | None, time_seconds: float = 0.0) -> np.ndarray:
    if not transform or transform.get("kind") == "identity":
        return raw_action
    if transform.get("kind") not in {"force-aware-pd-residual", "force-aware-gait-residual", "spatial-gait-residual"}:
        raise RuntimeError(f"Unsupported policy action transform '{transform.get('kind')}'")
    joint_position = observation[str(transform.get("jointPositionChannel", "joint-position"))]
    joint_velocity = observation[str(transform.get("jointVelocityChannel", "joint-velocity"))]
    contacts = np.tanh(observation[str(transform.get("contactChannel", "foot-contact-force"))] / float(transform.get("contactScale", 20.0)))
    if transform["kind"] == "spatial-gait-residual":
        joint_position = joint_position.reshape(4, 3)
        joint_velocity = joint_velocity.reshape(4, 3)
        prediction = float(transform["statePredictionSeconds"])
        phase = 2.0 * np.pi * float(transform["frequencyHz"]) * (time_seconds + float(transform["phaseLeadSeconds"]))
        offsets = np.array([0.0, 0.0, float(transform.get("frontRearPhase", np.pi)), float(transform.get("frontRearPhase", np.pi))])
        side = np.array([1.0, -1.0, 1.0, -1.0])
        quaternion = observation[str(transform.get("orientationChannel", "base-orientation"))]
        w, x, y, z = quaternion
        roll = float(np.arctan2(2.0 * (w * x + y * z), 1.0 - 2.0 * (x * x + y * y)))
        roll_rate = float(observation[str(transform.get("angularVelocityChannel", "imu-angular-velocity"))][0])
        correction = np.clip(float(transform["rollPositionGain"]) * (roll + prediction * roll_rate) + float(transform["rollRateGain"]) * roll_rate, -0.16, 0.16)
        target = np.empty((4, 3), dtype=np.float64)
        for leg in range(4):
            wave = np.sin(phase + offsets[leg])
            target[leg, 0] = side[leg] * float(transform["neutralAbduction"]) - correction
            target[leg, 1] = float(transform["neutralHip"]) + float(transform["hipAmplitude"]) * wave
            target[leg, 2] = float(transform["neutralKnee"]) - float(transform["kneeAmplitude"]) * max(0.0, wave) - float(transform.get("contactGain", 0.0)) * contacts[leg]
        predicted = joint_position + prediction * joint_velocity
        prior = np.empty((4, 3), dtype=np.float64)
        prior[:, 0] = float(transform["kpAbduction"]) * (target[:, 0] - predicted[:, 0]) - float(transform["kdAbduction"]) * joint_velocity[:, 0]
        prior[:, 1:] = float(transform["kpSagittal"]) * (target[:, 1:] - predicted[:, 1:]) - float(transform["kdSagittal"]) * joint_velocity[:, 1:]
        return prior.reshape(-1) + float(transform.get("residualScale", 1.0)) * raw_action
    if transform["kind"] == "force-aware-gait-residual":
        phase = 2.0 * np.pi * float(transform["frequencyHz"]) * time_seconds
        left_right = float(transform.get("leftRightPhase", 0.0))
        front_rear = float(transform.get("frontRearPhase", np.pi))
        offsets = np.array([0.0, left_right, front_rear, front_rear + left_right])
        target = np.empty(8, dtype=np.float64)
        for leg in range(4):
            wave = np.sin(phase + offsets[leg])
            target[2 * leg] = float(transform["neutralHip"]) + float(transform["hipAmplitude"]) * wave
            target[2 * leg + 1] = float(transform["neutralKnee"]) - float(transform["kneeAmplitude"]) * max(0.0, wave)
    else:
        target = np.asarray(transform["target"], dtype=np.float64).copy()
    contact_gain = float(transform.get("contactGain", 0.0))
    target[1::2] -= contact_gain * contacts
    roll_rate = float(observation[str(transform.get("angularVelocityChannel", "imu-angular-velocity"))][0])
    roll_correction = np.clip(float(transform.get("rollGain", 0.0)) * roll_rate, -0.08, 0.08)
    target[[1, 5]] += roll_correction; target[[3, 7]] -= roll_correction
    prior = float(transform["kp"]) * (target - joint_position) - float(transform["kd"]) * joint_velocity
    return prior + float(transform.get("residualScale", 1.0)) * raw_action


@dataclass
class FrozenPolicyController:
    network: PolicyNetwork
    observation_channels: list[dict[str, Any]]
    mean: np.ndarray
    variance: np.ndarray
    action_low: np.ndarray
    action_high: np.ndarray
    deterministic: bool
    action_transform: dict[str, Any] | None

    def reset(self, seed: int) -> None:
        torch.manual_seed(seed)

    def act(self, observation: dict[str, np.ndarray], time_seconds: float) -> np.ndarray:
        vector = np.concatenate([observation[channel["name"]] for channel in self.observation_channels]).astype(np.float32)
        normalized = (vector - self.mean) / np.sqrt(self.variance + 1e-8)
        with torch.no_grad():
            mean, _, log_std = self.network(torch.from_numpy(normalized).unsqueeze(0))
            if self.deterministic:
                raw_action = mean[0]
            else:
                raw_action = torch.distributions.Normal(mean, log_std.exp()).sample()[0]
        action = transform_policy_action(raw_action.numpy(), observation, self.action_transform, time_seconds)
        return np.clip(action, self.action_low, self.action_high)


def load_policy_controller(project_dir: Path, definition: dict[str, Any], compiled: dict[str, Any]) -> FrozenPolicyController:
    policy_dir = (project_dir / "policies" / definition["policy"]).resolve()
    if (project_dir / "policies").resolve() not in policy_dir.parents:
        raise RuntimeError("Policy path escapes project")
    manifest = json.loads((policy_dir / "manifest.json").read_text())
    if manifest["assemblyHash"] != compiled["assemblyHash"]:
        raise RuntimeError("Policy assembly hash does not match compiled assembly")
    if manifest["catalogHash"] != compiled["catalogHash"]:
        raise RuntimeError("Policy component catalog does not match compiled assembly")
    if manifest["observationContractHash"] != compiled["observationContractHash"]:
        raise RuntimeError("Policy observation contract does not match compiled assembly")
    if manifest["actionContractHash"] != compiled["actionContractHash"]:
        raise RuntimeError("Policy action contract does not match compiled assembly")
    architecture = json.loads((policy_dir / "architecture.json").read_text())
    normalizer = json.loads((policy_dir / "normalizer.json").read_text())
    network = PolicyNetwork(architecture["observationSize"], architecture["actionSize"], architecture["hiddenSizes"])
    network.load_state_dict(torch.load(policy_dir / "model.pt", map_location="cpu", weights_only=True))
    network.eval()
    lows = np.array(compiled["actionLow"], dtype=np.float32)
    highs = np.array(compiled["actionHigh"], dtype=np.float32)
    return FrozenPolicyController(network, compiled["observationContract"]["channels"], np.array(normalizer["mean"], dtype=np.float32), np.array(normalizer["variance"], dtype=np.float32), lows, highs, bool(definition.get("deterministic", True)), architecture.get("actionTransform"))
