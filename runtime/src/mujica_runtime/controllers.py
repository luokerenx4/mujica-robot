from __future__ import annotations

import importlib.util
import hashlib
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

import numpy as np
import torch

from .io import hash_directory


POLICY_WARMUP_PASSES = 2


class Controller(Protocol):
    def reset(self, seed: int) -> None: ...
    def act(self, observation: dict[str, np.ndarray], time_seconds: float) -> np.ndarray: ...
    # Program Controllers may also expose telemetry() -> dict[str, Any].
    # The Runtime discovers it dynamically so existing Controllers and frozen
    # Policy adapters keep the same action ABI.


def load_python_module(path: Path, name: str, package_root: Path | None = None):
    spec = importlib.util.spec_from_file_location(
        name,
        path,
        submodule_search_locations=[str(package_root)] if package_root is not None else None,
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load Python module: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    try:
        spec.loader.exec_module(module)
    except Exception:
        sys.modules.pop(name, None)
        raise
    return module


def load_program_controller(root: Path, definition: dict[str, Any]) -> Controller:
    entry = (root / definition["entry"]).resolve()
    if root.resolve() not in entry.parents:
        raise RuntimeError("Controller entry escapes package")
    package_key = hashlib.sha256(str(root.resolve()).encode()).hexdigest()[:12]
    module = load_python_module(
        entry,
        f"mujica_controller_{definition['id'].replace('-', '_')}_{package_key}",
        root.resolve(),
    )
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


class HistoryPolicyNetwork(torch.nn.Module):
    def __init__(self, observation_size: int, action_size: int, hidden_sizes: list[int], history: dict[str, int]):
        super().__init__()
        steps = int(history["steps"]); history_action_size = int(history["actionSize"])
        self.command_start = int(history["commandStart"]); self.applied_start = int(history["appliedStart"])
        self.steps = steps; self.history_action_size = history_action_size
        occupied = set(range(self.command_start, self.command_start + steps * history_action_size)) | set(range(self.applied_start, self.applied_start + steps * history_action_size))
        self.register_buffer("current_indices", torch.tensor([index for index in range(observation_size) if index not in occupied], dtype=torch.long), persistent=False)
        recurrent_size = int(history["recurrentSize"])
        self.history_encoder = torch.nn.GRU(2 * history_action_size, recurrent_size, batch_first=True)
        layers: list[torch.nn.Module] = []; size = len(self.current_indices) + recurrent_size
        for hidden in hidden_sizes:
            layers.extend([torch.nn.Linear(size, hidden), torch.nn.Tanh()]); size = hidden
        self.body = torch.nn.Sequential(*layers)
        self.actor = torch.nn.Linear(size, action_size); self.critic = torch.nn.Linear(size, 1)
        self.log_std = torch.nn.Parameter(torch.full((action_size,), -0.5))

    def forward(self, observation: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        command = observation[..., self.command_start:self.command_start + self.steps * self.history_action_size].reshape(*observation.shape[:-1], self.steps, self.history_action_size)
        applied = observation[..., self.applied_start:self.applied_start + self.steps * self.history_action_size].reshape(*observation.shape[:-1], self.steps, self.history_action_size)
        sequence = torch.cat([command, applied], dim=-1)
        _, hidden = self.history_encoder(sequence)
        current = observation.index_select(-1, self.current_indices)
        latent = self.body(torch.cat([current, hidden[-1]], dim=-1))
        return self.actor(latent), self.critic(latent).squeeze(-1), self.log_std.expand(observation.shape[:-1] + self.log_std.shape)


def create_policy_network(architecture: dict[str, Any]) -> torch.nn.Module:
    if architecture.get("kind") == "history-gru-actor-critic":
        return HistoryPolicyNetwork(architecture["observationSize"], architecture["actionSize"], architecture["hiddenSizes"], architecture["history"])
    return PolicyNetwork(architecture["observationSize"], architecture["actionSize"], architecture["hiddenSizes"])


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
        phase_lead = float(transform["phaseLeadSeconds"])
        if "phaseLeadByDelaySteps" in transform:
            delay_steps = int(round(float(observation[str(transform.get("delayChannel", "actuator-delay-steps"))][0])))
            leads = transform["phaseLeadByDelaySteps"]
            phase_lead = float(leads[min(max(delay_steps, 0), len(leads) - 1)])
        phase = 2.0 * np.pi * float(transform["frequencyHz"]) * (time_seconds + phase_lead)
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


def program_residual_gate_scale(
    transform: dict[str, Any],
    program_prior: Controller,
) -> float:
    """Fail closed when a learned residual is outside its declared behavior mode."""
    gate = transform.get("residualGate")
    if gate is None:
        return 1.0
    if gate.get("kind") != "prior-telemetry-mode":
        raise RuntimeError(
            f"Unsupported program residual gate '{gate.get('kind')}'"
        )
    telemetry_provider = getattr(program_prior, "telemetry", None)
    if telemetry_provider is None:
        return 0.0
    telemetry = telemetry_provider()
    if not isinstance(telemetry, dict):
        return 0.0
    allowed_modes = gate.get("allowedModes", [])
    if telemetry.get("mode") not in allowed_modes:
        return 0.0
    for field, expected in gate.get("requiredTelemetry", {}).items():
        if telemetry.get(field) != expected:
            return 0.0
    ramp_seconds = float(gate.get("rampSeconds", 0.0))
    if ramp_seconds <= 0.0:
        return 1.0
    dwell_seconds = float(telemetry.get("modeDwellSeconds", 0.0))
    if not np.isfinite(dwell_seconds):
        return 0.0
    return float(np.clip(dwell_seconds / ramp_seconds, 0.0, 1.0))


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
    program_prior: Controller | None = None
    warmup_passes: int = 0
    last_residual_gate_scale: float = 0.0

    def reset(self, seed: int) -> None:
        torch.manual_seed(seed)
        if self.program_prior is not None: self.program_prior.reset(seed)
        self.last_residual_gate_scale = 0.0

    def act(self, observation: dict[str, np.ndarray], time_seconds: float) -> np.ndarray:
        vector = np.concatenate([observation[channel["name"]] for channel in self.observation_channels]).astype(np.float32)
        normalized = (vector - self.mean) / np.sqrt(self.variance + 1e-8)
        with torch.no_grad():
            mean, _, log_std = self.network(torch.from_numpy(normalized).unsqueeze(0))
            if self.deterministic:
                raw_action = mean[0]
            else:
                raw_action = torch.distributions.Normal(mean, log_std.exp()).sample()[0]
        if self.action_transform and self.action_transform.get("kind") == "program-controller-residual":
            if self.program_prior is None: raise RuntimeError("Frozen Policy is missing its serialized program prior")
            prior_action = self.program_prior.act(observation, time_seconds)
            self.last_residual_gate_scale = program_residual_gate_scale(
                self.action_transform,
                self.program_prior,
            )
            action = (
                prior_action
                + self.last_residual_gate_scale
                * float(self.action_transform.get("residualScale", 1.0))
                * raw_action.numpy()
            )
        else:
            self.last_residual_gate_scale = 1.0
            action = transform_policy_action(raw_action.numpy(), observation, self.action_transform, time_seconds)
        return np.clip(action, self.action_low, self.action_high)

    def telemetry(self) -> dict[str, Any]:
        telemetry: dict[str, Any] = {}
        if self.program_prior is not None:
            provider = getattr(self.program_prior, "telemetry", None)
            if provider is not None:
                prior_telemetry = provider()
                if isinstance(prior_telemetry, dict):
                    telemetry.update(prior_telemetry)
        telemetry["policyResidualGateScale"] = self.last_residual_gate_scale
        return telemetry


def load_policy_controller(project_dir: Path, definition: dict[str, Any], compiled: dict[str, Any]) -> FrozenPolicyController:
    policy_dir = (project_dir / "policies" / definition["policy"]).resolve()
    if (project_dir / "policies").resolve() not in policy_dir.parents:
        raise RuntimeError("Policy path escapes project")
    manifest = json.loads((policy_dir / "manifest.json").read_text())
    if "executionHash" in manifest:
        if manifest["executionHash"] != compiled["executionHash"]:
            raise RuntimeError("Policy execution hash does not match compiled assembly")
    else:
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
    network = create_policy_network(architecture)
    network.load_state_dict(torch.load(policy_dir / "model.pt", map_location="cpu", weights_only=True))
    network.eval()
    with torch.no_grad():
        warmup_observation = torch.zeros((1, int(architecture["observationSize"])), dtype=torch.float32)
        for _ in range(POLICY_WARMUP_PASSES):
            network(warmup_observation)
    lows = np.array(compiled["actionLow"], dtype=np.float32)
    highs = np.array(compiled["actionHigh"], dtype=np.float32)
    action_transform = architecture.get("actionTransform")
    program_prior = None
    if action_transform and action_transform.get("kind") == "program-controller-residual":
        prior_root = (policy_dir / "prior").resolve()
        if policy_dir.resolve() not in prior_root.parents or not (prior_root / "controller.json").exists():
            raise RuntimeError("Serialized program prior is missing from Policy Artifact")
        prior_definition = json.loads((prior_root / "controller.json").read_text())
        controller_hash = action_transform.get("controllerHash")
        if controller_hash and hash_directory(prior_root) != controller_hash:
            raise RuntimeError("Serialized program prior hash does not match Policy architecture")
        program_prior = load_program_controller(prior_root, prior_definition)
    return FrozenPolicyController(network, compiled["observationContract"]["channels"], np.array(normalizer["mean"], dtype=np.float32), np.array(normalizer["variance"], dtype=np.float32), lows, highs, bool(definition.get("deterministic", True)), action_transform, program_prior, POLICY_WARMUP_PASSES)
