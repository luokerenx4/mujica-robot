"""Deterministic reference Researcher for the documented motion-quality hypotheses."""

from __future__ import annotations

import json
import sys
from pathlib import Path


request = json.load(sys.stdin)
history = request.get("history", [])
training_path = Path("training/motion-quality-residual-locomotion.training.json")
training = json.loads(training_path.read_text())

if not history:
    training.update({
        "totalSteps": 4096,
        "learningRate": 0.00001,
        "entropyCoefficient": 0.0,
        "residualScale": 0.002,
        "residualPenalty": 50.0,
        "qualityReward": {
            "jointAcceleration": 0.1,
            "bodyAngularAcceleration": 0.2,
            "actionSlew": 0.1,
            "actuatorSaturation": 0.2,
            "footSlip": 0.3,
            "footImpact": 0.2,
        },
    })
    proposal = {
        "strategy": "safety-first-residual-bootstrap",
        "hypothesis": "An ultra-small learned residual with a strong zero-output penalty should inherit the reliable program teacher's feasibility before attempting larger quality corrections.",
        "expectedEffect": "Recover the seven-violation program tier, preserve every passing delayed gate, and establish a promotable ML Policy baseline with live foot-quality evidence.",
    }
else:
    previous_kept = history[-1].get("verdict") == "KEEP"
    training.update({
        "totalSteps": 6144 if previous_kept else 4096,
        "learningRate": 0.00001,
        "entropyCoefficient": 0.0,
        "residualScale": 0.004 if previous_kept else 0.001,
        "residualPenalty": 30.0 if previous_kept else 80.0,
        "qualityReward": {
            "jointAcceleration": 0.15,
            "bodyAngularAcceleration": 0.3,
            "actionSlew": 0.15,
            "actuatorSaturation": 0.25,
            "footSlip": 0.4,
            "footImpact": 0.3,
        },
    })
    proposal = {
        "strategy": "micro-residual-refinement" if previous_kept else "zero-neighborhood-recovery",
        "hypothesis": "The next residual remains inside the frozen program teacher's safe neighborhood, expanding only after a KEEP and shrinking after a rejection.",
        "expectedEffect": "Retain the promoted feasibility tier while testing whether a micro-correction can improve locked motion quality without gate regressions.",
    }

training_path.write_text(json.dumps(training, indent=2) + "\n")
print(json.dumps(proposal))
