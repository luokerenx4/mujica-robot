from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import mujoco
import numpy as np

from .controllers import load_policy_controller, load_program_controller
from .environment import RobotEnvironment
from .io import atomic_directory, hash_json, sha256_bytes, write_json


def motion_metrics(initial_position: np.ndarray, final_position: np.ndarray, distance_traveled: float, task: dict[str, Any], duration_seconds: float) -> dict[str, Any]:
    displacement = np.asarray(final_position, dtype=np.float64) - np.asarray(initial_position, dtype=np.float64)
    target = np.asarray(task["targetVelocity"], dtype=np.float64)
    target_speed = float(np.linalg.norm(target[:2]))
    target_distance = target_speed * float(task["durationSeconds"])
    if target_speed > 1e-9:
        direction = target[:2] / target_speed
        forward_displacement = float(np.dot(displacement[:2], direction))
        lateral_vector = displacement[:2] - forward_displacement * direction
        forward_progress = float(np.clip(forward_displacement / target_distance, 0.0, 1.0))
    else:
        forward_displacement = 0.0
        lateral_vector = displacement[:2]
        forward_progress = 1.0
    return {
        "initialBasePosition": np.asarray(initial_position, dtype=np.float64).tolist(),
        "finalBasePosition": np.asarray(final_position, dtype=np.float64).tolist(),
        "netDisplacement": displacement.tolist(),
        "forwardDisplacement": forward_displacement,
        "targetDistance": target_distance,
        "forwardProgress": forward_progress,
        "meanForwardVelocity": forward_displacement / max(float(duration_seconds), 1e-9),
        "lateralDrift": float(np.linalg.norm(lateral_vector)),
        "distanceTraveled": float(distance_traveled),
    }


def episode_survival_rate(healthy_steps: int, planned_steps: int) -> float:
    """Measure survival against the requested episode, not the truncated trace."""
    return float(healthy_steps) / max(1, int(planned_steps))


def score_metrics(metrics: dict[str, Any], objective: dict[str, Any], compiled: dict[str, Any], training_steps: int = 0) -> dict[str, Any]:
    weights = objective["weights"]
    terms = {
        "survival": weights["survival"] * metrics["survivalRate"],
        "velocityTracking": weights["velocityTracking"] * (1.0 / (1.0 + metrics["meanVelocityTrackingError"])),
        "forwardProgress": weights.get("forwardProgress", 0.0) * metrics["forwardProgress"],
        "upright": weights["upright"] * metrics["meanUpright"],
        "lateralDrift": -weights.get("lateralDrift", 0.0) * metrics["lateralDrift"],
        "energy": -weights["energy"] * metrics["meanEnergy"],
        "smoothness": -weights["smoothness"] * metrics["meanSmoothness"],
        "componentMass": -weights["componentMass"] * compiled["totalMassKg"],
        "sensorChannels": -weights["sensorChannels"] * compiled["sensorChannelCount"],
        "trainingSteps": -weights["trainingSteps"] * training_steps,
    }
    return {"terms": terms, "total": float(sum(terms.values()))}


def validate_model(request: dict[str, Any]) -> dict[str, Any]:
    model = mujoco.MjModel.from_xml_path(request["modelPath"])
    compiled = request["compiled"]
    if model.nu != compiled["actionContract"]["size"]:
        raise RuntimeError(f"Compiled action contract has size {compiled['actionContract']['size']}, MuJoCo model has {model.nu} controls")
    return {"mujocoVersion": mujoco.__version__, "nq": model.nq, "nv": model.nv, "nu": model.nu, "nsensor": model.nsensor, "timestep": model.opt.timestep}


def simulate(request: dict[str, Any], persist: bool = True) -> dict[str, Any]:
    project_dir = Path(request["projectDir"])
    compiled = request["compiled"]
    controller_definition = request["controller"]
    if controller_definition["kind"] == "program":
        controller = load_program_controller(Path(request["controllerRoot"]), controller_definition)
    else:
        controller = load_policy_controller(project_dir, controller_definition, compiled)
    controller.reset(int(request["seed"]))
    environment = RobotEnvironment(Path(request["modelPath"]), compiled, request["task"], request["scenario"], int(request["seed"]))
    observation = environment.reset()
    initial_position = environment.data.qpos[:3].copy()
    previous_position = initial_position.copy()
    distance_traveled = 0.0
    trajectory: list[dict[str, Any]] = []
    totals = {"velocityError": 0.0, "upright": 0.0, "energy": 0.0, "smoothness": 0.0}
    survived_steps = 0
    fell = False
    previous_pushing = False
    while True:
        action = controller.act({name: values.copy() for name, values in observation.items()}, float(environment.data.time))
        result = environment.step(action)
        current_position = environment.data.qpos[:3].copy()
        distance_traveled += float(np.linalg.norm(current_position[:2] - previous_position[:2]))
        previous_position = current_position
        info = result.info
        if info["healthy"]: survived_steps += 1
        if info["pushing"] and not previous_pushing: environment.events.append({"type": "scenario.push-start", "time": float(environment.data.time), "forceNewton": request["scenario"]["lateralPush"]["forceNewton"]})
        if previous_pushing and not info["pushing"]: environment.events.append({"type": "scenario.push-end", "time": float(environment.data.time)})
        previous_pushing = bool(info["pushing"])
        for key in totals: totals[key] += float(info[key])
        trajectory.append({"step": environment.step_index, "time": float(environment.data.time), "qpos": environment.data.qpos.tolist(), "qvel": environment.data.qvel.tolist(), "action": np.asarray(info["appliedAction"]).tolist(), "reward": result.reward, "healthy": info["healthy"]})
        observation = result.observation
        if result.terminated:
            fell = True
            environment.events.append({"type": "robot.fall", "time": float(environment.data.time), "height": info["height"]})
        if result.terminated or result.truncated: break
    steps = max(1, environment.step_index)
    metrics = {
        "durationSeconds": float(environment.data.time), "steps": environment.step_index, "survivalRate": episode_survival_rate(survived_steps, environment.max_steps),
        "fell": fell, "meanVelocityTrackingError": totals["velocityError"] / steps, "meanUpright": totals["upright"] / steps,
        "meanEnergy": totals["energy"] / steps, "meanSmoothness": totals["smoothness"] / steps,
        "peakActuator": max((max(abs(value) for value in row["action"]) for row in trajectory), default=0.0),
        **motion_metrics(initial_position, environment.data.qpos[:3], distance_traveled, request["task"], float(environment.data.time)),
    }
    score = score_metrics(metrics, request["objective"], compiled, int(request.get("trainingSteps", 0)))
    environment.events.append({"type": "episode.completed", "time": float(environment.data.time), "steps": environment.step_index, "score": score["total"]})
    run_key = hash_json({"runtimeVersion": request["runtimeVersion"], "runtimeSourceHash": request["runtimeSourceHash"], "harnessSourceHash": request["harnessSourceHash"], "mujocoVersion": mujoco.__version__, "assemblyHash": compiled["assemblyHash"], "controllerHash": request["controllerHash"], "trainingSteps": request.get("trainingSteps", 0), "task": request["task"], "scenario": request["scenario"], "objective": request["objective"], "seed": request["seed"]})
    result_hash = hash_json({"runKey": run_key, "events": environment.events, "trajectory": trajectory, "metrics": metrics, "score": score})
    output = {"runId": f"run-{run_key[:16]}", "runKey": run_key, "resultHash": result_hash, "metrics": metrics, "score": score, "events": environment.events}
    if not persist: return output
    target = project_dir / "runs" / output["runId"]
    if (target / "manifest.json").exists():
        existing = json.loads((target / "manifest.json").read_text())
        if existing["resultHash"] != result_hash: raise RuntimeError("Deterministic run key produced a different result")
        return {**output, "artifactPath": str(target), "cached": True}

    def writer(directory: Path) -> None:
        write_json(directory / "inputs" / "compiled-assembly.json", compiled)
        write_json(directory / "inputs" / "controller.json", controller_definition)
        write_json(directory / "inputs" / "task.json", request["task"])
        write_json(directory / "inputs" / "scenario.json", request["scenario"])
        write_json(directory / "inputs" / "objective.json", request["objective"])
        with (directory / "events.ndjson").open("w") as stream:
            for event in environment.events: stream.write(json.dumps(event, separators=(",", ":")) + "\n")
        with (directory / "trajectory.ndjson").open("w") as stream:
            for row in trajectory: stream.write(json.dumps(row, separators=(",", ":")) + "\n")
        write_json(directory / "metrics.json", metrics)
        write_json(directory / "score.json", score)
        (directory / "report.md").write_text(f"# Mujica simulation run\n\n- Run: `{output['runId']}`\n- Score: `{score['total']:.6f}`\n- Survival: `{metrics['survivalRate']:.3f}`\n- Fell: `{metrics['fell']}`\n")
        write_json(directory / "manifest.json", {"version": 1, "id": output["runId"], "runKey": run_key, "resultHash": result_hash, "runtimeVersion": request["runtimeVersion"], "runtimeSourceHash": request["runtimeSourceHash"], "harnessSourceHash": request["harnessSourceHash"], "assemblyHash": compiled["assemblyHash"], "controllerHash": request["controllerHash"], "trainingSteps": request.get("trainingSteps", 0), "seed": request["seed"], "mujocoVersion": mujoco.__version__, "completed": True})
    atomic_directory(target, writer)
    return {**output, "artifactPath": str(target), "cached": False}
