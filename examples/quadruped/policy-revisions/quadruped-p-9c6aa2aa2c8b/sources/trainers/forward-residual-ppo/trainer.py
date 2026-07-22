import numpy as np

from mujica_runtime.training import PPOTrainer


def create_trainer():
    return PPOTrainer(
        hidden_sizes=[64, 64],
        initial_log_std=-1.5,
        action_transform={
            "kind": "force-aware-gait-residual",
            "jointPositionChannel": "joint-position",
            "jointVelocityChannel": "joint-velocity",
            "contactChannel": "foot-contact-force",
            "angularVelocityChannel": "imu-angular-velocity",
            "frequencyHz": 1.2,
            "neutralHip": 0.29,
            "neutralKnee": -0.47,
            "hipAmplitude": 0.25,
            "kneeAmplitude": 0.04,
            "leftRightPhase": 0.0,
            "frontRearPhase": float(np.pi),
            "kp": 32.0,
            "kd": 2.0,
            "contactScale": 20.0,
            "contactGain": 0.02,
            "rollGain": 0.02,
            "residualScale": 2.0,
        },
    )
