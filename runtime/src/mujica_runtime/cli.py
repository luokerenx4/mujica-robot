from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .calibration import calibrate
from .replay import render_replay
from .simulation import simulate, validate_model
from .training import train


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m mujica_runtime.cli")
    parser.add_argument("operation", choices=["validate", "simulate", "evaluate-case", "train", "calibrate", "render-replay"])
    parser.add_argument("--request", required=True)
    args = parser.parse_args()
    request = json.loads(Path(args.request).read_text())
    if args.operation == "validate": result = validate_model(request)
    elif args.operation == "simulate": result = simulate(request, persist=True)
    elif args.operation == "evaluate-case": result = simulate(request, persist=False)
    elif args.operation == "train": result = train(request)
    elif args.operation == "calibrate": result = calibrate(request)
    else: result = render_replay(request)
    sys.stdout.write(json.dumps(result, separators=(",", ":"), ensure_ascii=False))


if __name__ == "__main__":
    main()
