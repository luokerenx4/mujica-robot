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
ACTUATOR_STATES = {"ready", "derated", "faulted", "offline"}


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


def _state_vectors(
    message: dict[str, Any],
    model: mujoco.MjModel,
    observation_size: int,
    action_size: int,
    episode_id: str,
    step: int,
    require_telemetry: bool,
    require_device_health: bool,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray | None, float | None, dict[str, Any] | None]:
    if message.get("type") != "state" or message.get("episode") != episode_id or int(message.get("step", -1)) != step:
        raise RuntimeError(f"Expected state for episode '{episode_id}' step {step}")
    qpos = _finite_vector(message.get("qpos"), model.nq, f"{episode_id} step {step} qpos")
    qvel = _finite_vector(message.get("qvel"), model.nv, f"{episode_id} step {step} qvel")
    observation = _finite_vector(message.get("observation"), observation_size, f"{episode_id} step {step} observation")
    raw_applied = message.get("appliedAction")
    applied = None if raw_applied is None else _finite_vector(raw_applied, action_size, f"{episode_id} step {step} appliedAction")
    raw_age = message.get("stateAgeMs")
    state_age = None if raw_age is None else float(raw_age)
    if state_age is not None and (not np.isfinite(state_age) or state_age < 0):
        raise RuntimeError(f"{episode_id} step {step} stateAgeMs must be finite and nonnegative")
    if require_telemetry and (applied is None or state_age is None):
        raise RuntimeError(f"{episode_id} step {step} lacks required appliedAction/stateAgeMs telemetry")
    device_health = _device_health(message.get("deviceHealth"), action_size, episode_id, step, require_device_health)
    return qpos, qvel, observation, applied, state_age, device_health


def _device_health(raw: Any, action_size: int, episode_id: str, step: int, required: bool) -> dict[str, Any] | None:
    if raw is None:
        if required:
            raise RuntimeError(f"{episode_id} step {step} lacks required deviceHealth telemetry")
        return None
    if not isinstance(raw, dict):
        raise RuntimeError(f"{episode_id} step {step} deviceHealth must be an object")
    temperatures = _finite_vector(raw.get("motorTemperatureC"), action_size, f"{episode_id} step {step} motorTemperatureC")
    currents = _finite_vector(raw.get("motorCurrentA"), action_size, f"{episode_id} step {step} motorCurrentA")
    bus_voltage = float(raw.get("busVoltageV", float("nan")))
    if not np.isfinite(bus_voltage) or bus_voltage < 0:
        raise RuntimeError(f"{episode_id} step {step} busVoltageV must be finite and nonnegative")
    faults = raw.get("faults")
    if not isinstance(faults, list) or not all(
        isinstance(item, str)
        and 0 < len(item) <= 64
        and all(character.isalnum() or character in "._:-" for character in item)
        for item in faults
    ):
        raise RuntimeError(f"{episode_id} step {step} deviceHealth faults must be safe nonempty codes")
    if len(set(faults)) != len(faults):
        raise RuntimeError(f"{episode_id} step {step} deviceHealth faults must be unique")
    estop_engaged = raw.get("estopEngaged")
    watchdog_healthy = raw.get("watchdogHealthy")
    actuator_states = raw.get("actuatorStates")
    if (
        not isinstance(actuator_states, list)
        or len(actuator_states) != action_size
        or not all(type(item) is str and item in ACTUATOR_STATES for item in actuator_states)
    ):
        raise RuntimeError(
            f"{episode_id} step {step} deviceHealth actuatorStates must contain "
            f"{action_size} ready/derated/faulted/offline values"
        )
    if type(estop_engaged) is not bool or type(watchdog_healthy) is not bool:
        raise RuntimeError(f"{episode_id} step {step} deviceHealth status flags must be boolean")
    return {
        "motorTemperatureC": temperatures.tolist(),
        "motorCurrentA": currents.tolist(),
        "actuatorStates": list(actuator_states),
        "busVoltageV": bus_voltage,
        "faults": list(faults),
        "estopEngaged": estop_engaged,
        "watchdogHealthy": watchdog_healthy,
    }


def _state_age_reason(state_age_ms: float | None, maximum_state_age_ms: float | None) -> str | None:
    if maximum_state_age_ms is None:
        return None
    if state_age_ms is None:
        return "state age telemetry is missing"
    if state_age_ms > maximum_state_age_ms:
        return f"state age {state_age_ms:.6f} ms exceeds maximum {maximum_state_age_ms:.6f} ms"
    return None


def _device_health_assessment(device_health: dict[str, Any] | None, safety: dict[str, Any]) -> dict[str, Any]:
    if device_health is None:
        reasons = ["device health telemetry is missing"] if bool(safety.get("requireDeviceHealth", False)) else []
        return {"reasons": reasons, "affectedActuatorIndices": [], "scope": "device" if reasons else "none"}
    reasons: list[str] = []
    affected_indices: set[int] = set()
    device_fault = False
    temperatures = np.asarray(device_health["motorTemperatureC"], dtype=np.float64)
    currents = np.asarray(device_health["motorCurrentA"], dtype=np.float64)
    maximum_temperature = float(np.max(temperatures)) if temperatures.size else 0.0
    maximum_current = float(np.max(np.abs(currents))) if currents.size else 0.0
    bus_voltage = float(device_health["busVoltageV"])
    if safety.get("maximumMotorTemperatureC") is not None and maximum_temperature > float(safety["maximumMotorTemperatureC"]):
        reasons.append(f"motor temperature {maximum_temperature:.6f} C exceeds maximum {float(safety['maximumMotorTemperatureC']):.6f} C")
        affected_indices.update(int(index) for index in np.flatnonzero(temperatures > float(safety["maximumMotorTemperatureC"])))
    if safety.get("maximumMotorCurrentA") is not None and maximum_current > float(safety["maximumMotorCurrentA"]):
        reasons.append(f"motor current {maximum_current:.6f} A exceeds maximum {float(safety['maximumMotorCurrentA']):.6f} A")
        affected_indices.update(int(index) for index in np.flatnonzero(np.abs(currents) > float(safety["maximumMotorCurrentA"])))
    non_ready = [(index, state) for index, state in enumerate(device_health["actuatorStates"]) if state != "ready"]
    if non_ready:
        affected_indices.update(index for index, _ in non_ready)
        reasons.append("actuator states are unsafe: " + ",".join(f"{index}:{state}" for index, state in non_ready))
    if safety.get("minimumBusVoltageV") is not None and bus_voltage < float(safety["minimumBusVoltageV"]):
        reasons.append(f"bus voltage {bus_voltage:.6f} V is below minimum {float(safety['minimumBusVoltageV']):.6f} V")
        device_fault = True
    if safety.get("maximumBusVoltageV") is not None and bus_voltage > float(safety["maximumBusVoltageV"]):
        reasons.append(f"bus voltage {bus_voltage:.6f} V exceeds maximum {float(safety['maximumBusVoltageV']):.6f} V")
        device_fault = True
    if device_health["faults"]:
        reasons.append(f"driver faults are active: {','.join(device_health['faults'])}")
        device_fault = True
    if bool(device_health["estopEngaged"]):
        reasons.append("physical E-stop is engaged")
        device_fault = True
    if not bool(device_health["watchdogHealthy"]):
        reasons.append("driver watchdog is unhealthy")
        device_fault = True
    scope = "mixed" if affected_indices and device_fault else "actuator" if affected_indices else "device" if device_fault else "none"
    return {"reasons": reasons, "affectedActuatorIndices": sorted(affected_indices), "scope": scope}


def _device_health_reasons(device_health: dict[str, Any] | None, safety: dict[str, Any]) -> list[str]:
    return list(_device_health_assessment(device_health, safety)["reasons"])


def _stopped_acknowledged(message: dict[str, Any], episode_id: str | None, kind: str) -> bool:
    return message.get("type") == "stopped" and message.get("episode") == episode_id and message.get("kind") == kind


def _post_stop_health_window(
    session: DriverSession,
    episode_id: str | None,
    action_size: int,
    safety: dict[str, Any],
    timeout_seconds: float,
    trip: dict[str, Any],
) -> dict[str, Any]:
    requested_samples = int(safety["postStopHealthySamples"])
    minimum_duration_ms = float(safety["postStopMinimumHealthyDurationMs"])
    interval_seconds = minimum_duration_ms / 1000.0 / float(requested_samples - 1)
    samples: list[dict[str, Any]] = []
    received_times_ns: list[int] = []
    for sequence in range(requested_samples):
        if sequence > 0:
            time.sleep(interval_seconds)
        session.send({"type": "health-check", "episode": episode_id, "sequence": sequence})
        message, received_ns = session.receive(timeout_seconds)
        if (
            message.get("type") != "health-state"
            or message.get("episode") != episode_id
            or int(message.get("sequence", -1)) != sequence
            or message.get("stopLatched") is not True
        ):
            raise RuntimeError(f"Driver returned an invalid stop-latched health sample {sequence}")
        health = _device_health(message.get("deviceHealth"), action_size, str(episode_id), sequence, True)
        assessment = _device_health_assessment(health, safety)
        samples.append({"sequence": sequence, "deviceHealth": health, **assessment})
        received_times_ns.append(received_ns)
    observed_duration_ms = (
        (received_times_ns[-1] - received_times_ns[0]) / 1_000_000.0
        if len(received_times_ns) > 1
        else 0.0
    )
    healthy_samples = sum(not sample["reasons"] for sample in samples)
    recovery_eligible = (
        trip.get("kind") == "device-health"
        and healthy_samples == requested_samples
        and observed_duration_ms >= minimum_duration_ms
    )
    return {
        "episode": episode_id,
        "trip": trip,
        "requestedSamples": requested_samples,
        "minimumHealthyDurationMs": minimum_duration_ms,
        "observedDurationMs": observed_duration_ms,
        "healthySamples": healthy_samples,
        "samples": samples,
        "recoveryEligible": recovery_eligible,
        "requiresNewSession": True,
        "stateTransitions": [
            "armed",
            "tripped",
            "stop-acknowledged",
            "health-checking",
            "recovery-eligible" if recovery_eligible else "recovery-blocked",
        ],
    }


def _driver_deadline_rejection(message: dict[str, Any], episode_id: str, step: int) -> float | None:
    if message.get("type") != "deadline-rejected":
        return None
    if message.get("episode") != episode_id or int(message.get("step", -1)) != step:
        raise RuntimeError(f"Driver deadline rejection does not match episode '{episode_id}' step {step}")
    observed_ms = float(message.get("observedDecisionLatencyMs", float("nan")))
    if not np.isfinite(observed_ms) or observed_ms < 0:
        raise RuntimeError("Driver deadline rejection lacks a finite nonnegative observedDecisionLatencyMs")
    return observed_ms


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
    controller_warmup_passes = int(getattr(controller, "warmup_passes", 0))

    transcript: list[dict[str, Any]] = []
    episode_rows: dict[str, list[dict[str, Any]]] = {}
    episode_results: list[dict[str, Any]] = []
    interventions: list[dict[str, Any]] = []
    decision_latencies_ms: list[float] = []
    dispatch_latencies_ms: list[float] = []
    driver_rejection_latencies_ms: list[float] = []
    state_ages_ms: list[float] = []
    device_health_samples: list[dict[str, Any]] = []
    device_health_trips: list[dict[str, Any]] = []
    post_stop_windows: list[dict[str, Any]] = []
    deadline_misses = 0
    host_pre_dispatch_deadline_misses = 0
    driver_deadline_rejections = 0
    maximum_consecutive_misses = 0
    consecutive_misses = 0
    emergency_stops = 0
    emergency_stop_acknowledgements = 0
    safe_stops = 0
    status = "COMPLETED"
    reasons: list[str] = []
    device: dict[str, str] | None = None
    protocol_capabilities: list[str] = []
    started_at = _utc_now()
    timeout_seconds = max(1.0, 5.0 / float(target["controlHz"]))
    startup_timeout_seconds = max(5.0, timeout_seconds)
    maximum_decision_latency_ms = float(plan["safety"].get("maximumDecisionLatencyMs", target["safety"]["maximumLatencyMs"]))
    if maximum_decision_latency_ms > float(target["safety"]["maximumLatencyMs"]):
        raise RuntimeError("Capture Plan decision deadline exceeds Hardware Target maximumLatencyMs")

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
        raw_capabilities = hello.get("capabilities", [])
        if not isinstance(raw_capabilities, list) or not all(isinstance(item, str) for item in raw_capabilities):
            raise RuntimeError("Driver capabilities must be a string array")
        protocol_capabilities = sorted(set(raw_capabilities))
        required_capabilities = {"stop-ack"}
        if target["safety"].get("maximumStateAgeMs") is not None:
            required_capabilities.update({"applied-action", "state-age-ms"})
        if plan["mode"] == "shadow":
            required_capabilities.update({"applied-action", "shadow-action", "state-age-ms"})
        if bool(target["safety"].get("requireDecisionDeadline", False)) or plan["safety"].get("maximumDecisionLatencyMs") is not None:
            required_capabilities.add("decision-deadline")
        if bool(target["safety"].get("requireDeviceHealth", False)):
            required_capabilities.add("device-health")
        if bool(target["safety"].get("requirePostStopHealthCheck", False)):
            required_capabilities.add("latched-stop-health")
        missing_capabilities = sorted(required_capabilities.difference(protocol_capabilities))
        if missing_capabilities:
            raise RuntimeError(f"Driver lacks required capabilities: {', '.join(missing_capabilities)}")

        action_low = np.asarray(compiled["actionLow"], dtype=np.float64)
        action_high = np.asarray(compiled["actionHigh"], dtype=np.float64)
        emergency_action = _finite_vector(target["safety"]["emergencyStopAction"], model.nu, "emergency-stop Action")
        maximum_delta = float(plan["action"]["maximumSlewPerSecond"]) / float(target["controlHz"])
        maximum_state_age_ms = target["safety"].get("maximumStateAgeMs")
        driver_deadline_enabled = "decision-deadline" in protocol_capabilities
        require_telemetry = maximum_state_age_ms is not None or plan["mode"] == "shadow"
        require_device_health = bool(target["safety"].get("requireDeviceHealth", False))
        for episode in plan["episodes"]:
            episode_id = str(episode["id"])
            planned_steps = int(episode["steps"])
            controller.reset(int(episode["seed"]))
            previous_action = emergency_action.copy()
            rows: list[dict[str, Any]] = []
            completed_steps = 0
            episode_reason: str | None = None
            episode_trip: dict[str, Any] | None = None
            session.send({"type": "start-episode", "episode": episode_id, "seed": int(episode["seed"]), "steps": planned_steps, "controlHz": float(target["controlHz"])})
            message, received_ns = session.receive(startup_timeout_seconds)
            qpos, qvel, observation_vector, current_applied, state_age_ms, device_health = _state_vectors(
                message, model, int(compiled["observationContract"]["size"]), model.nu, episode_id, 0, require_telemetry, require_device_health,
            )
            if state_age_ms is not None:
                state_ages_ms.append(state_age_ms)
            if device_health is not None:
                device_health_samples.append(device_health)
            for step in range(planned_steps):
                state_reasons = _state_safety_reasons(model, qpos, qvel, plan["safety"])
                state_age_reason = _state_age_reason(state_age_ms, None if maximum_state_age_ms is None else float(maximum_state_age_ms))
                if state_age_reason is not None:
                    state_reasons.append(state_age_reason)
                health_assessment = _device_health_assessment(device_health, target["safety"])
                health_reasons = list(health_assessment["reasons"])
                state_reasons.extend(health_reasons)
                if state_reasons:
                    if health_reasons:
                        episode_trip = {
                            "episode": episode_id,
                            "step": step,
                            "kind": "device-health",
                            **health_assessment,
                        }
                        interventions.append(episode_trip)
                        device_health_trips.append(episode_trip)
                    else:
                        episode_trip = {
                            "episode": episode_id,
                            "step": step,
                            "kind": "state-safety",
                            "reasons": list(state_reasons),
                            "affectedActuatorIndices": [],
                            "scope": "robot",
                        }
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
                decision_ms = (time.perf_counter_ns() - received_ns) / 1_000_000.0
                decision_latencies_ms.append(decision_ms)
                if decision_ms > maximum_decision_latency_ms:
                    deadline_misses += 1
                    host_pre_dispatch_deadline_misses += 1
                    consecutive_misses += 1
                    maximum_consecutive_misses = max(maximum_consecutive_misses, consecutive_misses)
                    interventions.append({
                        "episode": episode_id,
                        "step": step,
                        "kind": "host-decision-deadline",
                        "observedDecisionLatencyMs": decision_ms,
                        "maximumDecisionLatencyMs": maximum_decision_latency_ms,
                    })
                    episode_reason = f"host decision latency {decision_ms:.6f} ms exceeds maximum {maximum_decision_latency_ms:.6f} ms before dispatch"
                    episode_trip = {
                        "episode": episode_id,
                        "step": step,
                        "kind": "host-decision-deadline",
                        "reasons": [episode_reason],
                        "affectedActuatorIndices": [],
                        "scope": "host",
                    }
                    break
                rows.append({
                    "episode": episode_id,
                    "step": step,
                    "time": step / float(target["controlHz"]),
                    "qpos": qpos.tolist(),
                    "qvel": qvel.tolist(),
                    **({"deviceHealth": device_health} if device_health is not None else {}),
                    "proposedAction": action.tolist(),
                    "commandedAction": (action if plan["mode"] == "actuate" else (current_applied if current_applied is not None else emergency_action)).tolist(),
                })
                action_message = {
                    "type": "action" if plan["mode"] == "actuate" else "shadow-action",
                    "episode": episode_id,
                    "step": step,
                    **({"action": action.tolist()} if plan["mode"] == "actuate" else {"proposedAction": action.tolist()}),
                }
                if driver_deadline_enabled:
                    action_message["maximumDecisionLatencyMs"] = maximum_decision_latency_ms
                sent_ns = session.send(action_message)
                dispatch_ms = (sent_ns - received_ns) / 1_000_000.0
                dispatch_latencies_ms.append(dispatch_ms)
                dispatch_late = dispatch_ms > maximum_decision_latency_ms
                if dispatch_late:
                    deadline_misses += 1
                    consecutive_misses += 1
                    maximum_consecutive_misses = max(maximum_consecutive_misses, consecutive_misses)
                else:
                    consecutive_misses = 0
                message, received_ns = session.receive(timeout_seconds)
                rejected_ms = _driver_deadline_rejection(message, episode_id, step)
                if rejected_ms is not None:
                    driver_deadline_rejections += 1
                    driver_rejection_latencies_ms.append(rejected_ms)
                    if not dispatch_late:
                        deadline_misses += 1
                        consecutive_misses += 1
                        maximum_consecutive_misses = max(maximum_consecutive_misses, consecutive_misses)
                    rows[-1]["appliedAction"] = (current_applied if current_applied is not None else emergency_action).tolist()
                    rows[-1]["deadlineRejected"] = True
                    rows[-1]["observedDecisionLatencyMs"] = rejected_ms
                    interventions.append({
                        "episode": episode_id,
                        "step": step,
                        "kind": "driver-decision-deadline",
                        "observedDecisionLatencyMs": rejected_ms,
                        "maximumDecisionLatencyMs": maximum_decision_latency_ms,
                    })
                    episode_reason = f"driver rejected expired Action at {rejected_ms:.6f} ms (maximum {maximum_decision_latency_ms:.6f} ms)"
                    episode_trip = {
                        "episode": episode_id,
                        "step": step,
                        "kind": "driver-decision-deadline",
                        "reasons": [episode_reason],
                        "affectedActuatorIndices": [],
                        "scope": "driver",
                    }
                    break
                qpos, qvel, observation_vector, next_applied, state_age_ms, device_health = _state_vectors(
                    message, model, int(compiled["observationContract"]["size"]), model.nu, episode_id, step + 1, require_telemetry, require_device_health,
                )
                if state_age_ms is not None:
                    state_ages_ms.append(state_age_ms)
                if device_health is not None:
                    device_health_samples.append(device_health)
                actual_applied = action if next_applied is None else next_applied
                rows[-1]["appliedAction"] = actual_applied.tolist()
                if plan["mode"] == "shadow":
                    rows[-1]["commandedAction"] = actual_applied.tolist()
                if dispatch_late:
                    episode_reason = f"host dispatch latency {dispatch_ms:.6f} ms exceeded maximum {maximum_decision_latency_ms:.6f} ms but Driver applied the Action"
                    episode_trip = {
                        "episode": episode_id,
                        "step": step,
                        "kind": "host-dispatch-deadline",
                        "reasons": [episode_reason],
                        "affectedActuatorIndices": [],
                        "scope": "host",
                    }
                    break
                current_applied = actual_applied
                previous_action = action
                completed_steps += 1
            if episode_reason is None:
                terminal_reasons = _state_safety_reasons(model, qpos, qvel, plan["safety"])
                terminal_age_reason = _state_age_reason(state_age_ms, None if maximum_state_age_ms is None else float(maximum_state_age_ms))
                if terminal_age_reason is not None:
                    terminal_reasons.append(terminal_age_reason)
                terminal_health = _device_health_assessment(device_health, target["safety"])
                terminal_reasons.extend(terminal_health["reasons"])
                if terminal_reasons:
                    episode_reason = "; ".join(terminal_reasons)
                    episode_trip = {
                        "episode": episode_id,
                        "step": planned_steps,
                        "kind": "device-health" if terminal_health["reasons"] else "state-safety",
                        "reasons": terminal_reasons,
                        "affectedActuatorIndices": terminal_health["affectedActuatorIndices"],
                        "scope": terminal_health["scope"] if terminal_health["reasons"] else "robot",
                    }
                    if terminal_health["reasons"]:
                        interventions.append(episode_trip)
                        device_health_trips.append(episode_trip)
            if episode_reason is None:
                rows.append({
                    "episode": episode_id,
                    "step": planned_steps,
                    "time": planned_steps / float(target["controlHz"]),
                    "qpos": qpos.tolist(),
                    "qvel": qvel.tolist(),
                    **({"deviceHealth": device_health} if device_health is not None else {}),
                    "proposedAction": emergency_action.tolist(),
                    "commandedAction": emergency_action.tolist(),
                    "appliedAction": (current_applied if current_applied is not None else emergency_action).tolist(),
                })
                session.send({"type": "safe-stop", "episode": episode_id, "action": emergency_action.tolist()})
                stopped, _ = session.receive(timeout_seconds)
                if not _stopped_acknowledged(stopped, episode_id, "safe-stop"):
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
                    stopped, _ = session.receive(timeout_seconds)
                    if not _stopped_acknowledged(stopped, episode_id, "emergency-stop"):
                        raise RuntimeError(f"Driver returned an invalid emergency-stop acknowledgement for '{episode_id}'")
                    emergency_stop_acknowledgements += 1
                    if bool(target["safety"].get("requirePostStopHealthCheck", False)):
                        trip = episode_trip or {
                            "episode": episode_id,
                            "step": completed_steps,
                            "kind": "episode-abort",
                            "reasons": [episode_reason],
                            "affectedActuatorIndices": [],
                            "scope": "unknown",
                        }
                        post_stop_windows.append(_post_stop_health_window(
                            session, episode_id, model.nu, target["safety"], timeout_seconds, trip,
                        ))
                except Exception as error:
                    status = "FAILED"
                    reasons.append(f"{episode_id}: emergency stop or post-stop health check failed: {error}")
                episode_results.append({"id": episode_id, "seed": int(episode["seed"]), "plannedSteps": planned_steps, "steps": completed_steps, "completed": False, "reason": episode_reason})
                break
    except Exception as error:
        status = "FAILED"
        reasons.append(str(error))
        if session is not None and session.process.poll() is None:
            try:
                session.send({"type": "emergency-stop", "action": target["safety"]["emergencyStopAction"], "reason": str(error)})
                emergency_stops += 1
                stopped, _ = session.receive(timeout_seconds)
                if _stopped_acknowledged(stopped, None, "emergency-stop"):
                    emergency_stop_acknowledgements += 1
                    if bool(target["safety"].get("requirePostStopHealthCheck", False)):
                        post_stop_windows.append(_post_stop_health_window(
                            session,
                            None,
                            model.nu,
                            target["safety"],
                            timeout_seconds,
                            {
                                "episode": None,
                                "step": None,
                                "kind": "session-failure",
                                "reasons": [str(error)],
                                "affectedActuatorIndices": [],
                                "scope": "unknown",
                            },
                        ))
                else:
                    reasons.append("session emergency stop acknowledgement was invalid")
            except Exception as stop_error:
                reasons.append(f"session emergency stop was not acknowledged: {stop_error}")
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
    maximum_state_age = max(state_ages_ms, default=0.0)
    mean_state_age = float(np.mean(state_ages_ms)) if state_ages_ms else 0.0
    motor_temperatures = [float(value) for sample in device_health_samples for value in sample["motorTemperatureC"]]
    motor_currents = [abs(float(value)) for sample in device_health_samples for value in sample["motorCurrentA"]]
    bus_voltages = [float(sample["busVoltageV"]) for sample in device_health_samples]
    maximum_motor_temperature = max(motor_temperatures, default=0.0)
    maximum_motor_current = max(motor_currents, default=0.0)
    minimum_bus_voltage = min(bus_voltages, default=0.0)
    maximum_bus_voltage = max(bus_voltages, default=0.0)
    device_fault_samples = sum(bool(sample["faults"]) for sample in device_health_samples)
    estop_engaged_samples = sum(bool(sample["estopEngaged"]) for sample in device_health_samples)
    watchdog_unhealthy_samples = sum(not bool(sample["watchdogHealthy"]) for sample in device_health_samples)
    actuator_state_counts = {
        state: sum(item == state for sample in device_health_samples for item in sample["actuatorStates"])
        for state in sorted(ACTUATOR_STATES)
    }
    affected_actuator_indices = sorted({
        int(index)
        for trip in device_health_trips
        for index in trip["affectedActuatorIndices"]
    })
    post_stop_samples = [sample for window in post_stop_windows for sample in window["samples"]]
    post_stop_healthy_samples = sum(not sample["reasons"] for sample in post_stop_samples)
    recovery_candidates = sum(bool(window["recoveryEligible"]) for window in post_stop_windows)
    maximum_decision_latency = max(decision_latencies_ms, default=0.0)
    mean_decision_latency = float(np.mean(decision_latencies_ms)) if decision_latencies_ms else 0.0
    actuation_authorized = plan["mode"] == "actuate"
    real_time_qualified = deadline_misses == 0
    state_age_evidence = {
        "samples": len(state_ages_ms),
        "maximumMs": maximum_state_age,
        "meanMs": mean_state_age,
    }
    state_age_identity = {
        "samples": len(state_ages_ms),
        "maximumMicroseconds": round(maximum_state_age * 1000.0),
        "meanMicroseconds": round(mean_state_age * 1000.0),
    }
    decision_deadline_identity = {
        "maximumMicroseconds": round(maximum_decision_latency * 1000.0),
        "meanMicroseconds": round(mean_decision_latency * 1000.0),
        "samples": len(decision_latencies_ms),
        "hostPreDispatchMisses": host_pre_dispatch_deadline_misses,
        "driverRejections": driver_deadline_rejections,
    }
    device_health_identity = {
        "samples": len(device_health_samples),
        "maximumMotorTemperatureMilliC": round(maximum_motor_temperature * 1000.0),
        "maximumMotorCurrentMilliA": round(maximum_motor_current * 1000.0),
        "minimumBusVoltageMilliV": round(minimum_bus_voltage * 1000.0),
        "maximumBusVoltageMilliV": round(maximum_bus_voltage * 1000.0),
        "faultSamples": device_fault_samples,
        "estopEngagedSamples": estop_engaged_samples,
        "watchdogUnhealthySamples": watchdog_unhealthy_samples,
        "actuatorStateCounts": actuator_state_counts,
        "tripCount": len(device_health_trips),
        "affectedActuatorIndices": affected_actuator_indices,
    }
    post_stop_health_identity = {
        "windows": len(post_stop_windows),
        "samples": len(post_stop_samples),
        "healthySamples": post_stop_healthy_samples,
        "recoveryCandidates": recovery_candidates,
        "maximumObservedDurationMicroseconds": round(max(
            (float(window["observedDurationMs"]) for window in post_stop_windows),
            default=0.0,
        ) * 1000.0),
        "terminalStates": [
            window["stateTransitions"][-1]
            for window in post_stop_windows
        ],
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
        "mode": plan["mode"],
        "actuationAuthorized": actuation_authorized,
        "protocolCapabilities": protocol_capabilities,
        "stateAgeIdentity": state_age_identity,
        "decisionDeadlineIdentity": decision_deadline_identity,
        "deviceHealthIdentity": device_health_identity,
        "postStopHealthIdentity": post_stop_health_identity,
        "emergencyStopAcknowledgements": emergency_stop_acknowledgements,
        "controllerWarmupPasses": controller_warmup_passes,
        "realTimeQualified": real_time_qualified,
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
            "mode": plan["mode"],
            "actuationAuthorized": actuation_authorized,
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
            "decisionDeadline": {
                "maximumLatencyMs": maximum_decision_latency_ms,
                "samples": len(decision_latencies_ms),
                "maximumObservedLatencyMs": maximum_decision_latency,
                "meanObservedLatencyMs": mean_decision_latency,
                "hostPreDispatchMisses": host_pre_dispatch_deadline_misses,
                "driverRejections": driver_deadline_rejections,
                "maximumDriverRejectedLatencyMs": max(driver_rejection_latencies_ms, default=0.0),
            },
            "deviceHealth": {
                "samples": len(device_health_samples),
                "maximumMotorTemperatureC": maximum_motor_temperature,
                "maximumMotorCurrentA": maximum_motor_current,
                "minimumBusVoltageV": minimum_bus_voltage,
                "maximumBusVoltageV": maximum_bus_voltage,
                "faultSamples": device_fault_samples,
                "estopEngagedSamples": estop_engaged_samples,
                "watchdogUnhealthySamples": watchdog_unhealthy_samples,
                "actuatorStateCounts": actuator_state_counts,
                "trips": len(device_health_trips),
                "affectedActuatorIndices": affected_actuator_indices,
            },
            "stopRecovery": {
                "windows": post_stop_windows,
                "samples": len(post_stop_samples),
                "healthySamples": post_stop_healthy_samples,
                "recoveryCandidates": recovery_candidates,
                "requiresNewSession": True,
            },
            "protocolCapabilities": protocol_capabilities,
            "stateAge": state_age_evidence,
            "interventions": interventions,
            "safeStops": safe_stops,
            "emergencyStops": emergency_stops,
            "emergencyStopAcknowledgements": emergency_stop_acknowledgements,
            "reasons": reasons,
            "realTimeQualified": real_time_qualified,
            "controllerWarmupPasses": controller_warmup_passes,
            "calibrationEligible": actuation_authorized and real_time_qualified and status == "COMPLETED" and all(item["completed"] for item in completed_episodes),
            "completed": True,
        }
        write_json(directory / "manifest.json", manifest)
        (directory / "report.md").write_text(
            "# Hardware capture\n\n"
            f"- Status: {status}\n"
            f"- Environment: {target['environment']}\n"
            f"- Mode: {plan['mode']}\n"
            f"- Actuation authorized: {str(actuation_authorized).lower()}\n"
            f"- Device: {device['vendor']} {device['model']} ({device['serial']})\n"
            f"- Episodes: {sum(item['completed'] for item in completed_episodes)}/{len(plan['episodes'])}\n"
            f"- Dispatch latency max/mean: {maximum_latency:.6f}/{mean_latency:.6f} ms\n"
            f"- Decision latency max/mean/limit: {maximum_decision_latency:.6f}/{mean_decision_latency:.6f}/{maximum_decision_latency_ms:.6f} ms\n"
            f"- Host pre-dispatch deadline misses: {host_pre_dispatch_deadline_misses}\n"
            f"- Driver deadline rejections: {driver_deadline_rejections}\n"
            f"- Device health samples: {len(device_health_samples)}\n"
            f"- Motor temperature/current max: {maximum_motor_temperature:.6f} C / {maximum_motor_current:.6f} A\n"
            f"- Bus voltage min/max: {minimum_bus_voltage:.6f}/{maximum_bus_voltage:.6f} V\n"
            f"- Driver fault/E-stop/watchdog-unhealthy samples: {device_fault_samples}/{estop_engaged_samples}/{watchdog_unhealthy_samples}\n"
            f"- Actuator states ready/derated/faulted/offline: {actuator_state_counts['ready']}/{actuator_state_counts['derated']}/{actuator_state_counts['faulted']}/{actuator_state_counts['offline']}\n"
            f"- Device-health trips / affected actuator indices: {len(device_health_trips)} / {affected_actuator_indices}\n"
            f"- Stop-latched health windows/samples/healthy: {len(post_stop_windows)}/{len(post_stop_samples)}/{post_stop_healthy_samples}\n"
            f"- Recovery candidates (new session required): {recovery_candidates}\n"
            f"- State age max/mean: {maximum_state_age:.6f}/{mean_state_age:.6f} ms\n"
            f"- Deadline misses: {deadline_misses}\n"
            f"- Safety interventions: {len(interventions)}\n"
            f"- Emergency stops: {emergency_stops}\n"
            f"- Emergency-stop acknowledgements: {emergency_stop_acknowledgements}\n"
            f"- Controller warm-up passes before driver connection: {controller_warmup_passes}\n"
            f"- Real-time qualified: {str(real_time_qualified).lower()}\n"
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
        "mode": plan["mode"],
        "actuationAuthorized": actuation_authorized,
        "device": device,
        "episodes": episode_results,
        "maximumDispatchLatencyMs": maximum_latency,
        "maximumDecisionLatencyMs": maximum_decision_latency,
        "maximumStateAgeMs": maximum_state_age,
        "deadlineMisses": deadline_misses,
        "hostPreDispatchDeadlineMisses": host_pre_dispatch_deadline_misses,
        "driverDeadlineRejections": driver_deadline_rejections,
        "deviceHealthSamples": len(device_health_samples),
        "maximumMotorTemperatureC": maximum_motor_temperature,
        "maximumMotorCurrentA": maximum_motor_current,
        "minimumBusVoltageV": minimum_bus_voltage,
        "maximumBusVoltageV": maximum_bus_voltage,
        "deviceHealthTrips": len(device_health_trips),
        "affectedActuatorIndices": affected_actuator_indices,
        "postStopHealthChecks": len(post_stop_samples),
        "postStopRecoveryCandidates": recovery_candidates,
        "recoveryEligible": recovery_candidates > 0,
        "recoveryRequiresNewSession": True,
        "interventions": len(interventions),
        "emergencyStops": emergency_stops,
        "emergencyStopAcknowledgements": emergency_stop_acknowledgements,
        "controllerWarmupPasses": controller_warmup_passes,
        "realTimeQualified": real_time_qualified,
        "calibrationEligible": actuation_authorized and real_time_qualified and status == "COMPLETED" and len(episode_rows) == len(plan["episodes"]),
        "reasons": reasons,
    }
