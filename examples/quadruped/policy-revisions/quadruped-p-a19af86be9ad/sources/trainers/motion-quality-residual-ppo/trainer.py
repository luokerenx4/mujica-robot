from mujica_runtime.training import PPOTrainer


def create_trainer():
    return PPOTrainer(
        hidden_sizes=[64, 64],
        initial_log_std=-3.5,
        action_transform={
            "kind": "program-controller-residual",
            "residualScale": 0.15,
        },
    )
