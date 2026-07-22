"""Frozen architecture declaration for the force-aware residual policy."""

HIDDEN_SIZES = [64, 64]
ACTIVATION = "tanh"
ACTION_TRANSFORM = "force-aware-pd-residual"
