"""GRU encoder over a replayable four-step actuator-history observation."""

HIDDEN_SIZES = [64, 64]
HISTORY_STEPS = 4
HISTORY_RECURRENT_SIZE = 32
ACTIVATION = "tanh"
ACTION_TRANSFORM = "spatial-gait-residual"
