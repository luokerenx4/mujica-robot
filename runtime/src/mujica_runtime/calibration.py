from __future__ import annotations

import json
from itertools import product
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import mujoco
import numpy as np

from .io import atomic_directory, hash_file, hash_json, write_json


CONTINUOUS_PARAMETERS = (
    "bodyMassScale",
    "jointDampingScale",
    "actuatorStrengthScale",
    "frictionScale",
)


@dataclass
class Episode:
    source_id: str
    episode_id: str
    qpos: list[np.ndarray]
    qvel: list[np.ndarray]
    commands: list[np.ndarray]


def _vector(value: Any, size: int, label: str) -> np.ndarray:
    result = np.asarray(value, dtype=np.float64).reshape(-1)
    if result.size != size:
        raise RuntimeError(f"{label} expected {size} values, got {result.size}")
    if not np.isfinite(result).all():
        raise RuntimeError(f"{label} contains non-finite values")
    return result


def _validate_steps(rows: list[dict[str, Any]], episode_id: str, control_hz: float) -> None:
    if len(rows) < 2:
        raise RuntimeError(f"Calibration episode '{episode_id}' requires at least two state rows")
    for index, row in enumerate(rows):
        if int(row["step"]) != index:
            raise RuntimeError(f"Calibration episode '{episode_id}' steps must be contiguous from zero")
        expected_time = index / control_hz
        if abs(float(row["time"]) - expected_time) > 1e-8:
            raise RuntimeError(f"Calibration episode '{episode_id}' time at step {index} is off the control grid")


def _load_run_source(source: dict[str, Any], nq: int, nv: int, nu: int, control_hz: float) -> list[Episode]:
    initial_path = Path(source["initialStatePath"])
    trajectory_path = Path(source["trajectoryPath"])
    if hash_file(initial_path) != source["initialStateHash"]:
        raise RuntimeError(f"Calibration source '{source['id']}' initial-state hash differs")
    if hash_file(trajectory_path) != source["trajectoryHash"]:
        raise RuntimeError(f"Calibration source '{source['id']}' trajectory hash differs")
    initial = json.loads(initial_path.read_text())
    trajectory = [json.loads(line) for line in trajectory_path.read_text().splitlines() if line.strip()]
    if not trajectory:
        raise RuntimeError(f"Calibration source '{source['id']}' trajectory is empty")
    rows = [{
        "episode": source["id"],
        "step": 0,
        "time": 0.0,
        "qpos": initial["qpos"],
        "qvel": initial["qvel"],
        "commandedAction": trajectory[0].get("commandedAction"),
    }]
    for index, row in enumerate(trajectory, start=1):
        next_command = trajectory[index].get("commandedAction") if index < len(trajectory) else np.zeros(nu).tolist()
        rows.append({
            "episode": source["id"],
            "step": index,
            "time": index / control_hz,
            "qpos": row["qpos"],
            "qvel": row["qvel"],
            "commandedAction": next_command,
        })
    _validate_steps(rows, source["id"], control_hz)
    return [Episode(
        source_id=source["id"],
        episode_id=source["id"],
        qpos=[_vector(row["qpos"], nq, f"{source['id']} qpos") for row in rows],
        qvel=[_vector(row["qvel"], nv, f"{source['id']} qvel") for row in rows],
        commands=[_vector(row["commandedAction"], nu, f"{source['id']} commandedAction") for row in rows[:-1]],
    )]


def _load_capture_source(source: dict[str, Any], nq: int, nv: int, nu: int, control_hz: float) -> list[Episode]:
    path = Path(source["path"])
    if hash_file(path) != source["hash"]:
        raise RuntimeError(f"Calibration capture '{source['id']}' hash differs")
    raw = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    by_episode: dict[str, list[dict[str, Any]]] = {}
    episode_order: list[str] = []
    for row in raw:
        episode_id = str(row.get("episode", ""))
        if not episode_id:
            raise RuntimeError(f"Calibration capture '{source['id']}' contains an empty episode id")
        if episode_id not in by_episode:
            by_episode[episode_id] = []
            episode_order.append(episode_id)
        by_episode[episode_id].append(row)
    if not episode_order:
        raise RuntimeError(f"Calibration capture '{source['id']}' is empty")
    episodes: list[Episode] = []
    for episode_id in episode_order:
        rows = by_episode[episode_id]
        _validate_steps(rows, episode_id, control_hz)
        episodes.append(Episode(
            source_id=source["id"],
            episode_id=episode_id,
            qpos=[_vector(row["qpos"], nq, f"{episode_id} qpos") for row in rows],
            qvel=[_vector(row["qvel"], nv, f"{episode_id} qvel") for row in rows],
            commands=[_vector(row["commandedAction"], nu, f"{episode_id} commandedAction") for row in rows[:-1]],
        ))
    return episodes


class OneStepEstimator:
    def __init__(self, model_path: Path, control_hz: float, base_scenario: dict[str, Any], sources: list[dict[str, Any]]):
        self.model = mujoco.MjModel.from_xml_path(str(model_path))
        self.data = mujoco.MjData(self.model)
        self.control_hz = float(control_hz)
        self.physics_steps = max(1, round((1.0 / self.control_hz) / self.model.opt.timestep))
        if abs(self.physics_steps * self.model.opt.timestep - 1.0 / self.control_hz) > 1e-9:
            raise RuntimeError("Calibration controlHz does not align to the MuJoCo timestep")
        self.model.geom_friction[:, 0] = float(base_scenario["friction"])
        self.base_mass = self.model.body_mass.copy()
        self.torso = mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_BODY, "torso")
        self.payload_kg = float(base_scenario["payloadKg"])
        self.base_inertia = self.model.body_inertia.copy()
        self.base_damping = self.model.dof_damping.copy()
        self.base_gain = self.model.actuator_gainprm.copy()
        self.base_friction = self.model.geom_friction.copy()
        has_free_root = self.model.njnt > 0 and int(self.model.jnt_type[0]) == int(mujoco.mjtJoint.mjJNT_FREE) and int(self.model.jnt_qposadr[0]) == 0
        self.joint_qpos_start = 7 if has_free_root else 0
        self.joint_qvel_start = 6 if has_free_root else 0
        self.has_free_root = has_free_root
        self.episodes_by_source: list[list[Episode]] = []
        self.source_ids: list[str] = []
        for source in sources:
            self.source_ids.append(str(source["id"]))
            if source["kind"] == "simulation-run":
                self.episodes_by_source.append(_load_run_source(source, self.model.nq, self.model.nv, self.model.nu, self.control_hz))
            else:
                self.episodes_by_source.append(_load_capture_source(source, self.model.nq, self.model.nv, self.model.nu, self.control_hz))

    def _apply(self, parameters: dict[str, float | int]) -> None:
        mass = float(parameters.get("bodyMassScale", 1.0))
        self.model.body_mass[:] = self.base_mass * mass
        if self.torso >= 0:
            self.model.body_mass[self.torso] += self.payload_kg
        self.model.body_inertia[:] = self.base_inertia * mass
        self.model.dof_damping[:] = self.base_damping * float(parameters.get("jointDampingScale", 1.0))
        self.model.actuator_gainprm[:] = self.base_gain
        self.model.actuator_gainprm[:, 0] *= float(parameters.get("actuatorStrengthScale", 1.0))
        self.model.geom_friction[:] = self.base_friction
        self.model.geom_friction[:, 0] *= float(parameters.get("frictionScale", 1.0))

    def evaluate(self, parameters: dict[str, float | int], source_indices: list[int]) -> dict[str, Any]:
        self._apply(parameters)
        delay = int(parameters.get("actuatorDelaySteps", 0))
        squared = {
            "jointPosition": 0.0,
            "jointVelocity": 0.0,
            "basePosition": 0.0,
            "baseOrientation": 0.0,
            "baseVelocity": 0.0,
        }
        counts = {name: 0 for name in squared}
        per_source: list[dict[str, Any]] = []
        for source_index in source_indices:
            source_loss = 0.0
            transitions = 0
            for episode in self.episodes_by_source[source_index]:
                for step, command in enumerate(episode.commands):
                    delayed = episode.commands[step - delay] if step >= delay else np.zeros(self.model.nu, dtype=np.float64)
                    mujoco.mj_resetData(self.model, self.data)
                    self.data.qpos[:] = episode.qpos[step]
                    self.data.qvel[:] = episode.qvel[step]
                    self.data.ctrl[:] = delayed
                    mujoco.mj_forward(self.model, self.data)
                    for _ in range(self.physics_steps):
                        mujoco.mj_step(self.model, self.data)
                    expected_qpos = episode.qpos[step + 1]
                    expected_qvel = episode.qvel[step + 1]
                    joint_position = self.data.qpos[self.joint_qpos_start:] - expected_qpos[self.joint_qpos_start:]
                    joint_velocity = self.data.qvel[self.joint_qvel_start:] - expected_qvel[self.joint_qvel_start:]
                    if self.has_free_root:
                        base_position = self.data.qpos[:3] - expected_qpos[:3]
                        predicted_quaternion = self.data.qpos[3:7].copy()
                        expected_quaternion = expected_qpos[3:7].copy()
                        if float(np.dot(predicted_quaternion, expected_quaternion)) < 0:
                            predicted_quaternion *= -1
                        base_orientation = predicted_quaternion - expected_quaternion
                        base_velocity = self.data.qvel[:6] - expected_qvel[:6]
                    else:
                        base_position = np.zeros(0, dtype=np.float64)
                        base_orientation = np.zeros(0, dtype=np.float64)
                        base_velocity = np.zeros(0, dtype=np.float64)
                    values = {
                        "jointPosition": joint_position,
                        "jointVelocity": joint_velocity,
                        "basePosition": base_position,
                        "baseOrientation": base_orientation,
                        "baseVelocity": base_velocity,
                    }
                    for name, value in values.items():
                        squared[name] += float(np.sum(np.square(value)))
                        counts[name] += int(value.size)
                    transitions += 1
            per_source.append({"source": self.source_ids[source_index], "transitions": transitions})
        rmse = {name: float(np.sqrt(squared[name] / counts[name])) if counts[name] else 0.0 for name in squared}
        normalized_terms = {
            "jointPosition": (rmse["jointPosition"] / 0.1) ** 2,
            "jointVelocity": (rmse["jointVelocity"] / 1.0) ** 2,
            "basePosition": (rmse["basePosition"] / 0.05) ** 2,
            "baseOrientation": (rmse["baseOrientation"] / 0.1) ** 2,
            "baseVelocity": (rmse["baseVelocity"] / 0.5) ** 2,
        }
        loss = float(sum(normalized_terms.values()))
        return {
            "loss": loss,
            "rmse": rmse,
            "normalizedTerms": normalized_terms,
            "transitions": sum(item["transitions"] for item in per_source),
            "sources": per_source,
        }


def _clipped_nominal(bounds: dict[str, Any], nominal: float) -> float:
    return float(np.clip(nominal, float(bounds["minimum"]), float(bounds["maximum"])))


def _fit(estimator: OneStepEstimator, definition: dict[str, Any]) -> dict[str, Any]:
    declared = definition["parameters"]
    validation_count = int(definition["optimizer"]["validationSources"])
    fit_indices = list(range(len(definition["sources"]) - validation_count))
    validation_indices = list(range(len(definition["sources"]) - validation_count, len(definition["sources"])))
    continuous = [name for name in CONTINUOUS_PARAMETERS if name in declared]
    delay_bounds = declared.get("actuatorDelaySteps")
    delays = list(range(int(delay_bounds["minimum"]), int(delay_bounds["maximum"]) + 1)) if delay_bounds else [0]
    trace: list[dict[str, Any]] = []
    finalists: list[tuple[float, tuple[float, ...], dict[str, float | int], dict[str, Any]]] = []
    for delay in delays:
        current: dict[str, float | int] = {name: _clipped_nominal(declared[name], 1.0) for name in continuous}
        if delay_bounds:
            current["actuatorDelaySteps"] = delay
        windows = {name: [float(declared[name]["minimum"]), float(declared[name]["maximum"])] for name in continuous}
        if continuous:
            grids = [np.linspace(windows[name][0], windows[name][1], int(definition["optimizer"]["samplesPerAxis"])) for name in continuous]
            joint_candidates: list[tuple[float, tuple[float, ...], dict[str, float | int]]] = []
            for values in product(*grids):
                proposal = {**current, **{name: float(value) for name, value in zip(continuous, values)}}
                metrics = estimator.evaluate(proposal, fit_indices)
                trace.append({"delay": delay, "round": 1, "parameter": "__joint__", "values": proposal, "loss": metrics["loss"]})
                joint_candidates.append((float(metrics["loss"]), tuple(float(value) for value in values), proposal))
            joint_candidates.sort(key=lambda item: (item[0], item[1]))
            current = dict(joint_candidates[0][2])
            for name, grid in zip(continuous, grids):
                selected = float(current[name])
                spacing = float(grid[1] - grid[0])
                bounds = declared[name]
                windows[name] = [
                    max(float(bounds["minimum"]), selected - spacing),
                    min(float(bounds["maximum"]), selected + spacing),
                ]
        for round_index in range(1, int(definition["optimizer"]["rounds"])):
            for name in continuous:
                low, high = windows[name]
                values = np.linspace(low, high, int(definition["optimizer"]["samplesPerAxis"]))
                candidates: list[tuple[float, float, dict[str, Any]]] = []
                for value in values:
                    proposal = {**current, name: float(value)}
                    metrics = estimator.evaluate(proposal, fit_indices)
                    trace.append({"delay": delay, "round": round_index + 1, "parameter": name, "value": float(value), "loss": metrics["loss"]})
                    candidates.append((float(metrics["loss"]), float(value), metrics))
                candidates.sort(key=lambda item: (item[0], item[1]))
                _, selected, _ = candidates[0]
                current[name] = selected
                spacing = (high - low) / max(1, len(values) - 1)
                bounds = declared[name]
                windows[name] = [
                    max(float(bounds["minimum"]), selected - spacing),
                    min(float(bounds["maximum"]), selected + spacing),
                ]
        fit_metrics = estimator.evaluate(current, fit_indices)
        key = tuple(float(current.get(name, 1.0)) for name in CONTINUOUS_PARAMETERS) + (float(delay),)
        finalists.append((float(fit_metrics["loss"]), key, dict(current), fit_metrics))
    finalists.sort(key=lambda item: (item[0], item[1]))
    _, _, parameters, fit_metrics = finalists[0]
    validation_metrics = estimator.evaluate(parameters, validation_indices)
    return {
        "parameters": parameters,
        "fitSourceIndices": fit_indices,
        "validationSourceIndices": validation_indices,
        "fit": fit_metrics,
        "validation": validation_metrics,
        "trace": trace,
    }


def _profile(definition: dict[str, Any], calibration_run_id: str, fitted: dict[str, float | int], plant_hash: str) -> dict[str, Any]:
    uncertainty = float(definition["profile"]["uncertaintyFraction"])
    parameters: dict[str, Any] = {}
    for name in CONTINUOUS_PARAMETERS:
        if name not in fitted:
            continue
        value = float(fitted[name])
        declared = definition["parameters"][name]
        parameters[name] = {
            "minimum": max(float(declared["minimum"]), value * (1.0 - uncertainty)),
            "maximum": min(float(declared["maximum"]), value * (1.0 + uncertainty)),
        }
    if "actuatorDelaySteps" in fitted:
        margin = int(definition["profile"]["delayMarginSteps"])
        value = int(fitted["actuatorDelaySteps"])
        declared = definition["parameters"]["actuatorDelaySteps"]
        parameters["actuatorDelayJitterSteps"] = {
            "minimum": max(int(declared["minimum"]), value - margin),
            "maximum": min(int(declared["maximum"]), value + margin),
        }
    provenance = definition["provenance"]
    return {
        "version": 1,
        "id": definition["profile"]["id"],
        "name": definition["profile"]["name"],
        "plantHash": plant_hash,
        "provenance": {
            "kind": provenance["kind"],
            "evidence": f"calibration-runs/{calibration_run_id}/manifest.json",
            "notes": f"Generated by Calibration '{definition['id']}' from {len(definition['sources'])} content-hashed sources. This is {provenance['kind']} evidence and does not upgrade its own authority.",
        },
        "parameters": parameters,
    }


def calibrate(request: dict[str, Any]) -> dict[str, Any]:
    model_path = Path(request["modelPath"])
    if hash_file(model_path) != request["compiled"]["modelHash"]:
        raise RuntimeError("Calibration model hash does not match the compiled Assembly")
    definition = request["calibration"]
    identity_sources = [{key: value for key, value in source.items() if not key.endswith("Path") and key != "path"} for source in request["sources"]]
    identity = {
        "runtimeVersion": request["runtimeVersion"],
        "runtimeSourceHash": request["runtimeSourceHash"],
        "harnessSourceHash": request["harnessSourceHash"],
        "mujocoVersion": mujoco.__version__,
        "assemblyHash": request["compiled"]["assemblyHash"],
        "modelHash": request["compiled"]["modelHash"],
        "plantHash": request["compiled"]["plantHash"],
        "calibration": definition,
        "baseScenario": request["baseScenario"],
        "sources": identity_sources,
    }
    calibration_run_id = f"calibration-{hash_json(identity)[:16]}"
    target = Path(request["projectDir"]) / "calibration-runs" / calibration_run_id
    if (target / "manifest.json").exists():
        manifest = json.loads((target / "manifest.json").read_text())
        result = json.loads((target / "result.json").read_text())
        fit = json.loads((target / "fit.json").read_text())
        profile = json.loads((target / "profile-proposal.json").read_text())
        expected_result_hash = hash_json({"identity": identity, "fit": fit, "profile": profile})
        if manifest.get("completed") is not True or manifest.get("id") != calibration_run_id:
            raise RuntimeError(f"Calibration Run '{calibration_run_id}' is incomplete")
        if manifest.get("resultHash") != expected_result_hash or result.get("resultHash") != expected_result_hash:
            raise RuntimeError(f"Calibration Run '{calibration_run_id}' failed result integrity verification")
        if manifest.get("profileProposalHash") != hash_json(profile):
            raise RuntimeError(f"Calibration Run '{calibration_run_id}' failed Profile integrity verification")
        return {**result, "artifactPath": str(target), "cached": True}

    estimator = OneStepEstimator(model_path, float(definition["controlHz"]), request["baseScenario"], request["sources"])
    fitted = _fit(estimator, definition)
    profile = _profile(definition, calibration_run_id, fitted["parameters"], request["compiled"]["plantHash"])
    result_hash = hash_json({"identity": identity, "fit": fitted, "profile": profile})
    result = {
        "calibrationRunId": calibration_run_id,
        "resultHash": result_hash,
        "parameters": fitted["parameters"],
        "fit": fitted["fit"],
        "validation": fitted["validation"],
        "profileId": profile["id"],
        "profileProposalHash": hash_json(profile),
    }

    def writer(directory: Path) -> None:
        write_json(directory / "request.json", {
            "identity": identity,
            "sourcePaths": [{key: value for key, value in source.items() if key.endswith("Path") or key == "path"} for source in request["sources"]],
        })
        write_json(directory / "fit.json", fitted)
        write_json(directory / "profile-proposal.json", profile)
        write_json(directory / "result.json", result)
        (directory / "report.md").write_text(
            "# Mujica Calibration Run\n\n"
            f"- Calibration: `{definition['id']}`\n"
            f"- Provenance: `{definition['provenance']['kind']}`\n"
            f"- Fit loss: `{fitted['fit']['loss']:.9f}`\n"
            f"- Validation loss: `{fitted['validation']['loss']:.9f}`\n"
            f"- Parameters: `{json.dumps(fitted['parameters'], sort_keys=True)}`\n"
            "\nCalibration error is model-fit evidence, not hardware safety verification.\n"
        )
        write_json(directory / "manifest.json", {
            "version": 1,
            "id": calibration_run_id,
            "resultHash": result_hash,
            "runtimeVersion": request["runtimeVersion"],
            "runtimeSourceHash": request["runtimeSourceHash"],
            "harnessSourceHash": request["harnessSourceHash"],
            "mujocoVersion": mujoco.__version__,
            "assembly": definition["assembly"],
            "assemblyHash": request["compiled"]["assemblyHash"],
            "modelHash": request["compiled"]["modelHash"],
            "plantHash": request["compiled"]["plantHash"],
            "calibration": definition["id"],
            "calibrationHash": hash_json(definition),
            "baseScenarioHash": hash_json(request["baseScenario"]),
            "provenance": definition["provenance"],
            "sources": identity_sources,
            "fitLoss": fitted["fit"]["loss"],
            "validationLoss": fitted["validation"]["loss"],
            "profileId": profile["id"],
            "profileProposalHash": hash_json(profile),
            "completed": True,
        })
    atomic_directory(target, writer)
    return {**result, "artifactPath": str(target), "cached": False}
