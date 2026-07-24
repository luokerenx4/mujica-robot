from mujica_runtime.training import PPOTrainer


def create_trainer():
    return PPOTrainer(
        hidden_sizes=[64, 64],
        initial_log_std=-1.5,
        action_transform={
            "kind": "program-controller-residual",
            "residualScale": 1.0,
            "residualGate": {
                "kind": "prior-telemetry-mode",
                "allowedModes": ["recovery"],
                "requiredTelemetry": {
                    "dynamicRecovery": True,
                },
                "minimumTelemetry": {
                    "recoveryRetryCount": 1,
                    "bodyTiltRad": 2.6,
                },
                "maximumTelemetry": {
                    "recoveryRetryCount": 2,
                    "baseHeightM": 0.16,
                    "supportFeet": 0,
                },
                "rampSeconds": 0,
            },
        },
    )
