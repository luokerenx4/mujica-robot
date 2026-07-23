"""Deterministic reference Researcher for bounded-history residual authority."""

from __future__ import annotations

import json
import sys
from pathlib import Path


request = json.load(sys.stdin)
history = request.get("history", [])
path = Path("training/capture-calibrated-history-residual-locomotion.training.json")
training = json.loads(path.read_text())

training.update({
    "rolloutSteps": 512,
    "epochs": 2,
    "minibatchSize": 128,
    "gamma": 0.99,
    "gaeLambda": 0.95,
    "clipRatio": 0.15,
    "entropyCoefficient": 0.0,
})

if not history:
    training.update({
        "totalSteps": 4096,
        "learningRate": 0.000005,
        "residualScale": 0.0005,
        "residualPenalty": 100.0,
        "qualityReward": {
            "jointAcceleration": 0.0,
            "bodyAngularAcceleration": 0.25,
            "actionSlew": 0.0,
            "actuatorSaturation": 0.7,
            "footSlip": 0.0,
            "footImpact": 0.6,
        },
    })
    proposal = {
        "strategy": "reference-gated-near-prior",
        "hypothesis": "The kept micro residual still regressed against its program reference under delayed held-out cases; reduce authority fourfold and explicitly test the new referenceController gate.",
        "expectedEffect": "Match the frozen program prior's delay and quality gates; otherwise record a deployment REVERT.",
    }
elif history[-1].get("verdict") == "KEEP":
    training.update({
        "totalSteps": 8192,
        "learningRate": 0.00001,
        "residualScale": 0.003,
        "residualPenalty": 40.0,
        "qualityReward": {
            "jointAcceleration": 0.0,
            "bodyAngularAcceleration": 0.2,
            "actionSlew": 0.0,
            "actuatorSaturation": 0.6,
            "footSlip": 0.0,
            "footImpact": 0.5,
        },
    })
    proposal = {
        "strategy": "kept-history-frontier",
        "hypothesis": "A gate-safe micro residual established useful history conditioning; add evidence and cautiously expand authority without leaving that feasible neighborhood.",
        "expectedEffect": "Improve delayed and disturbed score while retaining every primary and regression gate.",
    }
else:
    training.update({
        "totalSteps": 4096,
        "learningRate": 0.000005,
        "residualScale": 0.0005,
        "residualPenalty": 100.0,
        "qualityReward": {
            "jointAcceleration": 0.0,
            "bodyAngularAcceleration": 0.25,
            "actionSlew": 0.0,
            "actuatorSaturation": 0.7,
            "footSlip": 0.0,
            "footImpact": 0.6,
        },
    })
    proposal = {
        "strategy": "near-prior-history-probe",
        "hypothesis": "The previous residual still left the frozen program prior's safe neighborhood, so test near-zero authority as the final falsification probe.",
        "expectedEffect": "Match the program prior gates; any remaining score loss shows the learned residual should be rejected.",
    }

path.write_text(json.dumps(training, indent=2) + "\n")
print(json.dumps(proposal))
