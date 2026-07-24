from __future__ import annotations

import json
import random
import shutil
import time
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import mujoco
import numpy as np
import torch

from .controllers import Controller, PolicyNetwork, create_policy_network, load_program_controller, load_python_module, program_residual_gate_scale, transform_policy_action
from .environment import RobotEnvironment
from .io import atomic_directory, hardware_info, hash_file, hash_json, write_json


QUALITY_REWARD_REFERENCES = {
    "jointAcceleration": 1000.0,
    "bodyAngularAcceleration": 100.0,
    "actionSlew": 800.0,
    "actuatorSaturation": 1.0,
    "footSlip": 1.0,
    "footImpact": 20000.0,
}
QUALITY_REWARD_FEATURES = {
    "jointAcceleration": "jointAccelerationMeanAbsRadPerSec2",
    "bodyAngularAcceleration": "bodyAngularAccelerationMeanAbsRadPerSec2",
    "actionSlew": "actionSlewMeanAbsPerSec",
    "actuatorSaturation": "actuatorSaturationRate",
    "footSlip": "footSlipMeanMps",
    "footImpact": "footContactImpactMeanNPerSec",
}
DOMAIN_PARAMETER_NAMES = (
    "bodyMassScale",
    "jointDampingScale",
    "actuatorStrengthScale",
    "frictionScale",
    "observationNoiseStd",
    "actuatorDelayJitterSteps",
    "pushTimeOffsetSeconds",
    "pushForceScale",
    "pushDirectionJitterRad",
)


def sample_domain_profile(profile: dict[str, Any] | None, seed: int) -> dict[str, float | int]:
    if not profile:
        return {}
    rng = np.random.default_rng(seed)
    sample: dict[str, float | int] = {}
    for name in DOMAIN_PARAMETER_NAMES:
        bounds = profile.get("parameters", {}).get(name)
        if not bounds:
            continue
        minimum = bounds["minimum"]; maximum = bounds["maximum"]
        if name == "actuatorDelayJitterSteps":
            sample[name] = int(rng.integers(int(minimum), int(maximum) + 1))
        else:
            sample[name] = float(rng.uniform(float(minimum), float(maximum)))
    return sample


def summarize_domain_samples(samples: list[dict[str, Any]]) -> dict[str, dict[str, float]]:
    summary: dict[str, dict[str, float]] = {}
    for name in DOMAIN_PARAMETER_NAMES:
        values = [float(item["parameters"][name]) for item in samples if name in item["parameters"]]
        if values:
            summary[name] = {"minimum": min(values), "mean": float(np.mean(values)), "maximum": max(values)}
    return summary


def quality_reward_penalty(info: dict[str, Any], weights: dict[str, Any] | None) -> tuple[float, dict[str, float]]:
    quality = info.get("motionQuality", {})
    terms = {
        name: float((weights or {}).get(name, 0.0)) * float(quality.get(feature, 0.0)) / reference
        for name, reference in QUALITY_REWARD_REFERENCES.items()
        for feature in [QUALITY_REWARD_FEATURES[name]]
    }
    return float(sum(terms.values())), terms


def mission_reward_bonus(
    info: dict[str, Any],
    weights: dict[str, Any] | None,
    actor_authority: float,
) -> tuple[float, dict[str, float]]:
    terms = {"commandProgress": 0.0, "velocityTracking": 0.0, "stopStability": 0.0}
    if not weights or info.get("missionPhase") is None or actor_authority <= 0.0:
        return 0.0, terms
    target = np.asarray(info.get("motionCommand", np.zeros(3)), dtype=np.float64)
    target_speed = float(np.linalg.norm(target[:2]))
    intent = info.get("missionIntent")
    if target_speed > 1e-9 and intent not in ("disturbance", "recover", "stop"):
        terms["commandProgress"] = float(weights.get("commandProgress", 0.0)) * float(info.get("normalizedProgressRate", 0.0))
        velocity_error = float(info.get("velocityError", 0.0))
        terms["velocityTracking"] = float(weights.get("velocityTracking", 0.0)) * float(np.exp(-10.0 * velocity_error * velocity_error))
    elif intent == "stop":
        velocity_error = float(info.get("velocityError", 0.0))
        terms["stopStability"] = float(weights.get("stopStability", 0.0)) * float(np.exp(-10.0 * velocity_error * velocity_error))
    return float(sum(terms.values())), terms


def recovery_reward_bonus(
    info: dict[str, Any],
    telemetry: dict[str, Any] | None,
    weights: dict[str, Any] | None,
    actor_authority: float,
) -> tuple[float, dict[str, float]]:
    terms = {"upright": 0.0, "height": 0.0, "stillness": 0.0, "support": 0.0}
    if (
        not weights
        or actor_authority <= 0.0
        or not isinstance(telemetry, dict)
        or telemetry.get("mode") != "recovery"
    ):
        return 0.0, terms
    values = {
        "tilt": telemetry.get("bodyTiltRad"),
        "height": info.get("height"),
        "linearSpeed": info.get("baseLinearSpeedMps"),
        "angularSpeed": info.get("baseAngularSpeedRadPerSec"),
        "supportFeet": telemetry.get("supportFeet"),
    }
    if any(
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not np.isfinite(float(value))
        for value in values.values()
    ):
        return 0.0, terms
    tilt = float(values["tilt"])
    height = float(values["height"])
    linear_speed = float(values["linearSpeed"])
    angular_speed = float(values["angularSpeed"])
    support_feet = float(values["supportFeet"])
    terms["upright"] = float(weights.get("upright", 0.0)) * float(
        np.exp(-8.0 * tilt * tilt)
    )
    terms["height"] = float(weights.get("height", 0.0)) * float(
        np.clip((height - 0.05) / (0.32 - 0.05), 0.0, 1.0)
    )
    terms["stillness"] = float(weights.get("stillness", 0.0)) * float(
        1.0
        / (
            1.0
            + 2.0 * linear_speed * linear_speed
            + 2.0 * angular_speed * angular_speed
        )
    )
    terms["support"] = float(weights.get("support", 0.0)) * float(
        np.clip(support_feet / 4.0, 0.0, 1.0)
    )
    return float(sum(terms.values())), terms


def normalize_masked_advantages(
    advantages: np.ndarray, policy_masks: np.ndarray
) -> np.ndarray:
    normalized = np.zeros_like(advantages, dtype=np.float32)
    active = policy_masks > 0.0
    if not np.any(active):
        return normalized
    active_advantages = advantages[active]
    normalized[active] = (
        active_advantages - active_advantages.mean()
    ) / (active_advantages.std() + 1e-8)
    return normalized


def masked_mean(values: torch.Tensor, masks: torch.Tensor) -> torch.Tensor:
    denominator = masks.sum()
    if float(denominator.detach().item()) <= 0.0:
        return values.sum() * 0.0
    return (values * masks).sum() / denominator


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


def effective_action_transform(base: dict[str, Any] | None, config: dict[str, Any]) -> dict[str, Any] | None:
    transform = deepcopy(base)
    if "residualScale" in config:
        if transform is None:
            raise RuntimeError("Training residualScale requires a Trainer action transform")
        transform["residualScale"] = float(config["residualScale"])
    return transform


def select_curriculum_index(
    weights: np.ndarray,
    completed_steps: np.ndarray,
    rng: np.random.Generator,
    sampling: str,
) -> int:
    if sampling == "episode-probability":
        return int(rng.choice(len(weights), p=weights))
    if sampling != "step-share":
        raise RuntimeError(f"Unsupported curriculum sampling '{sampling}'")
    total = float(completed_steps.sum())
    if total <= 0.0:
        return int(rng.choice(len(weights), p=weights))
    deficits = weights * total - completed_steps
    maximum = float(deficits.max())
    tied = np.flatnonzero(np.isclose(deficits, maximum, rtol=0.0, atol=1e-9))
    if tied.size == 1:
        return int(tied[0])
    tied_weights = weights[tied] / weights[tied].sum()
    return int(rng.choice(tied, p=tied_weights))


def select_progression_index(
    progression: list[dict[str, Any]], completed_steps: int
) -> int:
    for index, stage in enumerate(progression):
        if completed_steps < int(stage["untilStep"]):
            return index
    return len(progression) - 1


def mission_prefix_end_seconds(task: dict[str, Any], through_phase: str) -> float:
    if int(task.get("version", 0)) != 7:
        raise RuntimeError("Mission progression requires an integrated Mission Task")
    phases = task["missionPhases"]
    for index, phase in enumerate(phases):
        if phase["id"] != through_phase:
            continue
        if index + 1 < len(phases):
            return float(phases[index + 1]["atSeconds"])
        return float(task["durationSeconds"])
    raise RuntimeError(f"Mission progression names unknown phase '{through_phase}'")


@dataclass
class PPOTrainer:
    hidden_sizes: list[int]
    action_transform: dict[str, Any] | None = None
    initial_log_std: float = -0.5
    history_encoder: dict[str, Any] | None = None

    def train(self, request: dict[str, Any], output_dir: Path) -> dict[str, Any]:
        config = request["training"]
        action_transform = effective_action_transform(self.action_transform, config)
        seed = int(request["seed"])
        random.seed(seed); np.random.seed(seed); torch.manual_seed(seed)
        torch.use_deterministic_algorithms(True, warn_only=True)
        progression = request.get("progression")
        curriculum = request.get("curriculum")
        if progression:
            if not request.get("task") or not request.get("scenarios"):
                raise RuntimeError("Mission progression requires one expanded Task and at least one Scenario")
            curriculum = [{
                **stage,
                "role": "mission-progression",
                "task": request["task"],
                "scenarios": request["scenarios"],
                "episodeEndSeconds": mission_prefix_end_seconds(
                    request["task"], str(stage["throughPhase"])
                ),
            } for stage in progression]
        elif not curriculum:
            curriculum = [{
                "id": "legacy-training",
                "role": "skill",
                "weight": 1.0,
                "task": request["task"],
                "scenarios": request["scenarios"],
            }]
        weights = np.asarray(
            [1.0 for _ in curriculum]
            if progression
            else [float(entry["weight"]) for entry in curriculum],
            dtype=np.float64,
        )
        weights /= weights.sum()
        curriculum_sampling = (
            "mission-progression"
            if progression
            else str(config.get("curriculumSampling", "episode-probability"))
        )
        curriculum_rng = np.random.default_rng(seed + 20_000_000)
        scenario_indices = {str(entry["id"]): 0 for entry in curriculum}
        curriculum_step_counts = np.zeros(len(curriculum), dtype=np.int64)
        curriculum_active_policy_steps = np.zeros(len(curriculum), dtype=np.int64)
        curriculum_actor_authority_sums = np.zeros(len(curriculum), dtype=np.float64)
        curriculum_learning_reward_sums = np.zeros(len(curriculum), dtype=np.float64)
        episode_index = 0
        completed_steps = 0
        domain_samples: list[dict[str, Any]] = []

        def make_environment() -> RobotEnvironment:
            nonlocal episode_index
            curriculum_index = (
                select_progression_index(curriculum, completed_steps)
                if progression
                else select_curriculum_index(
                    weights, curriculum_step_counts, curriculum_rng, curriculum_sampling
                )
            )
            entry = curriculum[curriculum_index]
            entry_id = str(entry["id"])
            scenario_index = scenario_indices[entry_id]
            scenario = entry["scenarios"][scenario_index % len(entry["scenarios"])]
            scenario_indices[entry_id] = scenario_index + 1
            episode_index += 1
            episode_seed = seed + episode_index
            domain_seed = seed + 10_000_000 + episode_index
            effective_domain_profile = entry.get("domainProfile") or request.get("domainProfile")
            domain_sample = sample_domain_profile(effective_domain_profile, domain_seed)
            domain_samples.append({
                "episode": episode_index,
                "curriculum": entry_id,
                "curriculumIndex": curriculum_index,
                "role": entry["role"],
                "task": entry["task"]["id"],
                "scenario": scenario["id"],
                "environmentSeed": episode_seed,
                "domainSeed": domain_seed,
                "globalStepStart": completed_steps,
                "throughPhase": entry.get("throughPhase"),
                "episodeEndSeconds": entry.get("episodeEndSeconds", float(entry["task"]["durationSeconds"])),
                "domainProfileId": effective_domain_profile.get("id") if effective_domain_profile else None,
                "domainProfileHash": entry.get("domainProfileHash") or request.get("domainProfileHash"),
                "steps": 0,
                "completed": False,
                "parameters": domain_sample,
            })
            return RobotEnvironment(
                Path(request["modelPath"]),
                request["compiled"],
                entry["task"],
                scenario,
                episode_seed,
                domain_sample,
                entry.get("episodeEndSeconds"),
            )

        environment = make_environment()
        program_prior: Controller | None = None
        if action_transform and action_transform.get("kind") == "program-controller-residual":
            if not request.get("priorController") or not request.get("priorControllerRoot"): raise RuntimeError("Program residual Trainer requires a priorController")
            program_prior = load_program_controller(Path(request["priorControllerRoot"]), request["priorController"])
            program_prior.reset(seed + episode_index)
        observation_map = environment.reset(); observation = environment.vector(observation_map)
        observation_size = observation.size; action_size = environment.model.nu
        architecture: dict[str, Any] = {"kind": "mlp-actor-critic", "observationSize": observation_size, "actionSize": action_size, "hiddenSizes": self.hidden_sizes, "activation": "tanh", "distribution": "diagonal-normal"}
        if self.history_encoder:
            offsets: dict[str, int] = {}; offset = 0
            for channel in request["compiled"]["observationContract"]["channels"]:
                offsets[channel["name"]] = offset; offset += int(channel["size"])
            architecture["kind"] = "history-gru-actor-critic"
            architecture["history"] = {
                "commandStart": offsets[str(self.history_encoder["commandChannel"])],
                "appliedStart": offsets[str(self.history_encoder["appliedChannel"])],
                "steps": int(self.history_encoder["steps"]),
                "actionSize": action_size,
                "recurrentSize": int(self.history_encoder["recurrentSize"]),
            }
        network = create_policy_network(architecture)
        if self.action_transform:
            torch.nn.init.zeros_(network.actor.weight); torch.nn.init.zeros_(network.actor.bias)
        with torch.no_grad(): network.log_std.fill_(self.initial_log_std)
        optimizer = torch.optim.Adam(network.parameters(), lr=float(config["learningRate"]))
        normalizer = RunningNormalizer(observation_size)
        total_steps = int(config["totalSteps"]); rollout_steps = int(config["rolloutSteps"])
        metrics: list[dict[str, Any]] = []
        episode_reward = 0.0; completed_rewards: list[float] = []
        mission_phase_samples: dict[str, dict[str, Any]] = {}
        lows = np.asarray(request["compiled"]["actionLow"], dtype=np.float32); highs = np.asarray(request["compiled"]["actionHigh"], dtype=np.float32)

        while completed_steps < total_steps:
            batch_obs: list[np.ndarray] = []; batch_actions: list[np.ndarray] = []; batch_log_probs: list[float] = []; batch_rewards: list[float] = []; batch_dones: list[float] = []; batch_values: list[float] = []
            batch_base_rewards: list[float] = []; batch_quality_penalties: list[float] = []; batch_quality_terms: dict[str, list[float]] = {name: [] for name in QUALITY_REWARD_REFERENCES}
            batch_mission_bonuses: list[float] = []; batch_mission_terms: dict[str, list[float]] = {name: [] for name in ("commandProgress", "velocityTracking", "stopStability")}
            batch_recovery_bonuses: list[float] = []; batch_recovery_terms: dict[str, list[float]] = {name: [] for name in ("upright", "height", "stillness", "support")}
            batch_residual_gate_scales: list[float] = []
            batch_residual_l2: list[float] = []
            batch_policy_masks: list[float] = []
            for _ in range(min(rollout_steps, total_steps - completed_steps)):
                normalizer.update(observation); normalized = normalizer.normalize(observation)
                obs_tensor = torch.from_numpy(normalized).unsqueeze(0)
                with torch.no_grad():
                    mean, value, log_std = network(obs_tensor); distribution = torch.distributions.Normal(mean, log_std.exp()); action_tensor = distribution.sample(); log_prob = distribution.log_prob(action_tensor).sum(-1)
                raw_action = action_tensor[0].numpy()
                prior_telemetry: dict[str, Any] | None = None
                if action_transform and action_transform.get("kind") == "program-controller-residual":
                    if program_prior is None: raise RuntimeError("Program residual prior is unavailable")
                    prior_action = program_prior.act(
                        observation_map, float(environment.data.time)
                    )
                    telemetry_provider = getattr(program_prior, "telemetry", None)
                    if telemetry_provider is not None:
                        provided = telemetry_provider()
                        if isinstance(provided, dict):
                            prior_telemetry = provided
                    residual_gate_scale = program_residual_gate_scale(
                        action_transform, program_prior
                    )
                    transformed = (
                        prior_action
                        + residual_gate_scale
                        * float(action_transform.get("residualScale", 1.0))
                        * raw_action
                    )
                    batch_residual_gate_scales.append(residual_gate_scale)
                    batch_policy_masks.append(residual_gate_scale)
                    batch_residual_l2.append(
                        float(np.linalg.norm(raw_action) / np.sqrt(raw_action.size))
                    )
                else:
                    transformed = transform_policy_action(raw_action, observation_map, action_transform, float(environment.data.time))
                    batch_policy_masks.append(1.0)
                action = np.clip(transformed, lows, highs)
                result = environment.step(action)
                quality_penalty, quality_terms = quality_reward_penalty(result.info, config.get("qualityReward"))
                actor_authority = float(batch_policy_masks[-1]) * float((action_transform or {}).get("residualScale", 1.0))
                mission_bonus, mission_terms = mission_reward_bonus(result.info, config.get("missionReward"), actor_authority)
                recovery_bonus, recovery_terms = recovery_reward_bonus(
                    result.info,
                    prior_telemetry,
                    config.get("recoveryReward"),
                    actor_authority,
                )
                learning_reward = result.reward - quality_penalty + mission_bonus + recovery_bonus
                curriculum_index = int(domain_samples[-1]["curriculumIndex"])
                curriculum_active_policy_steps[curriculum_index] += int(actor_authority > 0.0)
                curriculum_actor_authority_sums[curriculum_index] += actor_authority
                curriculum_learning_reward_sums[curriculum_index] += learning_reward
                episode_reward += learning_reward
                done = result.terminated or result.truncated
                batch_obs.append(normalized); batch_actions.append(raw_action.astype(np.float32)); batch_log_probs.append(float(log_prob.item())); batch_rewards.append(learning_reward); batch_dones.append(float(done)); batch_values.append(float(value.item()))
                batch_base_rewards.append(result.reward); batch_quality_penalties.append(quality_penalty)
                for name, value in quality_terms.items(): batch_quality_terms[name].append(value)
                batch_mission_bonuses.append(mission_bonus)
                for name, value in mission_terms.items(): batch_mission_terms[name].append(value)
                batch_recovery_bonuses.append(recovery_bonus)
                for name, value in recovery_terms.items(): batch_recovery_terms[name].append(value)
                phase_id = result.info.get("missionPhase")
                if phase_id is not None:
                    curriculum_id = str(domain_samples[-1]["curriculum"])
                    phase_key = f"{curriculum_id}:{phase_id}"
                    sample = mission_phase_samples.setdefault(phase_key, {
                        "curriculum": curriculum_id,
                        "role": domain_samples[-1]["role"],
                        "task": domain_samples[-1]["task"],
                        "phase": str(phase_id),
                        "intent": result.info.get("missionIntent"),
                        "steps": 0,
                        "activePolicySteps": 0,
                        "actorAuthoritySum": 0.0,
                        "baseRewardSum": 0.0,
                        "missionRewardSum": 0.0,
                        "recoveryRewardSum": 0.0,
                        "learningRewardSum": 0.0,
                        "qualityPenaltySum": 0.0,
                        "commandedProgressM": 0.0,
                    })
                    sample["steps"] += 1
                    sample["activePolicySteps"] += int(actor_authority > 0.0)
                    sample["actorAuthoritySum"] += actor_authority
                    sample["baseRewardSum"] += float(result.reward)
                    sample["missionRewardSum"] += mission_bonus
                    sample["recoveryRewardSum"] += recovery_bonus
                    sample["learningRewardSum"] += learning_reward
                    sample["qualityPenaltySum"] += quality_penalty
                    sample["commandedProgressM"] += float(result.info.get("commandedProgressDeltaM", 0.0))
                observation_map = result.observation; observation = environment.vector(observation_map); completed_steps += 1
                domain_samples[-1]["steps"] += 1
                curriculum_step_counts[int(domain_samples[-1]["curriculumIndex"])] += 1
                if done:
                    domain_samples[-1]["completed"] = True
                    completed_rewards.append(episode_reward); episode_reward = 0.0
                    if completed_steps < total_steps:
                        environment = make_environment()
                        if program_prior is not None: program_prior = load_program_controller(Path(request["priorControllerRoot"]), request["priorController"]); program_prior.reset(seed + episode_index)
                        observation_map = environment.reset(); observation = environment.vector(observation_map)
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
            policy_masks = np.asarray(batch_policy_masks, dtype=np.float32)
            advantages = normalize_masked_advantages(advantages, policy_masks)
            tensors = (torch.tensor(np.asarray(batch_obs)), torch.tensor(np.asarray(batch_actions)), torch.tensor(np.asarray(batch_log_probs)), torch.tensor(advantages), torch.tensor(returns), torch.tensor(policy_masks))
            losses: list[float] = []
            indices = np.arange(len(batch_rewards))
            for _ in range(int(config["epochs"])):
                np.random.shuffle(indices)
                for start in range(0, len(indices), int(config["minibatchSize"])):
                    selected = indices[start:start + int(config["minibatchSize"])]
                    obs_t, action_t, old_log_t, advantage_t, return_t, policy_mask_t = (tensor[selected] for tensor in tensors)
                    mean, value, log_std = network(obs_t); distribution = torch.distributions.Normal(mean, log_std.exp()); new_log = distribution.log_prob(action_t).sum(-1); entropy = masked_mean(distribution.entropy().sum(-1), policy_mask_t)
                    ratio = (new_log - old_log_t).exp(); clipped = torch.clamp(ratio, 1.0 - float(config["clipRatio"]), 1.0 + float(config["clipRatio"]))
                    policy_loss = -masked_mean(torch.min(ratio * advantage_t, clipped * advantage_t), policy_mask_t); value_loss = 0.5 * torch.square(value - return_t).mean()
                    residual_penalty = float(config.get("residualPenalty", 0.0)) * masked_mean(torch.square(mean).mean(dim=-1), policy_mask_t)
                    loss = policy_loss + value_loss + residual_penalty - float(config["entropyCoefficient"]) * entropy
                    optimizer.zero_grad(); loss.backward(); torch.nn.utils.clip_grad_norm_(network.parameters(), 0.5); optimizer.step(); losses.append(float(loss.item()))
            metrics.append({
                "steps": completed_steps, "meanLoss": float(np.mean(losses)), "meanEpisodeReward": float(np.mean(completed_rewards[-10:])) if completed_rewards else episode_reward,
                "meanBaseReward": float(np.mean(batch_base_rewards)), "meanQualityPenalty": float(np.mean(batch_quality_penalties)),
                "meanQualityTerms": {name: float(np.mean(values)) if values else 0.0 for name, values in batch_quality_terms.items()},
                "meanMissionReward": float(np.mean(batch_mission_bonuses)),
                "meanMissionTerms": {name: float(np.mean(values)) if values else 0.0 for name, values in batch_mission_terms.items()},
                "meanRecoveryReward": float(np.mean(batch_recovery_bonuses)),
                "meanRecoveryTerms": {name: float(np.mean(values)) if values else 0.0 for name, values in batch_recovery_terms.items()},
                "meanResidualGateScale": float(np.mean(batch_residual_gate_scales)) if batch_residual_gate_scales else None,
                "meanResidualL2": float(np.mean(batch_residual_l2)) if batch_residual_l2 else None,
                "activePolicyFraction": float(np.mean(policy_masks > 0.0)),
            })

        torch.save(network.state_dict(), output_dir / "model.pt")
        if action_transform and action_transform.get("kind") == "program-controller-residual":
            prior_dir = output_dir / "prior"; prior_definition = request["priorController"]
            shutil.copytree(Path(request["priorControllerRoot"]), prior_dir, ignore=shutil.ignore_patterns(".DS_Store", "__pycache__"))
            action_transform = {**action_transform, "controllerId": prior_definition["id"], "controllerHash": request["priorControllerHash"]}
        write_json(output_dir / "architecture.json", {**architecture, "actionTransform": action_transform})
        write_json(output_dir / "normalizer.json", {"count": normalizer.count, "mean": normalizer.mean.tolist(), "variance": normalizer.variance.tolist()})
        write_json(output_dir / "training-metrics.json", {
            "updates": metrics, "totalSteps": completed_steps, "episodes": len(completed_rewards),
            "finalMeanEpisodeReward": float(np.mean(completed_rewards[-10:])) if completed_rewards else episode_reward,
            "qualityRewardReferences": QUALITY_REWARD_REFERENCES,
            "trainingMode": "mission-progression" if progression else "curriculum",
            "curriculumSampling": curriculum_sampling,
            "domainProfile": {
                "id": request["domainProfile"]["id"],
                "hash": request["domainProfileHash"],
                "evidenceHash": request.get("domainProfileEvidenceHash"),
                "provenance": request["domainProfile"]["provenance"],
            } if request.get("domainProfile") else None,
            "domainSamples": domain_samples,
            "domainCoverage": summarize_domain_samples(domain_samples),
            "curriculumCoverage": {
                str(entry["id"]): {
                    "role": entry["role"],
                    "weight": float(entry["weight"]),
                    "targetStepShare": float(weights[index]),
                    "episodesStarted": sum(sample["curriculum"] == entry["id"] for sample in domain_samples),
                    "episodesCompleted": sum(sample["curriculum"] == entry["id"] and sample["completed"] for sample in domain_samples),
                    "steps": int(curriculum_step_counts[index]),
                    "actualStepShare": float(curriculum_step_counts[index] / completed_steps),
                    "stepShareDeviation": float(curriculum_step_counts[index] / completed_steps - weights[index]),
                    "activePolicySteps": int(curriculum_active_policy_steps[index]),
                    "activePolicyFraction": float(curriculum_active_policy_steps[index] / max(curriculum_step_counts[index], 1)),
                    "meanActorAuthority": float(curriculum_actor_authority_sums[index] / max(curriculum_step_counts[index], 1)),
                    "meanLearningReward": float(curriculum_learning_reward_sums[index] / max(curriculum_step_counts[index], 1)),
                }
                for index, entry in enumerate(curriculum)
            } if not progression else None,
            "missionProgression": {
                str(entry["id"]): {
                    "throughPhase": entry["throughPhase"],
                    "scheduledStartStep": 0 if index == 0 else int(curriculum[index - 1]["untilStep"]),
                    "scheduledUntilStep": int(entry["untilStep"]),
                    "episodeEndSeconds": float(entry["episodeEndSeconds"]),
                    "domainProfileId": entry["domainProfile"]["id"] if entry.get("domainProfile") else (
                        request["domainProfile"]["id"] if request.get("domainProfile") else None
                    ),
                    "domainProfileHash": entry.get("domainProfileHash") or request.get("domainProfileHash"),
                    "episodesStarted": sum(sample["curriculum"] == entry["id"] for sample in domain_samples),
                    "episodesCompleted": sum(sample["curriculum"] == entry["id"] and sample["completed"] for sample in domain_samples),
                    "steps": int(curriculum_step_counts[index]),
                    "observedStartStep": min(
                        (int(sample["globalStepStart"]) for sample in domain_samples if sample["curriculum"] == entry["id"]),
                        default=None,
                    ),
                    "observedEndStep": max(
                        (int(sample["globalStepStart"]) + int(sample["steps"]) for sample in domain_samples if sample["curriculum"] == entry["id"]),
                        default=None,
                    ),
                    "activePolicySteps": int(curriculum_active_policy_steps[index]),
                    "activePolicyFraction": float(curriculum_active_policy_steps[index] / max(curriculum_step_counts[index], 1)),
                    "meanActorAuthority": float(curriculum_actor_authority_sums[index] / max(curriculum_step_counts[index], 1)),
                    "meanLearningReward": float(curriculum_learning_reward_sums[index] / max(curriculum_step_counts[index], 1)),
                }
                for index, entry in enumerate(curriculum)
            } if progression else None,
            "missionPhaseCoverage": {
                key: {
                    "curriculum": sample["curriculum"],
                    "role": sample["role"],
                    "task": sample["task"],
                    "phase": sample["phase"],
                    "intent": sample["intent"],
                    "steps": sample["steps"],
                    "activePolicySteps": sample["activePolicySteps"],
                    "activePolicyFraction": sample["activePolicySteps"] / sample["steps"],
                    "meanActorAuthority": sample["actorAuthoritySum"] / sample["steps"],
                    "meanBaseReward": sample["baseRewardSum"] / sample["steps"],
                    "meanMissionReward": sample["missionRewardSum"] / sample["steps"],
                    "meanRecoveryReward": sample["recoveryRewardSum"] / sample["steps"],
                    "meanLearningReward": sample["learningRewardSum"] / sample["steps"],
                    "meanQualityPenalty": sample["qualityPenaltySum"] / sample["steps"],
                    "commandedProgressM": sample["commandedProgressM"],
                }
                for key, sample in mission_phase_samples.items()
            },
        })
        return {"totalSteps": completed_steps, "updates": len(metrics), "episodes": len(completed_rewards), "finalMeanEpisodeReward": float(np.mean(completed_rewards[-10:])) if completed_rewards else episode_reward}


def assert_domain_profile_plant_compatible(request: dict[str, Any]) -> None:
    profiles = [request.get("domainProfile")]
    profiles.extend(stage.get("domainProfile") for stage in request.get("progression") or [])
    for profile in profiles:
        if profile and profile.get("plantHash") is not None and profile["plantHash"] != request["compiled"]["plantHash"]:
            raise RuntimeError(f"Training Domain Profile '{profile['id']}' plantHash does not match compiled Assembly '{request['compiled']['id']}'")


def train(request: dict[str, Any]) -> dict[str, Any]:
    project_dir = Path(request["projectDir"]); trainer_root = Path(request["trainerRoot"]); definition = request["trainer"]
    assert_domain_profile_plant_compatible(request)
    module = load_python_module((trainer_root / definition["entry"]).resolve(), f"mujica_trainer_{definition['id'].replace('-', '_')}")
    trainer = module.create_trainer()
    run_key = hash_json({"runtimeVersion": request["runtimeVersion"], "runtimeSourceHash": request["runtimeSourceHash"], "harnessSourceHash": request["harnessSourceHash"], "harnessDependencyLockHash": request["harnessDependencyLockHash"], "mujocoVersion": mujoco.__version__, "torchVersion": torch.__version__, "assemblyHash": request["compiled"]["assemblyHash"], "plantHash": request["compiled"]["plantHash"], "trainerHash": request["trainerHash"], "priorControllerHash": request.get("priorControllerHash"), "domainProfile": request.get("domainProfile"), "domainProfileHash": request.get("domainProfileHash"), "domainProfileEvidenceHash": request.get("domainProfileEvidenceHash"), "training": request["training"], "task": request.get("task"), "scenarios": request.get("scenarios"), "curriculum": request.get("curriculum"), "progression": request.get("progression"), "seed": request["seed"], "dependencyLockHash": request["dependencyLockHash"]})
    training_run_id = f"training-{run_key[:16]}"; training_run = project_dir / "training-runs" / training_run_id
    if (training_run / "manifest.json").exists(): return {**json.loads((training_run / "result.json").read_text()), "artifactPath": str(training_run), "cached": True}
    policy_result: dict[str, Any] = {}

    def run_writer(directory: Path) -> None:
        nonlocal policy_result
        work = directory / "work"; work.mkdir()
        started = time.time(); training_metrics = trainer.train(request, work); elapsed = time.time() - started
        model_hash = hash_file(work / "model.pt")
        observation_hash = hash_json(request["compiled"]["observationContract"]); action_hash = hash_json(request["compiled"]["actionContract"])
        policy_identity = {"runtimeVersion": request["runtimeVersion"], "runtimeSourceHash": request["runtimeSourceHash"], "harnessSourceHash": request["harnessSourceHash"], "harnessDependencyLockHash": request["harnessDependencyLockHash"], "mujocoVersion": mujoco.__version__, "torchVersion": torch.__version__, "trainerHash": request["trainerHash"], "priorControllerHash": request.get("priorControllerHash"), "domainProfileId": request["domainProfile"]["id"] if request.get("domainProfile") else None, "domainProfileHash": request.get("domainProfileHash"), "domainProfileEvidenceHash": request.get("domainProfileEvidenceHash"), "trainingHash": hash_json(request["training"]), "assemblyHash": request["compiled"]["assemblyHash"], "executionHash": request["compiled"]["executionHash"], "modelXmlHash": request["compiled"]["modelHash"], "plantHash": request["compiled"]["plantHash"], "catalogHash": request["compiled"]["catalogHash"], "observationContractHash": observation_hash, "actionContractHash": action_hash, "taskHash": hash_json(request["task"]) if request.get("task") else None, "scenarioHashes": [hash_json(item) for item in request.get("scenarios", [])], "curriculumHash": hash_json(request["curriculum"]) if request.get("curriculum") else None, "progressionHash": hash_json(request["progression"]) if request.get("progression") else None, "seed": request["seed"], "budget": request["training"]["totalSteps"], "dependencyLockHash": request["dependencyLockHash"], "modelHash": model_hash}
        policy_id = f"{request['training']['id']}-{hash_json(policy_identity)[:16]}"; policy_dir = project_dir / "policies" / policy_id
        reuse_policy = False
        if policy_dir.exists():
            existing = json.loads((policy_dir / "manifest.json").read_text())
            if existing.get("modelHash") != model_hash: raise RuntimeError(f"Policy identity collision with different model: {policy_dir}")
            reuse_policy = True

        def policy_writer(target: Path) -> None:
            for name in ["model.pt", "architecture.json", "normalizer.json", "training-metrics.json"]: shutil.copy2(work / name, target / name)
            if (work / "prior").exists(): shutil.copytree(work / "prior", target / "prior")
            write_json(target / "observation-contract.json", request["compiled"]["observationContract"]); write_json(target / "action-contract.json", request["compiled"]["actionContract"])
            write_json(target / "training-config.json", request["training"]); write_json(target / "source-hashes.json", request["sourceHashes"])
            if request.get("domainProfile"):
                write_json(target / "domain-profile.json", {
                    "definition": request["domainProfile"],
                    "evidenceHash": request.get("domainProfileEvidenceHash"),
                    "hash": request["domainProfileHash"],
                })
            if request.get("progression"):
                write_json(target / "mission-progression.json", [{
                    "id": stage["id"],
                    "throughPhase": stage["throughPhase"],
                    "untilStep": stage["untilStep"],
                    "domainProfile": stage.get("domainProfile"),
                    "domainProfileEvidenceHash": stage.get("domainProfileEvidenceHash"),
                    "domainProfileHash": stage.get("domainProfileHash"),
                } for stage in request["progression"]])
            write_json(target / "manifest.json", {"version": 1, "id": policy_id, **policy_identity, "hardware": hardware_info(), "trainingDeterminism": "best-effort", "evaluationDeterminism": "same-environment-bitwise-intended", "createdByTrainingRun": training_run_id})
        if not reuse_policy: atomic_directory(policy_dir, policy_writer)
        policy_result = {"trainingRunId": training_run_id, "policyId": policy_id, "policyPath": str(policy_dir), "modelHash": model_hash, "trainingMetrics": training_metrics, "elapsedSeconds": elapsed}
        write_json(directory / "request.json", request); write_json(directory / "result.json", policy_result)
        write_json(directory / "manifest.json", {"version": 1, "id": training_run_id, "runKey": run_key, "policyId": policy_id, "completed": True})
        shutil.rmtree(work)
    atomic_directory(training_run, run_writer)
    return {**policy_result, "artifactPath": str(training_run), "cached": False}
