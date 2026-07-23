"""Frozen architecture declaration for capture-calibrated spatial residual PPO."""

HIDDEN_SIZES = [64, 64]
ACTIVATION = "tanh"
ACTION_TRANSFORM = "spatial-gait-residual"
