from mujica_runtime.training import PPOTrainer


def create_trainer():
    return PPOTrainer(
        hidden_sizes=[64, 64],
        initial_log_std=-1.2,
        action_transform={
            "kind": "force-aware-pd-residual",
            "jointPositionChannel": "joint-position",
            "jointVelocityChannel": "joint-velocity",
            "contactChannel": "foot-contact-force",
            "angularVelocityChannel": "imu-angular-velocity",
            "target": [0.29, -0.47, 0.29, -0.47, 0.29, -0.47, 0.29, -0.47],
            "kp": 32.0,
            "kd": 1.4,
            "contactScale": 20.0,
            "contactGain": 0.02,
            "rollGain": 0.02,
            "residualScale": 1.0,
        },
    )
