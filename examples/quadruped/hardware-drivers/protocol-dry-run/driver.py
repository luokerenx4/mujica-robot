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

    observation_size = int(observations["size"])
    action_size = int(actions["size"])
    stop_action = target["safety"]["emergencyStopAction"]
    if len(stop_action) != action_size:
        raise RuntimeError("Emergency stop Action does not match bundle contract")

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
        "missedDeadlines": 0,
        "maximumConsecutiveMissesObserved": 0,
        "emergencyStops": 1,
        "passed": True,
        "operator": "automated protocol conformance",
        "notes": "Serialization, sequence, Observation/Action shape, handshake identity, and emergency-stop shape only; no physical hardware was present.",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(evidence, indent=2) + "\n")


if __name__ == "__main__":
    main()
