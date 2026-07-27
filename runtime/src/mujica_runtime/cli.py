from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .calibration import calibrate
from .design_preview import render_design_preview
from .hardware_capture import capture_hardware
from .replay import render_replay
from .reflex_search import search_reflex
from .simulation import simulate, validate_model
from .state_abi import describe_state
from .training import train
from .twin_audit import audit_twin


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m mujica_runtime.cli")
    parser.add_argument("operation", choices=["validate", "simulate", "evaluate-case", "train", "calibrate", "hardware-capture", "render-replay", "render-design-preview", "audit-twin", "describe-state", "search-reflex"])
    parser.add_argument("--request", required=True)
    args = parser.parse_args()
    request = json.loads(Path(args.request).read_text())
    if args.operation == "validate": result = validate_model(request)
    elif args.operation == "simulate": result = simulate(request, persist=True)
    elif args.operation == "evaluate-case": result = simulate(request, persist=False)
    elif args.operation == "train": result = train(request)
    elif args.operation == "calibrate": result = calibrate(request)
    elif args.operation == "hardware-capture": result = capture_hardware(request)
    elif args.operation == "render-replay": result = render_replay(request)
    elif args.operation == "render-design-preview": result = render_design_preview(request)
    elif args.operation == "audit-twin": result = audit_twin(request)
    elif args.operation == "search-reflex": result = search_reflex(request)
    else: result = describe_state(request)
    sys.stdout.write(json.dumps(result, separators=(",", ":"), ensure_ascii=False))


if __name__ == "__main__":
    main()
