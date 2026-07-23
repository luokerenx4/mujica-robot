#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import select
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np

from mujica_runtime.environment import RobotEnvironment


PROTOCOL = "stdio-jsonl-v1"


def receive(timeout_seconds: float | None = None) -> dict[str, Any]:
    if timeout_seconds is not None:
        readable, _, _ = select.select([sys.stdin], [], [], max(0.0, timeout_seconds))
        if not readable:
            raise TimeoutError
    line = sys.stdin.readline()
    if not line:
        raise EOFError
    value = json.loads(line)
    if not isinstance(value, dict):
        raise RuntimeError("protocol message must be an object")
    return value


def send(value: dict[str, Any]) -> int:
    sys.stdout.write(json.dumps(value, separators=(",", ":"), ensure_ascii=False) + "\n")
    sys.stdout.flush()
    return time.perf_counter_ns()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scenario", required=True)
    parser.add_argument("--state-age-ms", type=float, default=0.0)
    parser.add_argument("--receive-delay-ms", type=float, default=0.0)
    parser.add_argument("--motor-temperature-c", type=float, default=40.0)
    parser.add_argument("--motor-current-a", type=float, default=0.0)
    parser.add_argument("--bus-voltage-v", type=float, default=24.0)
    parser.add_argument("--fault", action="append", default=[])
    parser.add_argument("--actuator-state", action="append", default=[])
    parser.add_argument("--estop-engaged", action="store_true")
    parser.add_argument("--watchdog-unhealthy", action="store_true")
    parser.add_argument("--post-stop-clear-health", action="store_true")
    arguments = parser.parse_args()
    if any(not np.isfinite(value) or value < 0 for value in (
        arguments.receive_delay_ms,
        arguments.motor_temperature_c,
        arguments.motor_current_a,
        arguments.bus_voltage_v,
    )):
        raise RuntimeError("delay and device health numeric arguments must be finite and nonnegative")
    bundle_root = Path(os.environ["MUJICA_HARDWARE_BUNDLE"])
    bundle = json.loads((bundle_root / "manifest.json").read_text())
    compiled = json.loads((bundle_root / "revision" / "compiled" / "compiled-assembly.json").read_text())
    compiled["actionLow"] = [channel.get("low", -1) for channel in compiled["actionContract"]["channels"] for _ in range(int(channel["size"]))]
    compiled["actionHigh"] = [channel.get("high", 1) for channel in compiled["actionContract"]["channels"] for _ in range(int(channel["size"]))]
    model_path = bundle_root / "revision" / "compiled" / "model.xml"
    scenario = json.loads(Path(arguments.scenario).read_text())
    target = bundle["target"]
    command_lease_ms = target["safety"].get("commandLeaseMs")
    if type(command_lease_ms) is not int or command_lease_ms < 10:
        raise RuntimeError("Bundle Target must declare an integer commandLeaseMs of at least 10 ms")
    action_size = int(compiled["actionContract"]["size"])
    actuator_states = ["ready"] * action_size
    for specification in arguments.actuator_state:
        try:
            raw_index, state = specification.split(":", 1)
            index = int(raw_index)
        except ValueError as error:
            raise RuntimeError("--actuator-state must use INDEX:ready|derated|faulted|offline") from error
        if index < 0 or index >= action_size or state not in {"ready", "derated", "faulted", "offline"}:
            raise RuntimeError("--actuator-state index or state is invalid for this Action contract")
        actuator_states[index] = state
    device_health = {
        "motorTemperatureC": [arguments.motor_temperature_c] * action_size,
        "motorCurrentA": [arguments.motor_current_a] * action_size,
        "actuatorStates": actuator_states,
        "busVoltageV": arguments.bus_voltage_v,
        "faults": list(arguments.fault),
        "estopEngaged": bool(arguments.estop_engaged),
        "watchdogHealthy": not bool(arguments.watchdog_unhealthy),
    }
    post_stop_device_health = {
        **device_health,
        "motorTemperatureC": list(device_health["motorTemperatureC"]),
        "motorCurrentA": list(device_health["motorCurrentA"]),
        "actuatorStates": list(device_health["actuatorStates"]),
        "faults": list(device_health["faults"]),
    }
    if arguments.post_stop_clear_health:
        post_stop_device_health = {
            "motorTemperatureC": [40.0] * action_size,
            "motorCurrentA": [0.0] * action_size,
            "actuatorStates": ["ready"] * action_size,
            "busVoltageV": 24.0,
            "faults": [],
            "estopEngaged": False,
            "watchdogHealthy": True,
        }
    environment: RobotEnvironment | None = None
    observation: dict[str, np.ndarray] | None = None
    active_episode: str | None = None
    state_sent_ns: int | None = None
    stop_latched = False
    last_applied = np.asarray(target["safety"]["emergencyStopAction"], dtype=np.float64)
    lease_renewed_ns: int | None = None
    lease_deadline_ns: int | None = None
    last_accepted_step: int | None = None

    hello = receive()
    if (
        hello.get("type") != "hello"
        or hello.get("protocol") != PROTOCOL
        or hello.get("commandLeaseMs") != command_lease_ms
    ):
        raise RuntimeError("invalid host hello")
    send({
        **hello,
        "device": {
            "vendor": target["device"]["vendor"],
            "model": target["device"]["model"],
            "serial": "simulated",
        },
        "capabilities": ["applied-action", "command-lease", "decision-deadline", "device-health", "latched-stop-health", "shadow-action", "state-age-ms", "stop-ack"],
    })

    while True:
        timeout_seconds = None if lease_deadline_ns is None else (lease_deadline_ns - time.perf_counter_ns()) / 1_000_000_000.0
        try:
            message = receive(timeout_seconds)
        except EOFError:
            if environment is not None:
                environment.data.ctrl[:] = np.asarray(target["safety"]["emergencyStopAction"], dtype=np.float64)
            return
        except TimeoutError:
            if active_episode is None or lease_renewed_ns is None:
                raise RuntimeError("command lease expired without an active episode")
            expired_ns = time.perf_counter_ns()
            observed_silence_ms = (expired_ns - lease_renewed_ns) / 1_000_000.0
            if environment is not None:
                environment.data.ctrl[:] = np.asarray(target["safety"]["emergencyStopAction"], dtype=np.float64)
            send({
                "type": "lease-expired",
                "episode": active_episode,
                "lastAcceptedStep": last_accepted_step,
                "commandLeaseMs": command_lease_ms,
                "observedSilenceMs": observed_silence_ms,
                "stopLatched": True,
                "appliedAction": list(target["safety"]["emergencyStopAction"]),
                "deviceHealth": post_stop_device_health,
            })
            environment = None
            observation = None
            active_episode = None
            stop_latched = True
            lease_renewed_ns = None
            lease_deadline_ns = None
            continue
        kind = message.get("type")
        if kind == "start-episode":
            if stop_latched:
                raise RuntimeError("cannot start an episode while the Driver stop is latched")
            if message.get("commandLeaseMs") != command_lease_ms:
                raise RuntimeError("start-episode command lease differs from the frozen Target")
            active_episode = str(message["episode"])
            control_hz = float(message["controlHz"])
            steps = int(message["steps"])
            task = {
                "version": 2,
                "id": "hardware-capture",
                "name": "Protocol capture episode",
                "durationSeconds": steps / control_hz,
                "controlHz": control_hz,
                "healthyHeight": [0.1, 1.0],
                "terminateOnFall": False,
                "motionCommand": {
                    "frame": "world",
                    "linearVelocityMps": [0.0, 0.0],
                    "yawRateRadPerSec": 0.0,
                },
            }
            environment = RobotEnvironment(model_path, compiled, task, scenario, int(message["seed"]))
            observation = environment.reset()
            last_applied = np.asarray(target["safety"]["emergencyStopAction"], dtype=np.float64)
            state_sent_ns = send({
                "type": "state",
                "episode": active_episode,
                "step": 0,
                "qpos": environment.data.qpos.tolist(),
                "qvel": environment.data.qvel.tolist(),
                "observation": environment.vector(observation).astype(float).tolist(),
                "appliedAction": last_applied.tolist(),
                "stateAgeMs": arguments.state_age_ms,
                "deviceHealth": device_health,
            })
            lease_renewed_ns = state_sent_ns
            lease_deadline_ns = lease_renewed_ns + command_lease_ms * 1_000_000
            last_accepted_step = None
        elif kind in {"action", "shadow-action"}:
            if stop_latched:
                send({"type": "control-rejected", "episode": message.get("episode"), "step": message.get("step"), "reason": "stop-latched"})
                continue
            if environment is None or observation is None or active_episode != message.get("episode"):
                raise RuntimeError("action received outside active episode")
            if int(message["step"]) != environment.step_index:
                raise RuntimeError("action step is out of sequence")
            if message.get("commandLeaseMs") != command_lease_ms:
                raise RuntimeError("control message command lease differs from the frozen Target")
            lease_renewed_ns = time.perf_counter_ns()
            lease_deadline_ns = lease_renewed_ns + command_lease_ms * 1_000_000
            last_accepted_step = int(message["step"])
            maximum_decision_latency_ms = message.get("maximumDecisionLatencyMs")
            if maximum_decision_latency_ms is not None:
                maximum_decision_latency_ms = float(maximum_decision_latency_ms)
                observed_decision_latency_ms = (time.perf_counter_ns() - state_sent_ns) / 1_000_000.0 if state_sent_ns is not None else float("inf")
                if not np.isfinite(maximum_decision_latency_ms) or maximum_decision_latency_ms <= 0:
                    raise RuntimeError("maximumDecisionLatencyMs must be finite and positive")
                if observed_decision_latency_ms > maximum_decision_latency_ms:
                    environment.data.ctrl[:] = np.asarray(target["safety"]["emergencyStopAction"], dtype=np.float64)
                    send({
                        "type": "deadline-rejected",
                        "episode": active_episode,
                        "step": environment.step_index,
                        "actionKind": kind,
                        "observedDecisionLatencyMs": observed_decision_latency_ms,
                        "maximumDecisionLatencyMs": maximum_decision_latency_ms,
                    })
                    continue
            requested = np.asarray(message["action"] if kind == "action" else target["safety"]["emergencyStopAction"], dtype=np.float64)
            result = environment.step(requested)
            observation = result.observation
            last_applied = np.asarray(result.info["appliedAction"], dtype=np.float64)
            state_sent_ns = send({
                "type": "state",
                "episode": active_episode,
                "step": environment.step_index,
                "qpos": environment.data.qpos.tolist(),
                "qvel": environment.data.qvel.tolist(),
                "observation": environment.vector(observation).astype(float).tolist(),
                "appliedAction": last_applied.tolist(),
                "stateAgeMs": arguments.state_age_ms,
                "deviceHealth": device_health,
            })
        elif kind in {"safe-stop", "emergency-stop"}:
            if environment is not None:
                environment.data.ctrl[:] = np.asarray(message["action"], dtype=np.float64)
            send({"type": "stopped", "episode": message.get("episode"), "kind": kind})
            environment = None
            observation = None
            active_episode = None
            stop_latched = kind == "emergency-stop"
            lease_renewed_ns = None
            lease_deadline_ns = None
            last_accepted_step = None
        elif kind == "health-check":
            if not stop_latched:
                raise RuntimeError("health-check requires a latched emergency stop")
            send({
                "type": "health-state",
                "episode": message.get("episode"),
                "sequence": message.get("sequence"),
                "stopLatched": True,
                "deviceHealth": post_stop_device_health,
            })
        elif kind == "close":
            send({"type": "completed"})
            return
        else:
            raise RuntimeError(f"unknown protocol message '{kind}'")

        if state_sent_ns is not None and arguments.receive_delay_ms > 0:
            time.sleep(arguments.receive_delay_ms / 1000.0)


if __name__ == "__main__":
    main()
