from __future__ import annotations

import json
import os
import select
import shutil
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import mujoco
import numpy as np

from .controllers import load_policy_controller, load_program_controller
from .io import atomic_directory, hash_file, hash_json, sha256_bytes, write_json
from .simulation import quaternion_body_tilt


PROTOCOL = "stdio-jsonl-v1"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _finite_vector(value: Any, size: int, label: str) -> np.ndarray:
    vector = np.asarray(value, dtype=np.float64).reshape(-1)
    if vector.size != size:
        raise RuntimeError(f"{label} expected {size} values, got {vector.size}")
    if not np.isfinite(vector).all():
        raise RuntimeError(f"{label} contains non-finite values")
    return vector


class DriverSession:
    def __init__(self, executable: Path, arguments: list[str], environment: dict[str, str], transcript: list[dict[str, Any]], stderr_path: Path):
        self.transcript = transcript
        self.stderr_file = stderr_path.open("wb")
        self.process = subprocess.Popen(
            [str(executable), *arguments],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=self.stderr_file,
            text=True,
            bufsize=1,
            env={**os.environ, **environment},
        )
        if self.process.stdin is None or self.process.stdout is None:
            raise RuntimeError("Driver process has no stdin/stdout pipes")

    def send(self, message: dict[str, Any]) -> int:
        now = time.perf_counter_ns()
        self.transcript.append({"direction": "host-to-driver", "monotonicNs": now, "message": message})
        self.process.stdin.write(json.dumps(message, separators=(",", ":"), ensure_ascii=False) + "\n")
        self.process.stdin.flush()
        return now

    def receive(self, timeout_seconds: float) -> tuple[dict[str, Any], int]:
        readable, _, _ = select.select([self.process.stdout], [], [], timeout_seconds)
        if not readable:
            raise RuntimeError(f"Driver response timeout after {timeout_seconds:.3f}s")
        line = self.process.stdout.readline()
        if not line:
            code = self.process.poll()
            raise RuntimeError(f"Driver closed stdout unexpectedly (exit={code})")
        now = time.perf_counter_ns()
        try:
            message = json.loads(line)
        except json.JSONDecodeError as error:
            raise RuntimeError(f"Driver returned invalid JSONL: {line[:200]!r}") from error
        if not isinstance(message, dict):
            raise RuntimeError("Driver message must be a JSON object")
        self.transcript.append({"direction": "driver-to-host", "monotonicNs": now, "message": message})
        return message, now

    def close(self) -> None:
        if self.process.poll() is None:
            try:
                self.send({"type": "close"})
                self.receive(1.0)
            except Exception:
                self.process.terminate()
        try:
            self.process.wait(timeout=2.0)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=2.0)
        self.stderr_file.close()


def _observation_map(vector: np.ndarray, channels: list[dict[str, Any]]) -> dict[str, np.ndarray]:
    result: dict[str, np.ndarray] = {}
    offset = 0
    for channel in channels:
        size = int(channel["size"])
        result[str(channel["name"])] = vector[offset:offset + size].copy()
        offset += size
    if offset != vector.size:
        raise RuntimeError("Observation Contract does not consume the complete driver vector")
    return result


def _state_vectors(message: dict[str, Any], model: mujoco.MjModel, observation_size: int, episode_id: str, step: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    if message.get("type") != "state" or message.get("episode") != episode_id or int(message.get("step", -1)) != step:
        raise RuntimeError(f"Expected state for episode '{episode_id}' step {step}")
    qpos = _finite_vector(message.get("qpos"), model.nq, f"{episode_id} step {step} qpos")
    qvel = _finite_vector(message.get("qvel"), model.nv, f"{episode_id} step {step} qvel")
    observation = _finite_vector(message.get("observation"), observation_size, f"{episode_id} step {step} observation")
    return qpos, qvel, observation


def _state_safety_reasons(model: mujoco.MjModel, qpos: np.ndarray, qvel: np.ndarray, safety: dict[str, Any]) -> list[str]:
    reasons: list[str] = []
    has_free_root = model.njnt > 0 and int(model.jnt_type[0]) == int(mujoco.mjtJoint.mjJNT_FREE) and int(model.jnt_qposadr[0]) == 0
    joint_velocity = qvel[6:] if has_free_root else qvel
    maximum_velocity = float(np.max(np.abs(joint_velocity))) if joint_velocity.size else 0.0
    if maximum_velocity > float(safety["maximumJointVelocityRadPerSec"]):
        reasons.append(f"joint velocity {maximum_velocity:.6f} exceeds {safety['maximumJointVelocityRadPerSec']}")
    if has_free_root:
        height = float(qpos[2])
        if safety.get("minimumBaseHeightM") is not None and height < float(safety["minimumBaseHeightM"]):
            reasons.append(f"base height {height:.6f} is below {safety['minimumBaseHeightM']}")
        if safety.get("maximumBaseHeightM") is not None and height > float(safety["maximumBaseHeightM"]):
            reasons.append(f"base height {height:.6f} exceeds {safety['maximumBaseHeightM']}")
        if safety.get("maximumBodyTiltRad") is not None:
            tilt = quaternion_body_tilt(qpos[3:7])
            if tilt > float(safety["maximumBodyTiltRad"]):
                reasons.append(f"body tilt {tilt:.6f} exceeds {safety['maximumBodyTiltRad']}")
    return reasons


def capture_hardware(request: dict[str, Any]) -> dict[str, Any]:
    project_dir = Path(request["projectDir"])
    bundle_root = Path(request["bundleRoot"])
    executable = Path(request["driverPath"])
    if hash_file(executable) != request["driverHash"]:
        raise RuntimeError("Driver executable hash changed before launch")
    for driver_input in request.get("driverInputs", []):
        if hash_file(Path(driver_input["path"])) != driver_input["hash"]:
            raise RuntimeError(f"Driver input '{driver_input['name']}' changed before launch")
    plan = request["capturePlan"]
    bundle = request["bundle"]
    compiled = request["compiled"]
    target = bundle["target"]
    model_path = bundle_root / "revision" / "compiled" / "model.xml"
    model = mujoco.MjModel.from_xml_path(str(model_path))
    if model.nu != int(compiled["actionContract"]["size"]):
        raise RuntimeError("Hardware Bundle model and Action Contract differ")
    controller_definition = request["controller"]
    if controller_definition["kind"] == "program":
        controller = load_program_controller(bundle_root / "controller", controller_definition)
    else:
        controller = load_policy_controller(bundle_root, controller_definition, compiled)

    transcript: list[dict[str, Any]] = []
    episode_rows: dict[str, list[dict[str, Any]]] = {}
    episode_results: list[dict[str, Any]] = []
    interventions: list[dict[str, Any]] = []
    dispatch_latencies_ms: list[float] = []
    deadline_misses = 0
    maximum_consecutive_misses = 0
    consecutive_misses = 0
    emergency_stops = 0
    safe_stops = 0
    status = "COMPLETED"
    reasons: list[str] = []
    device: dict[str, str] | None = None
    started_at = _utc_now()
    timeout_seconds = max(1.0, 5.0 / float(target["controlHz"]))
    startup_timeout_seconds = max(5.0, timeout_seconds)

    temporary_root = Path(tempfile.mkdtemp(prefix="mujica-hardware-capture-"))
    stderr_path = temporary_root / "driver-stderr.log"
    session: DriverSession | None = None
    try:
        session = DriverSession(executable, list(request.get("driverArgs", [])), {
            "MUJICA_HARDWARE_BUNDLE": str(bundle_root),
            "MUJICA_CAPTURE_PLAN": str(plan["id"]),
        }, transcript, stderr_path)
        session.send({
            "type": "hello",
            "protocol": PROTOCOL,
            "version": 1,
            "bundleHash": bundle["bundleHash"],
            "observationContractHash": bundle["observationContractHash"],
            "actionContractHash": bundle["actionContractHash"],
            "driverHash": request["driverHash"],
            "environment": target["environment"],
        })
        hello, _ = session.receive(startup_timeout_seconds)
        expected_hello = {
            "type": "hello", "protocol": PROTOCOL, "version": 1,
            "bundleHash": bundle["bundleHash"],
            "observationContractHash": bundle["observationContractHash"],
            "actionContractHash": bundle["actionContractHash"],
            "driverHash": request["driverHash"],
            "environment": target["environment"],
        }
        for key, expected in expected_hello.items():
            if hello.get(key) != expected:
                raise RuntimeError(f"Driver hello '{key}' mismatch")
        raw_device = hello.get("device")
        if not isinstance(raw_device, dict):
            raise RuntimeError("Driver hello lacks device identity")
        device = {key: str(raw_device.get(key, "")) for key in ("vendor", "model", "serial")}
        if not all(device.values()):
            raise RuntimeError("Driver device identity is incomplete")
        if device["vendor"] != target["device"]["vendor"] or device["model"] != target["device"]["model"]:
            raise RuntimeError("Driver device identity does not match Hardware Target")
        if bool(target["device"]["serialRequired"]) and device["serial"].lower() in {"unknown", "simulated", "none"}:
            raise RuntimeError("Hardware Target requires a physical device serial")
        authorization = request.get("authorization")
        if authorization is not None and device != authorization["device"]:
            raise RuntimeError("Driver device identity does not match operator authorization")

        action_low = np.asarray(compiled["actionLow"], dtype=np.float64)
        action_high = np.asarray(compiled["actionHigh"], dtype=np.float64)
        emergency_action = _finite_vector(target["safety"]["emergencyStopAction"], model.nu, "emergency-stop Action")
        maximum_delta = float(plan["action"]["maximumSlewPerSecond"]) / float(target["controlHz"])
        for episode in plan["episodes"]:
            episode_id = str(episode["id"])
            planned_steps = int(episode["steps"])
            controller.reset(int(episode["seed"]))
            previous_action = emergency_action.copy()
            rows: list[dict[str, Any]] = []
            episode_reason: str | None = None
            session.send({"type": "start-episode", "episode": episode_id, "seed": int(episode["seed"]), "steps": planned_steps, "controlHz": float(target["controlHz"])})
            message, received_ns = session.receive(startup_timeout_seconds)
            qpos, qvel, observation_vector = _state_vectors(message, model, int(compiled["observationContract"]["size"]), episode_id, 0)
            for step in range(planned_steps):
                state_reasons = _state_safety_reasons(model, qpos, qvel, plan["safety"])
                if state_reasons:
                    episode_reason = "; ".join(state_reasons)
                    break
                observation = _observation_map(observation_vector, compiled["observationContract"]["channels"])
                try:
                    raw_action = _finite_vector(controller.act(observation, step / float(target["controlHz"])), model.nu, "Controller Action")
                except Exception as error:
                    episode_reason = f"Controller failure: {error}"
                    break
                desired_action = raw_action * float(plan["action"]["scale"])
                slew_limited = np.clip(desired_action, previous_action - maximum_delta, previous_action + maximum_delta)
                action = np.clip(slew_limited, action_low, action_high)
                if not np.array_equal(action, desired_action):
                    interventions.append({
                        "episode": episode_id,
                        "step": step,
                        "slewLimitedValues": int(np.count_nonzero(slew_limited != desired_action)),
                        "contractClippedValues": int(np.count_nonzero(action != slew_limited)),
                    })
                rows.append({
                    "episode": episode_id,
                    "step": step,
                    "time": step / float(target["controlHz"]),
                    "qpos": qpos.tolist(),
                    "qvel": qvel.tolist(),
                    "commandedAction": action.tolist(),
                })
                sent_ns = session.send({"type": "action", "episode": episode_id, "step": step, "action": action.tolist()})
                dispatch_ms = (sent_ns - received_ns) / 1_000_000.0
                dispatch_latencies_ms.append(dispatch_ms)
                if dispatch_ms > float(target["safety"]["maximumLatencyMs"]):
                    deadline_misses += 1
                    consecutive_misses += 1
                    maximum_consecutive_misses = max(maximum_consecutive_misses, consecutive_misses)
                else:
                    consecutive_misses = 0
                if consecutive_misses > int(target["safety"]["maximumConsecutiveMisses"]):
                    episode_reason = f"consecutive dispatch deadline misses {consecutive_misses} exceed target limit"
                    break
                message, received_ns = session.receive(timeout_seconds)
                qpos, qvel, observation_vector = _state_vectors(message, model, int(compiled["observationContract"]["size"]), episode_id, step + 1)
                previous_action = action
            if episode_reason is None:
                terminal_reasons = _state_safety_reasons(model, qpos, qvel, plan["safety"])
                if terminal_reasons:
                    episode_reason = "; ".join(terminal_reasons)
            if episode_reason is None:
                rows.append({
                    "episode": episode_id,
                    "step": planned_steps,
                    "time": planned_steps / float(target["controlHz"]),
                    "qpos": qpos.tolist(),
                    "qvel": qvel.tolist(),
                    "commandedAction": emergency_action.tolist(),
                })
                session.send({"type": "safe-stop", "episode": episode_id, "action": emergency_action.tolist()})
                stopped, _ = session.receive(timeout_seconds)
                if stopped.get("type") != "stopped" or stopped.get("episode") != episode_id:
                    raise RuntimeError(f"Driver did not acknowledge safe stop for '{episode_id}'")
                safe_stops += 1
                episode_rows[episode_id] = rows
                episode_results.append({"id": episode_id, "seed": int(episode["seed"]), "plannedSteps": planned_steps, "steps": planned_steps, "completed": True, "reason": None})
            else:
                status = "ABORTED"
                reasons.append(f"{episode_id}: {episode_reason}")
                session.send({"type": "emergency-stop", "episode": episode_id, "action": emergency_action.tolist(), "reason": episode_reason})
                emergency_stops += 1
                try:
                    session.receive(timeout_seconds)
                except Exception:
                    pass
                episode_results.append({"id": episode_id, "seed": int(episode["seed"]), "plannedSteps": planned_steps, "steps": len(rows), "completed": False, "reason": episode_reason})
                break
    except Exception as error:
        status = "FAILED"
        reasons.append(str(error))
        if session is not None and session.process.poll() is None:
            try:
                session.send({"type": "emergency-stop", "action": target["safety"]["emergencyStopAction"], "reason": str(error)})
                emergency_stops += 1
            except Exception:
                pass
    finally:
        if session is not None:
            session.close()

    ended_at = _utc_now()
    if device is None:
        device = {"vendor": target["device"]["vendor"], "model": target["device"]["model"], "serial": "unavailable"}
    transcript_bytes = "".join(json.dumps(row, separators=(",", ":"), ensure_ascii=False) + "\n" for row in transcript).encode()
    episode_bytes = {
        episode_id: "".join(json.dumps(row, separators=(",", ":"), ensure_ascii=False) + "\n" for row in rows).encode()
        for episode_id, rows in episode_rows.items()
    }
    identity = {
        "version": 1,
        "planHash": request["planHash"],
        "bundleHash": bundle["bundleHash"],
        "driverHash": request["driverHash"],
        "driverArgs": request.get("driverArgs", []),
        "driverInputs": [{"name": item["name"], "hash": item["hash"]} for item in request.get("driverInputs", [])],
        "device": device,
        "operator": request["operator"],
        "authorizationHash": request.get("authorizationHash"),
        "startedAt": started_at,
        "endedAt": ended_at,
        "status": status,
        "transcriptHash": sha256_bytes(transcript_bytes),
        "episodeHashes": {episode_id: sha256_bytes(value) for episode_id, value in episode_bytes.items()},
        "runtimeSourceHash": request["runtimeSourceHash"],
        "harnessSourceHash": request["harnessSourceHash"],
    }
    capture_hash = hash_json(identity)
    capture_id = f"capture-{capture_hash[:16]}"
    root = project_dir / "hardware-captures" / capture_id
    maximum_latency = max(dispatch_latencies_ms, default=0.0)
    mean_latency = float(np.mean(dispatch_latencies_ms)) if dispatch_latencies_ms else 0.0

    def write_artifact(directory: Path) -> None:
        captures_root = directory / "captures"
        captures_root.mkdir(parents=True, exist_ok=True)
        completed_episodes: list[dict[str, Any]] = []
        for result in episode_results:
            episode_id = result["id"]
            if episode_id in episode_bytes:
                path = captures_root / f"{episode_id}.ndjson"
                path.write_bytes(episode_bytes[episode_id])
                result = {**result, "path": f"captures/{episode_id}.ndjson", "hash": hash_file(path)}
            completed_episodes.append(result)
        (directory / "transcript.ndjson").write_bytes(transcript_bytes)
        (directory / "driver-stderr.log").write_bytes(stderr_path.read_bytes() if stderr_path.exists() else b"")
        write_json(directory / "request.json", {
            "capturePlan": plan,
            "planHash": request["planHash"],
            "bundle": bundle,
            "driver": {"hash": request["driverHash"], "arguments": request.get("driverArgs", []), "inputs": [{"name": item["name"], "hash": item["hash"]} for item in request.get("driverInputs", [])]},
            "operator": request["operator"],
            "authorization": request.get("authorization"),
        })
        inputs_root = directory / "driver-inputs"
        for index, item in enumerate(request.get("driverInputs", [])):
            inputs_root.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(item["path"], inputs_root / f"{index:02d}-{item['name']}")
        if request.get("authorizationText") is not None:
            (directory / "authorization.json").write_text(request["authorizationText"])
        manifest = {
            **identity,
            "id": capture_id,
            "captureHash": capture_hash,
            "plan": plan["id"],
            "target": target["id"],
            "environment": target["environment"],
            "assembly": target["assembly"],
            "assemblyHash": bundle["assemblyHash"],
            "executionHash": compiled["executionHash"],
            "modelHash": compiled["modelHash"],
            "controller": target["controller"],
            "observationContractHash": bundle["observationContractHash"],
            "actionContractHash": bundle["actionContractHash"],
            "episodes": completed_episodes,
            "dispatch": {
                "samples": len(dispatch_latencies_ms),
                "maximumLatencyMs": maximum_latency,
                "meanLatencyMs": mean_latency,
                "deadlineMisses": deadline_misses,
                "maximumConsecutiveMisses": maximum_consecutive_misses,
            },
            "interventions": interventions,
            "safeStops": safe_stops,
            "emergencyStops": emergency_stops,
            "reasons": reasons,
            "calibrationEligible": status == "COMPLETED" and all(item["completed"] for item in completed_episodes),
            "completed": True,
        }
        write_json(directory / "manifest.json", manifest)
        (directory / "report.md").write_text(
            "# Hardware capture\n\n"
            f"- Status: {status}\n"
            f"- Environment: {target['environment']}\n"
            f"- Device: {device['vendor']} {device['model']} ({device['serial']})\n"
            f"- Episodes: {sum(item['completed'] for item in completed_episodes)}/{len(plan['episodes'])}\n"
            f"- Dispatch latency max/mean: {maximum_latency:.6f}/{mean_latency:.6f} ms\n"
            f"- Deadline misses: {deadline_misses}\n"
            f"- Safety interventions: {len(interventions)}\n"
            f"- Emergency stops: {emergency_stops}\n"
            f"- Calibration eligible: {str(manifest['calibrationEligible']).lower()}\n"
            + "".join(f"- Reason: {reason}\n" for reason in reasons)
        )

    if root.exists():
        raise RuntimeError(f"Hardware Capture already exists: {capture_id}")
    try:
        atomic_directory(root, write_artifact)
    finally:
        shutil.rmtree(temporary_root, ignore_errors=True)
    return {
        "captureId": capture_id,
        "captureHash": capture_hash,
        "artifactPath": str(root),
        "status": status,
        "environment": target["environment"],
        "device": device,
        "episodes": episode_results,
        "maximumDispatchLatencyMs": maximum_latency,
        "deadlineMisses": deadline_misses,
        "interventions": len(interventions),
        "emergencyStops": emergency_stops,
        "calibrationEligible": status == "COMPLETED" and len(episode_rows) == len(plan["episodes"]),
        "reasons": reasons,
    }
