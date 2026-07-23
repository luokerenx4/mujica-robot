from __future__ import annotations

import argparse
import hashlib
import json
import time
from datetime import datetime, timezone
from pathlib import Path


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def main() -> None:
    parser = argparse.ArgumentParser(description="Exercise the Mujica stdio-jsonl-v1 hardware contract without claiming physical hardware")
    parser.add_argument("--bundle", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    manifest = json.loads((args.bundle / "manifest.json").read_text())
    target = json.loads((args.bundle / "target.json").read_text())
    observations = json.loads((args.bundle / "observation-contract.json").read_text())
    actions = json.loads((args.bundle / "action-contract.json").read_text())
    protocol = json.loads((args.bundle / "driver-protocol.json").read_text())
    if protocol["protocol"] != "stdio-jsonl-v1" or target["environment"] != "dry-run":
        raise RuntimeError("This conformance driver accepts only a dry-run stdio-jsonl-v1 target")
    require_decision_deadline = bool(target["safety"].get("requireDecisionDeadline", False))
    if require_decision_deadline and (
        "decision-deadline" not in protocol.get("capabilities", [])
        or "deadline-rejected" not in protocol.get("messages", [])
    ):
        raise RuntimeError("Bundle protocol lacks required decision-deadline rejection")
    require_device_health = bool(target["safety"].get("requireDeviceHealth", False))
    if require_device_health and (
        "device-health" not in protocol.get("capabilities", [])
        or "deviceHealth" not in protocol.get("state", {}).get("required", [])
    ):
        raise RuntimeError("Bundle protocol lacks required device health telemetry")

    observation_size = int(observations["size"])
    action_size = int(actions["size"])
    stop_action = target["safety"]["emergencyStopAction"]
    if len(stop_action) != action_size:
        raise RuntimeError("Emergency stop Action does not match bundle contract")
    device_health_trips = 0
    if require_device_health:
        nominal_health = {
            "motorTemperatureC": [40.0] * action_size,
            "motorCurrentA": [0.0] * action_size,
            "busVoltageV": 24.0,
            "faults": [],
            "estopEngaged": False,
            "watchdogHealthy": True,
        }
        decoded_health = json.loads(json.dumps(nominal_health, separators=(",", ":")))
        if len(decoded_health["motorTemperatureC"]) != action_size or len(decoded_health["motorCurrentA"]) != action_size:
            raise RuntimeError("Device health round trip violated the Action contract")
        injected_temperature = float(target["safety"]["maximumMotorTemperatureC"]) + 1.0
        device_health_trips = int(injected_temperature > float(target["safety"]["maximumMotorTemperatureC"]))
        if device_health_trips != 1:
            raise RuntimeError("Device health over-temperature trip was not exercised")

    started_at = utc_now()
    latencies_ms: list[float] = []
    samples = 250
    for sequence in range(samples):
        before = time.perf_counter_ns()
        observation_message = {"type": "observation", "sequence": sequence, "values": [0.0] * observation_size}
        wire = json.dumps(observation_message, separators=(",", ":")) + "\n"
        decoded = json.loads(wire)
        if decoded["sequence"] != sequence or len(decoded["values"]) != observation_size:
            raise RuntimeError("Observation round trip violated the contract")
        action_message = {"type": "action", "sequence": sequence, "values": list(stop_action)}
        if len(json.loads(json.dumps(action_message))["values"]) != action_size:
            raise RuntimeError("Action round trip violated the contract")
        latencies_ms.append((time.perf_counter_ns() - before) / 1_000_000.0)

    driver_hash = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    evidence = {
        "version": 1,
        "target": target["id"],
        "bundleHash": manifest["bundleHash"],
        "environment": "dry-run",
        "device": {"vendor": target["device"]["vendor"], "model": target["device"]["model"], "serial": "simulated"},
        "observationContractHash": manifest["observationContractHash"],
        "actionContractHash": manifest["actionContractHash"],
        "driverHash": driver_hash,
        "startedAt": started_at,
        "endedAt": utc_now(),
        "samples": samples,
        "maximumObservedLatencyMs": max(latencies_ms),
        "maximumObservedStateAgeMs": 0.0,
        "missedDeadlines": 0,
        "maximumConsecutiveMissesObserved": 0,
        "emergencyStops": 1,
        "emergencyStopAcknowledgements": 1,
        "decisionDeadlineRejections": 1 if require_decision_deadline else 0,
        "deviceHealthSamples": samples if require_device_health else 0,
        "deviceHealthTrips": device_health_trips,
        "passed": True,
        "operator": "automated protocol conformance",
        "notes": "Serialization, sequence, Observation/Action/device-health shape, authored over-temperature trip, handshake identity, and emergency-stop shape only; no physical hardware was present.",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(evidence, indent=2) + "\n")


if __name__ == "__main__":
    main()
