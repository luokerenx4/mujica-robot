from __future__ import annotations

import json
import random
import shutil
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import mujoco
import numpy as np
import torch

from .controllers import PolicyNetwork, load_python_module, transform_policy_action
from .environment import RobotEnvironment
from .io import atomic_directory, hardware_info, hash_file, hash_json, write_json


class RunningNormalizer:
    def __init__(self, size: int):
        self.count = 1e-4
        self.mean = np.zeros(size, dtype=np.float64)
        self.m2 = np.ones(size, dtype=np.float64) * 1e-4

    @property
    def variance(self) -> np.ndarray: return np.maximum(self.m2 / self.count, 1e-6)

    def update(self, value: np.ndarray) -> None:
        self.count += 1.0
        delta = value - self.mean
        self.mean += delta / self.count
        self.m2 += delta * (value - self.mean)

    def normalize(self, value: np.ndarray) -> np.ndarray: return ((value - self.mean) / np.sqrt(self.variance + 1e-8)).astype(np.float32)


@dataclass
class PPOTrainer:
    hidden_sizes: list[int]
    action_transform: dict[str, Any] | None = None
    initial_log_std: float = -0.5

    def train(self, request: dict[str, Any], output_dir: Path) -> dict[str, Any]:
        config = request["training"]
        seed = int(request["seed"])
        random.seed(seed); np.random.seed(seed); torch.manual_seed(seed)
        torch.use_deterministic_algorithms(True, warn_only=True)
        scenarios = request["scenarios"]
        scenario_index = 0

        def make_environment() -> RobotEnvironment:
            nonlocal scenario_index
            scenario = scenarios[scenario_index % len(scenarios)]; scenario_index += 1
            return RobotEnvironment(Path(request["modelPath"]), request["compiled"], request["task"], scenario, seed + scenario_index)

        environment = make_environment()
        observation_map = environment.reset(); observation = environment.vector(observation_map)
        observation_size = observation.size; action_size = environment.model.nu
        network = PolicyNetwork(observation_size, action_size, self.hidden_sizes)
        if self.action_transform:
            torch.nn.init.zeros_(network.actor.weight); torch.nn.init.zeros_(network.actor.bias)
        with torch.no_grad(): network.log_std.fill_(self.initial_log_std)
        optimizer = torch.optim.Adam(network.parameters(), lr=float(config["learningRate"]))
        normalizer = RunningNormalizer(observation_size)
        total_steps = int(config["totalSteps"]); rollout_steps = int(config["rolloutSteps"])
        metrics: list[dict[str, Any]] = []
        completed_steps = 0; episode_reward = 0.0; completed_rewards: list[float] = []
        lows = np.asarray(request["compiled"]["actionLow"], dtype=np.float32); highs = np.asarray(request["compiled"]["actionHigh"], dtype=np.float32)

        while completed_steps < total_steps:
            batch_obs: list[np.ndarray] = []; batch_actions: list[np.ndarray] = []; batch_log_probs: list[float] = []; batch_rewards: list[float] = []; batch_dones: list[float] = []; batch_values: list[float] = []
            for _ in range(min(rollout_steps, total_steps - completed_steps)):
                normalizer.update(observation); normalized = normalizer.normalize(observation)
                obs_tensor = torch.from_numpy(normalized).unsqueeze(0)
                with torch.no_grad():
                    mean, value, log_std = network(obs_tensor); distribution = torch.distributions.Normal(mean, log_std.exp()); action_tensor = distribution.sample(); log_prob = distribution.log_prob(action_tensor).sum(-1)
                raw_action = action_tensor[0].numpy(); action = np.clip(transform_policy_action(raw_action, observation_map, self.action_transform, float(environment.data.time)), lows, highs)
                result = environment.step(action)
                episode_reward += result.reward
                done = result.terminated or result.truncated
                batch_obs.append(normalized); batch_actions.append(raw_action.astype(np.float32)); batch_log_probs.append(float(log_prob.item())); batch_rewards.append(result.reward); batch_dones.append(float(done)); batch_values.append(float(value.item()))
                observation_map = result.observation; observation = environment.vector(observation_map); completed_steps += 1
                if done:
                    completed_rewards.append(episode_reward); episode_reward = 0.0; environment = make_environment(); observation_map = environment.reset(); observation = environment.vector(observation_map)
            with torch.no_grad():
                normalized = normalizer.normalize(observation); _, next_value, _ = network(torch.from_numpy(normalized).unsqueeze(0)); bootstrap = float(next_value.item())
            advantages = np.zeros(len(batch_rewards), dtype=np.float32); last_advantage = 0.0
            for index in reversed(range(len(batch_rewards))):
                next_nonterminal = 1.0 - batch_dones[index]
                following = bootstrap if index == len(batch_rewards) - 1 else batch_values[index + 1]
                delta = batch_rewards[index] + float(config["gamma"]) * following * next_nonterminal - batch_values[index]
                last_advantage = delta + float(config["gamma"]) * float(config["gaeLambda"]) * next_nonterminal * last_advantage
                advantages[index] = last_advantage
            returns = advantages + np.asarray(batch_values, dtype=np.float32)
            advantages = (advantages - advantages.mean()) / (advantages.std() + 1e-8)
            tensors = (torch.tensor(np.asarray(batch_obs)), torch.tensor(np.asarray(batch_actions)), torch.tensor(np.asarray(batch_log_probs)), torch.tensor(advantages), torch.tensor(returns))
            losses: list[float] = []
            indices = np.arange(len(batch_rewards))
            for _ in range(int(config["epochs"])):
                np.random.shuffle(indices)
                for start in range(0, len(indices), int(config["minibatchSize"])):
                    selected = indices[start:start + int(config["minibatchSize"])]
                    obs_t, action_t, old_log_t, advantage_t, return_t = (tensor[selected] for tensor in tensors)
                    mean, value, log_std = network(obs_t); distribution = torch.distributions.Normal(mean, log_std.exp()); new_log = distribution.log_prob(action_t).sum(-1); entropy = distribution.entropy().sum(-1).mean()
                    ratio = (new_log - old_log_t).exp(); clipped = torch.clamp(ratio, 1.0 - float(config["clipRatio"]), 1.0 + float(config["clipRatio"]))
                    policy_loss = -torch.min(ratio * advantage_t, clipped * advantage_t).mean(); value_loss = 0.5 * torch.square(value - return_t).mean()
                    loss = policy_loss + value_loss - float(config["entropyCoefficient"]) * entropy
                    optimizer.zero_grad(); loss.backward(); torch.nn.utils.clip_grad_norm_(network.parameters(), 0.5); optimizer.step(); losses.append(float(loss.item()))
            metrics.append({"steps": completed_steps, "meanLoss": float(np.mean(losses)), "meanEpisodeReward": float(np.mean(completed_rewards[-10:])) if completed_rewards else episode_reward})

        torch.save(network.state_dict(), output_dir / "model.pt")
        write_json(output_dir / "architecture.json", {"kind": "mlp-actor-critic", "observationSize": observation_size, "actionSize": action_size, "hiddenSizes": self.hidden_sizes, "activation": "tanh", "distribution": "diagonal-normal", "actionTransform": self.action_transform})
        write_json(output_dir / "normalizer.json", {"count": normalizer.count, "mean": normalizer.mean.tolist(), "variance": normalizer.variance.tolist()})
        write_json(output_dir / "training-metrics.json", {"updates": metrics, "totalSteps": completed_steps, "episodes": len(completed_rewards), "finalMeanEpisodeReward": float(np.mean(completed_rewards[-10:])) if completed_rewards else episode_reward})
        return {"totalSteps": completed_steps, "updates": len(metrics), "episodes": len(completed_rewards), "finalMeanEpisodeReward": float(np.mean(completed_rewards[-10:])) if completed_rewards else episode_reward}


def train(request: dict[str, Any]) -> dict[str, Any]:
    project_dir = Path(request["projectDir"]); trainer_root = Path(request["trainerRoot"]); definition = request["trainer"]
    module = load_python_module((trainer_root / definition["entry"]).resolve(), f"mujica_trainer_{definition['id'].replace('-', '_')}")
    trainer = module.create_trainer()
    run_key = hash_json({"runtimeVersion": request["runtimeVersion"], "runtimeSourceHash": request["runtimeSourceHash"], "harnessSourceHash": request["harnessSourceHash"], "harnessDependencyLockHash": request["harnessDependencyLockHash"], "mujocoVersion": mujoco.__version__, "torchVersion": torch.__version__, "assemblyHash": request["compiled"]["assemblyHash"], "trainerHash": request["trainerHash"], "training": request["training"], "task": request["task"], "scenarios": request["scenarios"], "seed": request["seed"], "dependencyLockHash": request["dependencyLockHash"]})
    training_run_id = f"training-{run_key[:16]}"; training_run = project_dir / "training-runs" / training_run_id
    if (training_run / "manifest.json").exists(): return {**json.loads((training_run / "result.json").read_text()), "artifactPath": str(training_run), "cached": True}
    policy_result: dict[str, Any] = {}

    def run_writer(directory: Path) -> None:
        nonlocal policy_result
        work = directory / "work"; work.mkdir()
        started = time.time(); training_metrics = trainer.train(request, work); elapsed = time.time() - started
        model_hash = hash_file(work / "model.pt")
        observation_hash = hash_json(request["compiled"]["observationContract"]); action_hash = hash_json(request["compiled"]["actionContract"])
        policy_identity = {"runtimeVersion": request["runtimeVersion"], "runtimeSourceHash": request["runtimeSourceHash"], "harnessSourceHash": request["harnessSourceHash"], "harnessDependencyLockHash": request["harnessDependencyLockHash"], "mujocoVersion": mujoco.__version__, "torchVersion": torch.__version__, "trainerHash": request["trainerHash"], "trainingHash": hash_json(request["training"]), "assemblyHash": request["compiled"]["assemblyHash"], "catalogHash": request["compiled"]["catalogHash"], "observationContractHash": observation_hash, "actionContractHash": action_hash, "taskHash": hash_json(request["task"]), "scenarioHashes": [hash_json(item) for item in request["scenarios"]], "seed": request["seed"], "budget": request["training"]["totalSteps"], "dependencyLockHash": request["dependencyLockHash"], "modelHash": model_hash}
        policy_id = f"{request['training']['id']}-{hash_json(policy_identity)[:16]}"; policy_dir = project_dir / "policies" / policy_id
        reuse_policy = False
        if policy_dir.exists():
            existing = json.loads((policy_dir / "manifest.json").read_text())
            if existing.get("modelHash") != model_hash: raise RuntimeError(f"Policy identity collision with different model: {policy_dir}")
            reuse_policy = True

        def policy_writer(target: Path) -> None:
            for name in ["model.pt", "architecture.json", "normalizer.json", "training-metrics.json"]: shutil.copy2(work / name, target / name)
            write_json(target / "observation-contract.json", request["compiled"]["observationContract"]); write_json(target / "action-contract.json", request["compiled"]["actionContract"])
            write_json(target / "training-config.json", request["training"]); write_json(target / "source-hashes.json", request["sourceHashes"])
            write_json(target / "manifest.json", {"version": 1, "id": policy_id, **policy_identity, "hardware": hardware_info(), "trainingDeterminism": "best-effort", "evaluationDeterminism": "same-environment-bitwise-intended", "createdByTrainingRun": training_run_id})
        if not reuse_policy: atomic_directory(policy_dir, policy_writer)
        policy_result = {"trainingRunId": training_run_id, "policyId": policy_id, "policyPath": str(policy_dir), "modelHash": model_hash, "trainingMetrics": training_metrics, "elapsedSeconds": elapsed}
        write_json(directory / "request.json", request); write_json(directory / "result.json", policy_result)
        write_json(directory / "manifest.json", {"version": 1, "id": training_run_id, "runKey": run_key, "policyId": policy_id, "completed": True})
        shutil.rmtree(work)
    atomic_directory(training_run, run_writer)
    return {**policy_result, "artifactPath": str(training_run), "cached": False}
