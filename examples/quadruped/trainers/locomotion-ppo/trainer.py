from mujica_runtime.training import PPOTrainer


def create_trainer():
    return PPOTrainer(hidden_sizes=[64, 64])

