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


@dataclass
class FrozenPolicyController:
    network: PolicyNetwork
    observation_channels: list[dict[str, Any]]
    mean: np.ndarray
    variance: np.ndarray
    action_low: np.ndarray
    action_high: np.ndarray
    deterministic: bool

    def reset(self, seed: int) -> None:
        torch.manual_seed(seed)

    def act(self, observation: dict[str, np.ndarray], time_seconds: float) -> np.ndarray:
        del time_seconds
        vector = np.concatenate([observation[channel["name"]] for channel in self.observation_channels]).astype(np.float32)
        normalized = (vector - self.mean) / np.sqrt(self.variance + 1e-8)
        with torch.no_grad():
            mean, _, log_std = self.network(torch.from_numpy(normalized).unsqueeze(0))
            if self.deterministic:
                action = mean[0]
            else:
                action = torch.distributions.Normal(mean, log_std.exp()).sample()[0]
        return np.clip(action.numpy(), self.action_low, self.action_high)


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
    return FrozenPolicyController(network, compiled["observationContract"]["channels"], np.array(normalizer["mean"], dtype=np.float32), np.array(normalizer["variance"], dtype=np.float32), lows, highs, bool(definition.get("deterministic", True)))
