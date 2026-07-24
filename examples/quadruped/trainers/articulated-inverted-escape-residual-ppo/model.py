"""Small residual actor for the articulated robot's inverted escape window."""

HIDDEN_SIZES = [64, 64]
ACTIVATION = "tanh"
ACTION_TRANSFORM = "state-gated-program-controller-residual"
