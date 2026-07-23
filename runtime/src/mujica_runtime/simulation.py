from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

import mujoco
import numpy as np

from .controllers import load_policy_controller, load_program_controller
from .environment import RobotEnvironment, compile_motion_command_schedule
from .io import atomic_directory, hash_file, hash_json, sha256_bytes, write_json


def quaternion_pitch(quaternion: np.ndarray) -> float:
    """Return intrinsic Y pitch in radians for a MuJoCo wxyz quaternion."""
    w, x, y, z = np.asarray(quaternion, dtype=np.float64)
    return float(np.arcsin(np.clip(2.0 * (w * y - z * x), -1.0, 1.0)))


def quaternion_body_tilt(quaternion: np.ndarray) -> float:
    """Return the yaw-invariant angle between body-up and world-up in radians."""
    _, x, y, _ = np.asarray(quaternion, dtype=np.float64)
    world_up_dot_body_up = 1.0 - 2.0 * (x * x + y * y)
    return float(np.arccos(np.clip(world_up_dot_body_up, -1.0, 1.0)))


def motion_metrics(initial_position: np.ndarray, final_position: np.ndarray, distance_traveled: float, task: dict[str, Any], duration_seconds: float) -> dict[str, Any]:
    displacement = np.asarray(final_position, dtype=np.float64) - np.asarray(initial_position, dtype=np.float64)
    schedule = compile_motion_command_schedule(task)
    target_displacement = np.zeros(2, dtype=np.float64)
    for index, segment in enumerate(schedule):
        end_seconds = float(schedule[index + 1]["atSeconds"]) if index + 1 < len(schedule) else float(task["durationSeconds"])
        target_displacement += np.asarray(segment["command"][:2], dtype=np.float64) * (end_seconds - float(segment["atSeconds"]))
    target_distance = float(np.linalg.norm(target_displacement))
    if target_distance > 1e-9:
        direction = target_displacement / target_distance
        forward_displacement = float(np.dot(displacement[:2], direction))
        lateral_vector = displacement[:2] - forward_displacement * direction
        forward_progress = float(np.clip(forward_displacement / target_distance, 0.0, 1.0))
        signed_forward_progress = forward_displacement / target_distance
    else:
        forward_displacement = 0.0
        lateral_vector = displacement[:2]
        forward_progress = 1.0
        signed_forward_progress = 1.0
    return {
        "initialBasePosition": np.asarray(initial_position, dtype=np.float64).tolist(),
        "finalBasePosition": np.asarray(final_position, dtype=np.float64).tolist(),
        "netDisplacement": displacement.tolist(),
        "targetPlanarDisplacement": target_displacement.tolist(),
        "forwardDisplacement": forward_displacement,
        "targetDistance": target_distance,
        "forwardProgress": forward_progress,
        "signedForwardProgress": signed_forward_progress,
        "backwardDisplacement": max(0.0, -forward_displacement),
        "meanForwardVelocity": forward_displacement / max(float(duration_seconds), 1e-9),
        "lateralDrift": float(np.linalg.norm(lateral_vector)),
        "distanceTraveled": float(distance_traveled),
    }


def transition_response_metrics(trajectory: list[dict[str, Any]], task: dict[str, Any], objective: dict[str, Any]) -> dict[str, Any]:
    schedule = compile_motion_command_schedule(task)
    measurement = objective.get("transientMeasurement", {"planarToleranceMps": 0.12, "yawRateToleranceRadPerSec": 0.25, "holdSeconds": 0.2})
    control_hz = float(task["controlHz"])
    hold_steps = max(1, int(np.ceil(float(measurement["holdSeconds"]) * control_hz - 1e-12)))

    def settling(rows: list[dict[str, Any]], values: list[np.ndarray], target: np.ndarray, dimensions: slice | int, at_step: int, tolerance: float) -> tuple[float, bool]:
        window_errors = [float(np.linalg.norm(np.mean(values[index:index + hold_steps], axis=0)[dimensions] - target[dimensions])) for index in range(0, len(values) - hold_steps + 1)]
        for index, error in enumerate(window_errors):
            if error <= tolerance and all(later <= tolerance for later in window_errors[index:]):
                end_row = rows[index + hold_steps - 1]
                return (float(int(end_row["step"]) - at_step) / control_hz, True)
        return (float(len(rows)) / control_hz, False)

    transitions: list[dict[str, Any]] = []
    for index, segment in enumerate(schedule[1:], start=1):
        at_step = int(segment["atStep"])
        end_step = int(schedule[index + 1]["atStep"]) if index + 1 < len(schedule) else round(float(task["durationSeconds"]) * control_hz)
        rows = [row for row in trajectory if at_step <= int(row["commandStep"]) < end_step]
        previous = np.asarray(schedule[index - 1]["command"], dtype=np.float64)
        target = np.asarray(segment["command"], dtype=np.float64)
        measured = [np.asarray(row["measuredMotion"], dtype=np.float64) for row in rows]
        planar_errors = [float(np.linalg.norm(value[:2] - target[:2])) for value in measured]
        yaw_errors = [abs(float(value[2] - target[2])) for value in measured]
        terminal = np.mean(measured[-hold_steps:], axis=0) if measured else np.zeros(3, dtype=np.float64)
        planar_delta = target[:2] - previous[:2]
        planar_delta_size = float(np.linalg.norm(planar_delta))
        planar_overshoot = max([0.0, *([float(np.dot(value[:2] - target[:2], planar_delta / planar_delta_size)) for value in measured] if planar_delta_size > 1e-12 else [])])
        yaw_delta = float(target[2] - previous[2])
        yaw_overshoot = max([0.0, *([(float(value[2] - target[2]) * np.sign(yaw_delta)) for value in measured] if abs(yaw_delta) > 1e-12 else [])])
        planar_settling, planar_settled = settling(rows, measured, target, slice(0, 2), at_step, float(measurement["planarToleranceMps"]))
        yaw_settling, yaw_settled = settling(rows, measured, target, 2, at_step, float(measurement["yawRateToleranceRadPerSec"]))
        planar_braking = float(np.linalg.norm(previous[:2])) > 1e-9 and float(np.linalg.norm(target[:2])) <= 1e-9
        transitions.append({
            "index": index, "atStep": at_step, "atSeconds": float(segment["atSeconds"]), "endStep": end_step,
            "fromCommand": previous.tolist(), "toCommand": target.tolist(), "sampleCount": len(rows),
            "peakPlanarTrackingError": max(planar_errors, default=0.0), "peakYawRateTrackingError": max(yaw_errors, default=0.0),
            "terminalMeasuredMotion": terminal.tolist(), "terminalPlanarTrackingError": float(np.linalg.norm(terminal[:2] - target[:2])), "terminalYawRateTrackingError": abs(float(terminal[2] - target[2])),
            "planarOvershootMps": planar_overshoot, "yawRateOvershootRadPerSec": yaw_overshoot,
            "planarSettlingTimeSeconds": planar_settling, "yawRateSettlingTimeSeconds": yaw_settling, "planarSettled": planar_settled, "yawRateSettled": yaw_settled,
            "planarBraking": planar_braking,
        })
    return {
        "motionCommandSchedule": [{"atStep": int(segment["atStep"]), "atSeconds": float(segment["atSeconds"]), "command": np.asarray(segment["command"]).tolist()} for segment in schedule],
        "transitionCount": len(transitions), "transitions": transitions,
        "maximumTransitionTerminalPlanarTrackingError": max((item["terminalPlanarTrackingError"] for item in transitions), default=0.0),
        "maximumTransitionTerminalYawRateTrackingError": max((item["terminalYawRateTrackingError"] for item in transitions), default=0.0),
        "maximumPlanarSettlingTimeSeconds": max((item["planarSettlingTimeSeconds"] for item in transitions), default=0.0),
        "maximumPlanarBrakingSettlingTimeSeconds": max((item["planarSettlingTimeSeconds"] for item in transitions if item["planarBraking"]), default=0.0),
        "maximumYawRateSettlingTimeSeconds": max((item["yawRateSettlingTimeSeconds"] for item in transitions), default=0.0),
        "maximumPlanarOvershootMps": max((item["planarOvershootMps"] for item in transitions), default=0.0),
        "maximumYawRateOvershootRadPerSec": max((item["yawRateOvershootRadPerSec"] for item in transitions), default=0.0),
        "unsettledPlanarTransitionCount": sum(not item["planarSettled"] for item in transitions), "unsettledYawRateTransitionCount": sum(not item["yawRateSettled"] for item in transitions),
    }


def episode_survival_rate(healthy_steps: int, planned_steps: int) -> float:
    """Measure survival against the requested episode, not the truncated trace."""
    return float(healthy_steps) / max(1, int(planned_steps))


def motion_quality_metrics(
    trajectory: list[dict[str, Any]],
    control_hz: float,
    action_low: list[float] | np.ndarray,
    action_high: list[float] | np.ndarray,
    contact_threshold_newton: float = 1.0,
) -> dict[str, Any]:
    """Annotate trajectory rows and aggregate unitful control-grid motion quality."""
    dt = 1.0 / float(control_hz)
    low = np.asarray(action_low, dtype=np.float64)
    high = np.asarray(action_high, dtype=np.float64)
    joint_accelerations: list[np.ndarray | None] = []
    body_angular_accelerations: list[np.ndarray | None] = []
    joint_jerk_samples: list[float] = []
    body_jerk_samples: list[float] = []
    action_slew_samples: list[float] = []
    saturation_samples: list[float] = []
    slip_speed_samples: list[float] = []
    slip_distance_total = 0.0
    impact_samples: list[float] = []
    contact_force_samples: list[float] = []
    foot_evidence_available = bool(trajectory) and all(row.get("footPositionWorld") is not None and row.get("footContactForce") is not None for row in trajectory)

    for index, row in enumerate(trajectory):
        qvel = np.asarray(row["qvel"], dtype=np.float64)
        action = np.asarray(row["action"], dtype=np.float64)
        joint_acceleration = None if index == 0 else (qvel[6:] - np.asarray(trajectory[index - 1]["qvel"], dtype=np.float64)[6:]) / dt
        body_acceleration = None if index == 0 else (qvel[3:6] - np.asarray(trajectory[index - 1]["qvel"], dtype=np.float64)[3:6]) / dt
        joint_accelerations.append(joint_acceleration)
        body_angular_accelerations.append(body_acceleration)

        joint_jerk = np.zeros_like(qvel[6:])
        body_jerk = np.zeros(3, dtype=np.float64)
        if index >= 2 and joint_acceleration is not None and joint_accelerations[index - 1] is not None:
            joint_jerk = (joint_acceleration - joint_accelerations[index - 1]) / dt
            joint_jerk_samples.extend(np.abs(joint_jerk).tolist())
        if index >= 2 and body_acceleration is not None and body_angular_accelerations[index - 1] is not None:
            body_jerk = (body_acceleration - body_angular_accelerations[index - 1]) / dt
            body_jerk_samples.extend(np.abs(body_jerk).tolist())

        action_slew = np.zeros_like(action)
        if index >= 1:
            action_slew = (action - np.asarray(trajectory[index - 1]["action"], dtype=np.float64)) / dt
            action_slew_samples.extend(np.abs(action_slew).tolist())
        tolerance = 0.01 * np.maximum(np.abs(high - low), 1e-12)
        saturated = np.logical_or(action <= low + tolerance, action >= high - tolerance)
        saturation_rate = float(np.mean(saturated)) if action.size else 0.0
        saturation_samples.append(saturation_rate)

        foot_slip_speed: list[float] | None = None
        contact_impact: list[float] | None = None
        if foot_evidence_available:
            force = np.asarray(row["footContactForce"], dtype=np.float64)
            contact_force_samples.extend(force.tolist())
            foot_slip_speed = [0.0] * len(force)
            contact_impact = [0.0] * len(force)
            if index >= 1:
                previous_force = np.asarray(trajectory[index - 1]["footContactForce"], dtype=np.float64)
                positions = np.asarray(row["footPositionWorld"], dtype=np.float64)
                previous_positions = np.asarray(trajectory[index - 1]["footPositionWorld"], dtype=np.float64)
                for foot_index in range(len(force)):
                    if force[foot_index] > contact_threshold_newton and previous_force[foot_index] > contact_threshold_newton:
                        speed = float(np.linalg.norm(positions[foot_index, :2] - previous_positions[foot_index, :2]) / dt)
                        foot_slip_speed[foot_index] = speed
                        slip_speed_samples.append(speed)
                        slip_distance_total += speed * dt
                    impact = max(0.0, float(force[foot_index] - previous_force[foot_index]) / dt)
                    contact_impact[foot_index] = impact
                    impact_samples.append(impact)

        row["motionQuality"] = {
            "jointJerkRadPerSec3": joint_jerk.tolist(),
            "bodyAngularJerkRadPerSec3": body_jerk.tolist(),
            "actionSlewRatePerSec": action_slew.tolist(),
            "actuatorSaturationRate": saturation_rate,
            "footSlipSpeedMps": foot_slip_speed,
            "footContactImpactNPerSec": contact_impact,
        }

    def mean(values: list[float]) -> float:
        return float(np.mean(values)) if values else 0.0

    def peak(values: list[float]) -> float:
        return max(values, default=0.0)

    return {
        "motionQualityFootEvidenceAvailable": foot_evidence_available,
        "motionQualityContactThresholdNewton": float(contact_threshold_newton),
        "meanJointJerkRadPerSec3": mean(joint_jerk_samples),
        "peakJointJerkRadPerSec3": peak(joint_jerk_samples),
        "meanBodyAngularJerkRadPerSec3": mean(body_jerk_samples),
        "peakBodyAngularJerkRadPerSec3": peak(body_jerk_samples),
        "meanActionSlewRatePerSec": mean(action_slew_samples),
        "peakActionSlewRatePerSec": peak(action_slew_samples),
        "actuatorSaturationRate": mean(saturation_samples),
        "meanFootSlipSpeedMps": mean(slip_speed_samples),
        "peakFootSlipSpeedMps": peak(slip_speed_samples),
        "totalFootSlipDistanceM": float(slip_distance_total),
        "meanFootContactImpactNPerSec": mean(impact_samples),
        "peakFootContactImpactNPerSec": peak(impact_samples),
        "peakFootContactForceNewton": peak(contact_force_samples),
    }


def score_metrics(metrics: dict[str, Any], objective: dict[str, Any], compiled: dict[str, Any], training_steps: int = 0) -> dict[str, Any]:
    weights = objective["weights"]
    transient_burden = metrics.get("maximumTransitionTerminalPlanarTrackingError", 0.0) + metrics.get("maximumTransitionTerminalYawRateTrackingError", 0.0) + metrics.get("maximumPlanarSettlingTimeSeconds", 0.0) + metrics.get("maximumYawRateSettlingTimeSeconds", 0.0) + metrics.get("maximumPlanarOvershootMps", 0.0) + metrics.get("maximumYawRateOvershootRadPerSec", 0.0)
    terms = {
        "survival": weights["survival"] * metrics["survivalRate"],
        "velocityTracking": weights["velocityTracking"] * (1.0 / (1.0 + metrics["meanVelocityTrackingError"])),
        "forwardProgress": weights.get("forwardProgress", 0.0) * metrics["forwardProgress"],
        "upright": weights["upright"] * metrics["meanUpright"],
        "lateralDrift": -weights.get("lateralDrift", 0.0) * metrics["lateralDrift"],
        "transitionTracking": weights.get("transitionTracking", 0.0) * (1.0 / (1.0 + transient_burden)),
        "energy": -weights["energy"] * metrics["meanEnergy"],
        "smoothness": -weights["smoothness"] * metrics["meanSmoothness"],
        "jointJerk": -weights.get("jointJerk", 0.0) * metrics.get("meanJointJerkRadPerSec3", 0.0),
        "bodyAngularJerk": -weights.get("bodyAngularJerk", 0.0) * metrics.get("meanBodyAngularJerkRadPerSec3", 0.0),
        "actionSlew": -weights.get("actionSlew", 0.0) * metrics.get("meanActionSlewRatePerSec", 0.0),
        "actuatorSaturation": -weights.get("actuatorSaturation", 0.0) * metrics.get("actuatorSaturationRate", 0.0),
        "footSlip": -weights.get("footSlip", 0.0) * metrics.get("meanFootSlipSpeedMps", 0.0),
        "footImpact": -weights.get("footImpact", 0.0) * metrics.get("meanFootContactImpactNPerSec", 0.0),
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
    morphology = compiled.get("morphology", {})
    base_body = str(morphology.get("baseBody", ""))
    if not base_body or mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, base_body) < 0:
        raise RuntimeError(f"Compiled morphology references unknown base body '{base_body}'")
    contact_points = list(morphology.get("contactPoints", []))
    sensed_contact_points = 0
    for point in contact_points:
        if mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_SITE, str(point["site"])) < 0:
            raise RuntimeError(f"Compiled morphology contact point '{point['id']}' references unknown site '{point['site']}'")
        if point.get("sensor") and mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_SENSOR, str(point["sensor"])) >= 0:
            sensed_contact_points += 1
    return {"mujocoVersion": mujoco.__version__, "nq": model.nq, "nv": model.nv, "nu": model.nu, "nsensor": model.nsensor, "ngeom": model.ngeom, "modelMassKg": float(np.sum(model.body_mass)), "timestep": model.opt.timestep, "morphology": {"class": morphology.get("class"), "limbCount": morphology.get("limbCount"), "contactPointCount": len(contact_points), "sensedContactPointCount": sensed_contact_points}}


def simulate(request: dict[str, Any], persist: bool = True) -> dict[str, Any]:
    project_dir = Path(request["projectDir"])
    compiled = request["compiled"]
    model_path = Path(request["modelPath"])
    if hash_file(model_path) != compiled["modelHash"]:
        raise RuntimeError("Compiled Assembly model hash does not match modelPath")
    controller_definition = request["controller"]
    if controller_definition["kind"] == "program":
        controller = load_program_controller(Path(request["controllerRoot"]), controller_definition)
    else:
        controller = load_policy_controller(project_dir, controller_definition, compiled)
    controller.reset(int(request["seed"]))
    environment = RobotEnvironment(model_path, compiled, request["task"], request["scenario"], int(request["seed"]))
    observation = environment.reset()
    initial_state = {
        "time": float(environment.data.time),
        "qpos": environment.data.qpos.tolist(),
        "qvel": environment.data.qvel.tolist(),
    }
    initial_position = environment.data.qpos[:3].copy()
    previous_position = initial_position.copy()
    distance_traveled = 0.0
    trajectory: list[dict[str, Any]] = []
    totals = {"velocityError": 0.0, "planarVelocityError": 0.0, "yawRateError": 0.0, "upright": 0.0, "energy": 0.0, "smoothness": 0.0}
    measured_motion_total = np.zeros(3, dtype=np.float64)
    motion_command_total = np.zeros(3, dtype=np.float64)
    absolute_pitch_total = 0.0
    maximum_absolute_pitch = 0.0
    maximum_absolute_pitch_rate = 0.0
    body_tilt_total = 0.0
    maximum_body_tilt = 0.0
    minimum_pitch = float("inf")
    maximum_pitch = float("-inf")
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
        measured_motion_total += np.asarray(info["measuredMotion"], dtype=np.float64)
        motion_command_total += np.asarray(info["motionCommand"], dtype=np.float64)
        pitch = quaternion_pitch(environment.data.qpos[3:7])
        body_tilt = quaternion_body_tilt(environment.data.qpos[3:7])
        pitch_rate = float(environment.data.qvel[4])
        absolute_pitch_total += abs(pitch)
        maximum_absolute_pitch = max(maximum_absolute_pitch, abs(pitch))
        maximum_absolute_pitch_rate = max(maximum_absolute_pitch_rate, abs(pitch_rate))
        body_tilt_total += body_tilt
        maximum_body_tilt = max(maximum_body_tilt, body_tilt)
        minimum_pitch = min(minimum_pitch, pitch)
        maximum_pitch = max(maximum_pitch, pitch)
        foot_contact_force = result.observation.get("foot-contact-force")
        foot_positions_world = environment.foot_positions_world()
        trajectory.append({"step": environment.step_index, "commandStep": int(info["commandStep"]), "time": float(environment.data.time), "qpos": environment.data.qpos.tolist(), "qvel": environment.data.qvel.tolist(), "motionCommand": np.asarray(info["motionCommand"]).tolist(), "measuredMotion": np.asarray(info["measuredMotion"]).tolist(), "pitchRad": pitch, "pitchRateRadPerSec": pitch_rate, "bodyTiltRad": body_tilt, "footContactForce": None if foot_contact_force is None else np.asarray(foot_contact_force).tolist(), "footPositionWorld": None if foot_positions_world is None else foot_positions_world.tolist(), "commandedAction": np.asarray(info["commandedAction"]).tolist(), "appliedAction": np.asarray(info["appliedAction"]).tolist(), "action": np.asarray(info["appliedAction"]).tolist(), "reward": result.reward, "healthy": info["healthy"]})
        observation = result.observation
        if result.terminated:
            fell = True
            environment.events.append({"type": "robot.fall", "time": float(environment.data.time), "height": info["height"]})
        if result.terminated or result.truncated: break
    steps = max(1, environment.step_index)
    mean_measured_motion = measured_motion_total / steps
    mean_motion_command = motion_command_total / steps
    transition_metrics = transition_response_metrics(trajectory, request["task"], request["objective"])
    quality_metrics = motion_quality_metrics(trajectory, float(request["task"]["controlHz"]), compiled["actionLow"], compiled["actionHigh"])
    metrics = {
        "durationSeconds": float(environment.data.time), "steps": environment.step_index, "survivalRate": episode_survival_rate(survived_steps, environment.max_steps),
        "fell": fell, "motionCommand": mean_motion_command.tolist(), "meanMotionCommand": mean_motion_command.tolist(), "meanMeasuredMotion": mean_measured_motion.tolist(),
        "planarVelocityTrackingError": float(np.linalg.norm(mean_measured_motion[:2] - mean_motion_command[:2])), "yawRateTrackingError": abs(float(mean_measured_motion[2] - mean_motion_command[2])),
        "meanVelocityTrackingError": totals["velocityError"] / steps, "meanPlanarVelocityTrackingError": totals["planarVelocityError"] / steps, "meanYawRateTrackingError": totals["yawRateError"] / steps, "meanUpright": totals["upright"] / steps,
        "meanAbsolutePitchRad": absolute_pitch_total / steps, "minimumPitchRad": minimum_pitch, "maximumPitchRad": maximum_pitch, "maximumBackwardPitchRad": max(0.0, -minimum_pitch),
        "maximumAbsolutePitchRad": maximum_absolute_pitch, "maximumAbsolutePitchRateRadPerSec": maximum_absolute_pitch_rate,
        "meanBodyTiltRad": body_tilt_total / steps, "maximumBodyTiltRad": maximum_body_tilt,
        "meanEnergy": totals["energy"] / steps, "meanSmoothness": totals["smoothness"] / steps,
        "peakActuator": max((max(abs(value) for value in row["action"]) for row in trajectory), default=0.0),
        **quality_metrics,
        **transition_metrics,
        **motion_metrics(initial_position, environment.data.qpos[:3], distance_traveled, request["task"], float(environment.data.time)),
    }
    score = score_metrics(metrics, request["objective"], compiled, int(request.get("trainingSteps", 0)))
    environment.events.append({"type": "episode.completed", "time": float(environment.data.time), "steps": environment.step_index, "score": score["total"]})
    run_key = hash_json({"runtimeVersion": request["runtimeVersion"], "runtimeSourceHash": request["runtimeSourceHash"], "harnessSourceHash": request["harnessSourceHash"], "mujocoVersion": mujoco.__version__, "assemblyHash": compiled["assemblyHash"], "controllerHash": request["controllerHash"], "trainingSteps": request.get("trainingSteps", 0), "task": request["task"], "scenario": request["scenario"], "objective": request["objective"], "seed": request["seed"]})
    result_hash = hash_json({"runKey": run_key, "initialState": initial_state, "events": environment.events, "trajectory": trajectory, "metrics": metrics, "score": score})
    output = {"runId": f"run-{run_key[:16]}", "runKey": run_key, "resultHash": result_hash, "metrics": metrics, "score": score, "events": environment.events}
    if not persist: return output
    target = project_dir / "runs" / output["runId"]
    if (target / "manifest.json").exists():
        existing = json.loads((target / "manifest.json").read_text())
        if existing["resultHash"] != result_hash: raise RuntimeError("Deterministic run key produced a different result")
        return {**output, "artifactPath": str(target), "cached": True}

    def writer(directory: Path) -> None:
        write_json(directory / "inputs" / "compiled-assembly.json", compiled)
        shutil.copyfile(model_path, directory / "inputs" / "model.xml")
        write_json(directory / "inputs" / "controller.json", controller_definition)
        write_json(directory / "inputs" / "task.json", request["task"])
        write_json(directory / "inputs" / "scenario.json", request["scenario"])
        write_json(directory / "inputs" / "objective.json", request["objective"])
        write_json(directory / "inputs" / "initial-state.json", initial_state)
        with (directory / "events.ndjson").open("w") as stream:
            for event in environment.events: stream.write(json.dumps(event, separators=(",", ":")) + "\n")
        with (directory / "trajectory.ndjson").open("w") as stream:
            for row in trajectory: stream.write(json.dumps(row, separators=(",", ":")) + "\n")
        write_json(directory / "metrics.json", metrics)
        write_json(directory / "score.json", score)
        (directory / "report.md").write_text(f"# Mujica simulation run\n\n- Run: `{output['runId']}`\n- Score: `{score['total']:.6f}`\n- Survival: `{metrics['survivalRate']:.3f}`\n- Fell: `{metrics['fell']}`\n")
        write_json(directory / "manifest.json", {"version": 3, "id": output["runId"], "runKey": run_key, "resultHash": result_hash, "runtimeVersion": request["runtimeVersion"], "runtimeSourceHash": request["runtimeSourceHash"], "harnessSourceHash": request["harnessSourceHash"], "assemblyHash": compiled["assemblyHash"], "modelHash": compiled["modelHash"], "controllerHash": request["controllerHash"], "trainingSteps": request.get("trainingSteps", 0), "seed": request["seed"], "mujocoVersion": mujoco.__version__, "completed": True})
    atomic_directory(target, writer)
    return {**output, "artifactPath": str(target), "cached": False}
