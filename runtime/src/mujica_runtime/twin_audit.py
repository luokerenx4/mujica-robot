from __future__ import annotations

import json
import hashlib
import math
from pathlib import Path
from typing import Any

import mujoco
import numpy as np

from .io import atomic_directory, canonical_json, hash_file, hash_json, write_json


AUDITOR_ID = "mujica-runtime-one-step-twin-audit-v1"


def _finite_vector(value: Any, size: int, label: str) -> np.ndarray:
    vector = np.asarray(value, dtype=np.float64)
    if vector.shape != (size,) or not np.all(np.isfinite(vector)):
        raise RuntimeError(f"{label} must contain {size} finite values")
    return vector


def _quaternion_angle(predicted: np.ndarray, measured: np.ndarray) -> float:
    predicted_norm = float(np.linalg.norm(predicted))
    measured_norm = float(np.linalg.norm(measured))
    if predicted_norm <= 0 or measured_norm <= 0:
        raise RuntimeError("Digital Twin Audit encountered a zero-length root quaternion")
    dot = abs(float(np.dot(predicted / predicted_norm, measured / measured_norm)))
    return float(2.0 * math.acos(float(np.clip(dot, -1.0, 1.0))))


def _metric_summary(values: list[np.ndarray], norms: list[float]) -> dict[str, Any]:
    flattened = np.concatenate(values) if values and values[0].size else np.zeros(0, dtype=np.float64)
    worst = int(np.argmax(norms)) if norms else None
    return {
        "rmse": float(np.sqrt(np.mean(np.square(flattened)))) if flattened.size else 0.0,
        "maximumMagnitude": float(norms[worst]) if worst is not None else 0.0,
        "worstTransition": worst,
    }


def _assert_existing(target: Path, identity: dict[str, Any]) -> dict[str, Any]:
    manifest = json.loads((target / "manifest.json").read_text())
    if manifest.get("completed") is not True or manifest.get("kind") != "mujica-digital-twin-audit":
        raise RuntimeError(f"Digital Twin Audit at '{target}' is incomplete")
    if manifest.get("identity") != identity:
        raise RuntimeError(f"Digital Twin Audit identity collision at '{target}'")
    for field, name in [
        ("transitionsHash", "transitions.ndjson"),
        ("predictionHash", "prediction.ndjson"),
        ("summaryHash", "summary.json"),
        ("requestHash", "request.json"),
        ("reportHash", "report.md"),
    ]:
        path = target / name
        if not path.is_file() or hash_file(path) != manifest.get(field):
            raise RuntimeError(f"Digital Twin Audit at '{target}' failed {name} integrity verification")
    expected = hash_json({
        "identity": identity,
        "transitionsHash": manifest["transitionsHash"],
        "predictionHash": manifest["predictionHash"],
        "summaryHash": manifest["summaryHash"],
    })
    if manifest.get("auditHash") != expected or manifest.get("id") != f"twin-audit-{expected[:16]}":
        raise RuntimeError(f"Digital Twin Audit at '{target}' failed identity verification")
    return manifest


def audit_twin(request: dict[str, Any]) -> dict[str, Any]:
    model_path = Path(request["modelPath"]).resolve()
    trajectory_path = Path(request["trajectoryPath"]).resolve()
    if not model_path.is_file() or hash_file(model_path) != request["modelHash"]:
        raise RuntimeError("Digital Twin Audit model differs from its frozen Hardware Bundle")
    if not trajectory_path.is_file() or hash_file(trajectory_path) != request["trajectoryHash"]:
        raise RuntimeError("Digital Twin Audit episode differs from its immutable Hardware Capture")

    control_hz = float(request["controlHz"])
    if not math.isfinite(control_hz) or control_hz <= 0:
        raise RuntimeError("Digital Twin Audit controlHz must be positive")
    model = mujoco.MjModel.from_xml_path(str(model_path))
    interval = 1.0 / control_hz
    ratio = interval / float(model.opt.timestep)
    physics_steps = int(round(ratio))
    if physics_steps < 1 or abs(ratio - physics_steps) > 1e-9:
        raise RuntimeError("Digital Twin Audit control interval must align with the frozen MuJoCo timestep")

    rows = [json.loads(line) for line in trajectory_path.read_text().splitlines() if line.strip()]
    if len(rows) < 2:
        raise RuntimeError("Digital Twin Audit requires at least two device telemetry rows")
    parsed: list[dict[str, Any]] = []
    for index, row in enumerate(rows):
        if row.get("step") != index:
            raise RuntimeError("Digital Twin Audit requires contiguous zero-based device steps")
        observed_time = float(row.get("time", float("nan")))
        expected_time = index * interval
        if not math.isfinite(observed_time) or abs(observed_time - expected_time) > 1e-8:
            raise RuntimeError("Digital Twin Audit device time does not match the frozen control interval")
        parsed.append({
            "raw": row,
            "qpos": _finite_vector(row.get("qpos"), model.nq, f"Device row {index} qpos"),
            "qvel": _finite_vector(row.get("qvel"), model.nv, f"Device row {index} qvel"),
            "action": _finite_vector(row.get("appliedAction"), model.nu, f"Device row {index} appliedAction"),
        })

    source = request["source"]
    required_source = ["captureId", "captureHash", "episodeId", "episodeHash", "bundleId", "bundleHash", "environment", "mode"]
    if any(not isinstance(source.get(key), str) or not source[key] for key in required_source):
        raise RuntimeError("Digital Twin Audit source identity is incomplete")
    if source["episodeHash"] != request["trajectoryHash"]:
        raise RuntimeError("Digital Twin Audit episode identity differs from the trajectory")
    identity = {
        "auditor": AUDITOR_ID,
        "runtimeVersion": request["runtimeVersion"],
        "runtimeSourceHash": request["runtimeSourceHash"],
        "harnessSourceHash": request["harnessSourceHash"],
        "mujocoVersion": mujoco.__version__,
        "source": source,
        "assemblyHash": request["assemblyHash"],
        "modelHash": request["modelHash"],
        "trajectoryHash": request["trajectoryHash"],
        "controlHz": int(control_hz) if control_hz.is_integer() else control_hz,
        "physicsSteps": physics_steps,
    }

    data = mujoco.MjData(model)
    has_free_root = model.njnt > 0 and model.jnt_type[0] == mujoco.mjtJoint.mjJNT_FREE
    joint_qpos_start = 7 if has_free_root else 0
    joint_qvel_start = 6 if has_free_root else 0
    transitions: list[dict[str, Any]] = []
    prediction_rows = [{
        "step": 0,
        "time": float(rows[0]["time"]),
        "qpos": parsed[0]["qpos"].tolist(),
        "qvel": parsed[0]["qvel"].tolist(),
        "predictionKind": "measured-initial-state",
    }]
    metric_vectors: dict[str, list[np.ndarray]] = {
        "basePosition": [],
        "baseVelocity": [],
        "jointPosition": [],
        "jointVelocity": [],
    }
    metric_norms: dict[str, list[float]] = {name: [] for name in metric_vectors}
    orientation_angles: list[float] = []

    for index in range(len(parsed) - 1):
        current = parsed[index]
        measured = parsed[index + 1]
        mujoco.mj_resetData(model, data)
        data.qpos[:] = current["qpos"]
        data.qvel[:] = current["qvel"]
        data.ctrl[:] = current["action"]
        mujoco.mj_forward(model, data)
        for _ in range(physics_steps):
            mujoco.mj_step(model, data)
        predicted_qpos = data.qpos.copy()
        predicted_qvel = data.qvel.copy()
        base_position = predicted_qpos[:3] - measured["qpos"][:3] if has_free_root else np.zeros(0)
        base_velocity = predicted_qvel[:6] - measured["qvel"][:6] if has_free_root else np.zeros(0)
        orientation_angle = _quaternion_angle(predicted_qpos[3:7], measured["qpos"][3:7]) if has_free_root else 0.0
        joint_position = predicted_qpos[joint_qpos_start:] - measured["qpos"][joint_qpos_start:]
        joint_velocity = predicted_qvel[joint_qvel_start:] - measured["qvel"][joint_qvel_start:]
        for name, value in [
            ("basePosition", base_position),
            ("baseVelocity", base_velocity),
            ("jointPosition", joint_position),
            ("jointVelocity", joint_velocity),
        ]:
            metric_vectors[name].append(value)
            metric_norms[name].append(float(np.linalg.norm(value)))
        orientation_angles.append(orientation_angle)
        raw = current["raw"]
        next_raw = measured["raw"]
        transitions.append({
            "index": index,
            "fromStep": index,
            "toStep": index + 1,
            "fromTime": float(raw["time"]),
            "toTime": float(next_raw["time"]),
            "durationSeconds": interval,
            "appliedAction": current["action"].tolist(),
            "measured": {"qpos": measured["qpos"].tolist(), "qvel": measured["qvel"].tolist()},
            "predicted": {"qpos": predicted_qpos.tolist(), "qvel": predicted_qvel.tolist()},
            "residual": {
                "basePositionM": base_position.tolist(),
                "basePositionNormM": float(np.linalg.norm(base_position)),
                "baseOrientationAngleRad": orientation_angle,
                "baseVelocity": base_velocity.tolist(),
                "baseLinearVelocityNormMps": float(np.linalg.norm(base_velocity[:3])),
                "baseAngularVelocityNormRadPerSec": float(np.linalg.norm(base_velocity[3:6])),
                "jointPositionRad": joint_position.tolist(),
                "jointPositionNormRad": float(np.linalg.norm(joint_position)),
                "jointVelocityRadPerSec": joint_velocity.tolist(),
                "jointVelocityNormRadPerSec": float(np.linalg.norm(joint_velocity)),
            },
            **({"deviceHealth": next_raw["deviceHealth"]} if "deviceHealth" in next_raw else {}),
        })
        prediction_rows.append({
            "step": index + 1,
            "time": float(next_raw["time"]),
            "qpos": predicted_qpos.tolist(),
            "qvel": predicted_qvel.tolist(),
            "predictionKind": "one-step-from-device-state",
            "transitionIndex": index,
        })

    base_velocity_linear = [value[:3] for value in metric_vectors["baseVelocity"]]
    base_velocity_angular = [value[3:6] for value in metric_vectors["baseVelocity"]]
    summary = {
        "transitionCount": len(transitions),
        "metrics": {
            "basePositionM": _metric_summary(metric_vectors["basePosition"], metric_norms["basePosition"]),
            "baseOrientationAngleRad": {
                "rmse": float(np.sqrt(np.mean(np.square(orientation_angles)))) if orientation_angles else 0.0,
                "maximumMagnitude": max(orientation_angles, default=0.0),
                "worstTransition": int(np.argmax(orientation_angles)) if orientation_angles else None,
            },
            "baseLinearVelocityMps": _metric_summary(base_velocity_linear, [float(np.linalg.norm(value)) for value in base_velocity_linear]),
            "baseAngularVelocityRadPerSec": _metric_summary(base_velocity_angular, [float(np.linalg.norm(value)) for value in base_velocity_angular]),
            "jointPositionRad": _metric_summary(metric_vectors["jointPosition"], metric_norms["jointPosition"]),
            "jointVelocityRadPerSec": _metric_summary(metric_vectors["jointVelocity"], metric_norms["jointVelocity"]),
        },
        "perJoint": {
            "positionRmseRad": np.sqrt(np.mean(np.square(np.stack(metric_vectors["jointPosition"])), axis=0)).tolist(),
            "velocityRmseRadPerSec": np.sqrt(np.mean(np.square(np.stack(metric_vectors["jointVelocity"])), axis=0)).tolist(),
        },
        "authority": {
            "measurement": "immutable-device-telemetry",
            "prediction": "frozen-digital-twin",
            "claim": "derived-model-fit-evidence",
            "changesHardwareVerified": False,
            "grantsActuation": False,
            "promotesCalibration": False,
        },
    }
    transitions_bytes = "".join(canonical_json(item) + "\n" for item in transitions).encode()
    prediction_bytes = "".join(canonical_json(item) + "\n" for item in prediction_rows).encode()
    summary_bytes = (json.dumps(summary, indent=2, ensure_ascii=False) + "\n").encode()
    transitions_hash = hashlib.sha256(transitions_bytes).hexdigest()
    prediction_hash = hashlib.sha256(prediction_bytes).hexdigest()
    summary_hash = hashlib.sha256(summary_bytes).hexdigest()
    audit_hash = hash_json({
        "identity": identity,
        "transitionsHash": transitions_hash,
        "predictionHash": prediction_hash,
        "summaryHash": summary_hash,
    })
    audit_id = f"twin-audit-{audit_hash[:16]}"
    target = Path(request["outputRoot"]).resolve() / audit_id
    if (target / "manifest.json").exists():
        manifest = _assert_existing(target, identity)
        return {"id": audit_id, "auditHash": audit_hash, "path": str(target), "manifest": manifest, "summary": summary, "cached": True}

    request_record = {"identity": identity, "modelPath": str(model_path), "trajectoryPath": str(trajectory_path)}
    report = (
        "# Mujica Digital Twin Residual Audit\n\n"
        f"- Capture: `{source['captureId']}` / `{source['episodeId']}`\n"
        f"- Frozen Bundle: `{source['bundleId']}`\n"
        f"- Transitions: `{len(transitions)}` at `{control_hz:g} Hz`\n"
        f"- Joint-position RMSE: `{summary['metrics']['jointPositionRad']['rmse']:.9f} rad`\n"
        f"- Joint-velocity RMSE: `{summary['metrics']['jointVelocityRadPerSec']['rmse']:.9f} rad/s`\n"
        f"- Base-position RMSE: `{summary['metrics']['basePositionM']['rmse']:.9f} m`\n\n"
        "This is derived model-fit evidence. It does not verify hardware safety, grant actuation, or promote Calibration.\n"
    )

    def writer(directory: Path) -> None:
        (directory / "transitions.ndjson").write_bytes(transitions_bytes)
        (directory / "prediction.ndjson").write_bytes(prediction_bytes)
        (directory / "summary.json").write_bytes(summary_bytes)
        write_json(directory / "request.json", request_record)
        (directory / "report.md").write_text(report)
        write_json(directory / "manifest.json", {
            "version": 1,
            "id": audit_id,
            "kind": "mujica-digital-twin-audit",
            "auditHash": audit_hash,
            "identity": identity,
            "transitionsHash": transitions_hash,
            "predictionHash": prediction_hash,
            "summaryHash": summary_hash,
            "requestHash": hash_file(directory / "request.json"),
            "reportHash": hash_file(directory / "report.md"),
            "transitionCount": len(transitions),
            "completed": True,
        })

    atomic_directory(target, writer)
    manifest = _assert_existing(target, identity)
    return {"id": audit_id, "auditHash": audit_hash, "path": str(target), "manifest": manifest, "summary": summary, "cached": False}
