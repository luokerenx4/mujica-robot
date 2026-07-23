"""Replayable GRU encoder for capture-calibrated actuator-history residual control."""

HIDDEN_SIZES = [64, 64]
HISTORY_STEPS = 4
HISTORY_RECURRENT_SIZE = 32
ACTIVATION = "tanh"
ACTION_TRANSFORM = "program-controller-residual"
