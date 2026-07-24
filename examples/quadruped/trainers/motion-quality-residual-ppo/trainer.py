from mujica_runtime.training import PPOTrainer


def create_trainer():
    return PPOTrainer(
        hidden_sizes=[64, 64],
        initial_log_std=-3.5,
        history_encoder={
            "commandChannel": "command-action-history",
            "appliedChannel": "applied-action-history",
            "steps": 4,
            "actionSize": 12,
            "recurrentSize": 32,
        },
        action_transform={
            "kind": "program-controller-residual",
            "residualScale": 0.15,
            "residualGate": {
                "kind": "prior-telemetry-mode",
                "allowedModes": ["locomotion"],
                "requiredTelemetry": {
                    "recoveryCompleted": False,
                },
                "rampSeconds": 0.5,
            },
        },
    )
