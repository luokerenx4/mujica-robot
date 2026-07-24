from mujica_runtime.training import PPOTrainer


def create_trainer():
    return PPOTrainer(
        hidden_sizes=[64, 64],
        initial_log_std=-3.0,
        action_transform={
            "kind": "program-controller-residual",
            "residualScaleByAction": [
                0.3,
                0.3,
                0.3,
                0.3,
                0.3,
                0.3,
                0.3,
                0.3,
                0.3,
                0.3,
                0.3,
                0.3,
                0.1,
                0.1,
            ],
            "residualGate": {
                "kind": "prior-telemetry-mode",
                "allowedModes": ["locomotion"],
                "minimumTelemetry": {
                    "modeDwellSeconds": 0.2,
                },
                "maximumTelemetry": {
                    "bodyTiltRad": 0.8,
                },
                "rampSeconds": 0.2,
            },
        },
    )
