"""Small actor for bounded command corrections on the articulated brace plant."""

HIDDEN_SIZES = [64, 64]
ACTIVATION = "tanh"
ACTION_TRANSFORM = "state-gated-program-controller-residual"
