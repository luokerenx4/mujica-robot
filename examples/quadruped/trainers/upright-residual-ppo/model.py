"""Small actor-critic residual over a serialized upright program Controller."""

HIDDEN_SIZES = [64, 64]
ACTIVATION = "tanh"
ACTION_TRANSFORM = "program-controller-residual"
