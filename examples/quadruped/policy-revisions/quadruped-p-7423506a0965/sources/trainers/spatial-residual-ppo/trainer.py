import numpy as np

from mujica_runtime.training import PPOTrainer


def create_trainer():
    return PPOTrainer(
        hidden_sizes=[64, 64],
        initial_log_std=-2.0,
        action_transform={
            "kind": "spatial-gait-residual",
            "jointPositionChannel": "joint-position",
            "jointVelocityChannel": "joint-velocity",
            "contactChannel": "foot-contact-force",
            "orientationChannel": "base-orientation",
            "angularVelocityChannel": "imu-angular-velocity",
            "frequencyHz": 1.01295,
            "phaseLeadSeconds": 0.12,
            "statePredictionSeconds": 0.01973,
            "neutralAbduction": 0.19944,
            "neutralHip": 0.3409,
            "neutralKnee": -0.36902,
            "hipAmplitude": 0.16,
            "kneeAmplitude": 0.05614,
            "frontRearPhase": float(np.pi),
            "kpAbduction": 16.82265,
            "kdAbduction": 3.27295,
            "kpSagittal": 30.53877,
            "kdSagittal": 2.16306,
            "contactScale": 20.0,
            "contactGain": 0.02,
            "rollPositionGain": 0.27249,
            "rollRateGain": 0.12693,
            "residualScale": 1.0,
        },
    )
