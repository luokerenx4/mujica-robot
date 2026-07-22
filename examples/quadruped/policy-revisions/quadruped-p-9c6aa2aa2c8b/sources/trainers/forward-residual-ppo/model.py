"""Frozen architecture declaration for the periodic forward residual policy."""

HIDDEN_SIZES = [64, 64]
ACTIVATION = "tanh"
ACTION_TRANSFORM = "force-aware-gait-residual"
