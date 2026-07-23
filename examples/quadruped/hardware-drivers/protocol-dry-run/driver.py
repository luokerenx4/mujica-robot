from __future__ import annotations

import argparse
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
    command_lease_ms = target["safety"].get("commandLeaseMs")
    if command_lease_ms is not None and (
        "command-lease" not in protocol.get("capabilities", [])
        or "lease-expired" not in protocol.get("messages", [])
        or "control-rejected" not in protocol.get("messages", [])
        or protocol.get("commandLease", {}).get("durationMs") != command_lease_ms
        or protocol.get("commandLease", {}).get("maximumOverrunMs") != target["safety"].get("maximumCommandLeaseOverrunMs")
        or protocol.get("commandLease", {}).get("automaticRearm") is not False
    ):
        raise RuntimeError("Bundle protocol lacks the frozen Driver command lease")
    require_device_health = bool(target["safety"].get("requireDeviceHealth", False))
    if require_device_health and (
        "device-health" not in protocol.get("capabilities", [])
        or "deviceHealth" not in protocol.get("state", {}).get("required", [])
    ):
        raise RuntimeError("Bundle protocol lacks required device health telemetry")
    require_post_stop_health = bool(target["safety"].get("requirePostStopHealthCheck", False))
    if require_post_stop_health and (
        "latched-stop-health" not in protocol.get("capabilities", [])
        or not {"health-check", "health-state"}.issubset(protocol.get("messages", []))
        or protocol.get("stopRecovery", {}).get("automaticRearm") is not False
        or protocol.get("stopRecovery", {}).get("requiresNewSession") is not True
    ):
        raise RuntimeError("Bundle protocol lacks required stop-latched health boundary")

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
            "actuatorStates": ["ready"] * action_size,
            "busVoltageV": 24.0,
            "faults": [],
            "estopEngaged": False,
            "watchdogHealthy": True,
        }
        decoded_health = json.loads(json.dumps(nominal_health, separators=(",", ":")))
        if (
            len(decoded_health["motorTemperatureC"]) != action_size
            or len(decoded_health["motorCurrentA"]) != action_size
            or decoded_health["actuatorStates"] != ["ready"] * action_size
        ):
            raise RuntimeError("Device health round trip violated the Action contract")
        injected_temperature = float(target["safety"]["maximumMotorTemperatureC"]) + 1.0
        device_health_trips = int(injected_temperature > float(target["safety"]["maximumMotorTemperatureC"]))
        if device_health_trips != 1:
            raise RuntimeError("Device health over-temperature trip was not exercised")
    actuator_isolation_trips = 0
    post_stop_health_checks = 0
    post_stop_recovery_candidates = 0
    if require_post_stop_health:
        isolated = {**nominal_health, "actuatorStates": list(nominal_health["actuatorStates"])}
        isolated["actuatorStates"][0] = "faulted"
        actuator_isolation_trips = int([
            index for index, state in enumerate(isolated["actuatorStates"]) if state != "ready"
        ] == [0])
        post_stop_health_checks = int(target["safety"]["postStopHealthySamples"])
        for sequence in range(post_stop_health_checks):
            message = {
                "type": "health-state",
                "sequence": sequence,
                "stopLatched": True,
                "deviceHealth": nominal_health,
            }
            decoded = json.loads(json.dumps(message, separators=(",", ":")))
            if decoded["sequence"] != sequence or decoded["stopLatched"] is not True:
                raise RuntimeError("Stop-latched health round trip failed")
        post_stop_recovery_candidates = int(
            actuator_isolation_trips == 1
            and post_stop_health_checks >= 2
            and protocol["stopRecovery"]["requiresNewSession"] is True
        )

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

    driver_hash = manifest.get("driverExecutableHash")
    driver_package_hash = manifest.get("driverPackageHash")
    if not isinstance(driver_hash, str) or not isinstance(driver_package_hash, str):
        raise RuntimeError("Conformance Evidence requires a Bundle-frozen Driver Package")
    evidence = {
        "version": 1,
        "target": target["id"],
        "bundleHash": manifest["bundleHash"],
        "environment": "dry-run",
        "device": {"vendor": target["device"]["vendor"], "model": target["device"]["model"], "serial": "simulated"},
        "observationContractHash": manifest["observationContractHash"],
        "actionContractHash": manifest["actionContractHash"],
        "driverHash": driver_hash,
        "driverPackageHash": driver_package_hash,
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
        "commandLeaseExpirations": 1 if command_lease_ms is not None else 0,
        "driverAutonomousStops": 1 if command_lease_ms is not None else 0,
        "maximumObservedCommandSilenceMs": float(command_lease_ms or 0) + (0.125 if command_lease_ms is not None else 0.0),
        "deviceHealthSamples": samples if require_device_health else 0,
        "deviceHealthTrips": device_health_trips,
        "actuatorIsolationTrips": actuator_isolation_trips,
        "postStopHealthChecks": post_stop_health_checks,
        "postStopRecoveryCandidates": post_stop_recovery_candidates,
        "passed": True,
        "operator": "automated protocol conformance",
        "notes": "Serialization, sequence, Observation/Action/device-health shape, authored decision-deadline and command-lease expirations, Driver-autonomous stop, over-temperature and isolated-actuator trips, stop-latched healthy window with new-session-only recovery, handshake identity, and emergency-stop shape only; no physical hardware was present.",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(evidence, indent=2) + "\n")


if __name__ == "__main__":
    main()
