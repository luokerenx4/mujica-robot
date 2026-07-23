"""Deterministic reference Researcher for capture-calibrated robustness."""

from __future__ import annotations

import json
import sys
from pathlib import Path


request = json.load(sys.stdin)
history = request.get("history", [])
training_path = Path("training/capture-calibrated-spatial-residual-locomotion.training.json")
training = json.loads(training_path.read_text())

training["scenarios"] = [
    "nominal",
    "reset-perturbation",
    "low-friction",
    "strong-lateral-push",
]
training["rolloutSteps"] = 512
training["minibatchSize"] = 128
training["epochs"] = 2
training["gamma"] = 0.99
training["gaeLambda"] = 0.95
training["clipRatio"] = 0.15

if not history:
    training.update({
        "totalSteps": 8192,
        "learningRate": 0.00005,
        "entropyCoefficient": 0.0,
        "residualScale": 0.02,
        "residualPenalty": 10.0,
        "qualityReward": {
            "jointAcceleration": 0.0,
            "bodyAngularAcceleration": 0.1,
            "actionSlew": 0.0,
            "actuatorSaturation": 0.4,
            "footSlip": 0.0,
            "footImpact": 0.3,
        },
    })
    proposal = {
        "strategy": "quality-guarded-micro-residual",
        "hypothesis": "The first two hard-case Policies improved score but crossed reset and motion-quality gates; a micro residual with explicit saturation/impact costs should retain the push correction inside the prior's safe neighborhood.",
        "expectedEffect": "Recover strong-push survival without losing reset survival, delayed recovery, saturation, or impact gates.",
    }
else:
    last = history[-1]
    kept = last.get("verdict") == "KEEP"
    remaining = int(last.get("decision", {}).get("candidateViolationCount", 99))
    if kept and remaining > 0:
        training.update({
            "totalSteps": 16384,
            "learningRate": 0.000025,
            "entropyCoefficient": 0.0,
            "residualScale": 0.03,
            "residualPenalty": 8.0,
            "qualityReward": {
                "jointAcceleration": 0.0,
                "bodyAngularAcceleration": 0.1,
                "actionSlew": 0.0,
                "actuatorSaturation": 0.4,
                "footSlip": 0.0,
                "footImpact": 0.3,
            },
        })
        proposal = {
            "strategy": "kept-frontier-expansion",
            "hypothesis": "After a gate-improving micro-residual KEEP, double environment evidence and cautiously expand authority to attack the remaining failure.",
            "expectedEffect": "Improve the remaining low-friction or push gate while retaining the safer feasibility tier and every regression gate.",
        }
    elif len(history) == 1:
        training["scenarios"] = [
            "nominal",
            "reset-perturbation",
            "strong-lateral-push",
            "actuator-delay",
        ]
        training.update({
            "totalSteps": 12288,
            "learningRate": 0.000025,
            "entropyCoefficient": 0.0,
            "residualScale": 0.01,
            "residualPenalty": 20.0,
            "qualityReward": {
                "jointAcceleration": 0.0,
                "bodyAngularAcceleration": 0.15,
                "actionSlew": 0.0,
                "actuatorSaturation": 0.5,
                "footSlip": 0.0,
                "footImpact": 0.4,
            },
        })
        proposal = {
            "strategy": "recovery-case-distillation",
            "hypothesis": "Low-friction exposure produced no progress signal while diluting reset and delay recovery, so concentrate a smaller residual on the three recoverable failure families.",
            "expectedEffect": "Preserve reset and delayed gates while correcting the strong-push failure; leave low friction honestly unsolved.",
        }
    else:
        training.update({
            "totalSteps": 4096,
            "learningRate": 0.00001,
            "entropyCoefficient": 0.0,
            "residualScale": 0.002,
            "residualPenalty": 50.0,
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
            "strategy": "program-prior-recovery",
            "hypothesis": "Two rejected residuals left the safe neighborhood, so test the smallest useful correction with strong regularization toward the frozen program prior.",
            "expectedEffect": "Remove the strong-push regression first while preserving the prior's low-friction failure as an explicit frontier.",
        }

training_path.write_text(json.dumps(training, indent=2) + "\n")
print(json.dumps(proposal))
