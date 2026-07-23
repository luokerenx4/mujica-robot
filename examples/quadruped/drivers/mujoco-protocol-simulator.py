#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np

from mujica_runtime.environment import RobotEnvironment


PROTOCOL = "stdio-jsonl-v1"


def receive() -> dict[str, Any]:
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
    arguments = parser.parse_args()
    if arguments.receive_delay_ms < 0:
        raise RuntimeError("--receive-delay-ms must be nonnegative")
    bundle_root = Path(os.environ["MUJICA_HARDWARE_BUNDLE"])
    bundle = json.loads((bundle_root / "manifest.json").read_text())
    compiled = json.loads((bundle_root / "revision" / "compiled" / "compiled-assembly.json").read_text())
    compiled["actionLow"] = [channel.get("low", -1) for channel in compiled["actionContract"]["channels"] for _ in range(int(channel["size"]))]
    compiled["actionHigh"] = [channel.get("high", 1) for channel in compiled["actionContract"]["channels"] for _ in range(int(channel["size"]))]
    model_path = bundle_root / "revision" / "compiled" / "model.xml"
    scenario = json.loads(Path(arguments.scenario).read_text())
    target = bundle["target"]
    environment: RobotEnvironment | None = None
    observation: dict[str, np.ndarray] | None = None
    active_episode: str | None = None
    state_sent_ns: int | None = None
    last_applied = np.asarray(target["safety"]["emergencyStopAction"], dtype=np.float64)

    hello = receive()
    if hello.get("type") != "hello" or hello.get("protocol") != PROTOCOL:
        raise RuntimeError("invalid host hello")
    send({
        **hello,
        "device": {
            "vendor": target["device"]["vendor"],
            "model": target["device"]["model"],
            "serial": "simulated",
        },
        "capabilities": ["applied-action", "decision-deadline", "shadow-action", "state-age-ms", "stop-ack"],
    })

    while True:
        message = receive()
        kind = message.get("type")
        if kind == "start-episode":
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
            })
        elif kind in {"action", "shadow-action"}:
            if environment is None or observation is None or active_episode != message.get("episode"):
                raise RuntimeError("action received outside active episode")
            if int(message["step"]) != environment.step_index:
                raise RuntimeError("action step is out of sequence")
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
            })
        elif kind in {"safe-stop", "emergency-stop"}:
            if environment is not None:
                environment.data.ctrl[:] = np.asarray(message["action"], dtype=np.float64)
            send({"type": "stopped", "episode": message.get("episode"), "kind": kind})
            environment = None
            observation = None
            active_episode = None
        elif kind == "close":
            send({"type": "completed"})
            return
        else:
            raise RuntimeError(f"unknown protocol message '{kind}'")

        if state_sent_ns is not None and arguments.receive_delay_ms > 0:
            time.sleep(arguments.receive_delay_ms / 1000.0)


if __name__ == "__main__":
    main()
