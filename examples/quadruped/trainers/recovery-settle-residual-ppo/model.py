"""Small recurrent actor for the observable recovery-settle envelope."""

HIDDEN_SIZES = [64, 64]
ACTIVATION = "tanh"
ACTION_TRANSFORM = "state-gated-program-controller-residual"
