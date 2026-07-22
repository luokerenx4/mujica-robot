# Program Controller interface contract

## Decision

Every Program Controller manifest declares an executable `interface`:

- `requiredObservations` is the named subset of the Assembly Observation Contract that the Controller may read. Each requirement fixes the flat channel size.
- `actionChannels` is the complete ordered Action Contract that the Controller produces. Names, sizes, and numeric bounds must match the compiled Assembly exactly.

The interface is authored beside `entry` and `config`, participates in Controller identity, Benchmark locks, experiment identity, and Revision source closure, and is visible through `mujica controller list|inspect`.

## Compatibility

Core checks compatibility before invoking the Python Runtime. A required Observation must exist exactly once with the declared size. Produced Action channels must have the same count, order, names, sizes, and bounds as the Assembly Action Contract. Extra Assembly Observations are allowed because Program Controllers commonly consume only a stable subset.

This is intentionally declarative rather than inferred from Python. Static source analysis cannot reliably see dynamic indexing, helper functions, or policy transforms, while an explicit interface is reviewable and hashable. Runtime access to an undeclared channel remains a Controller defect, but the checked-in controllers have tests tying their declared interface to executable use.

Frozen Policy Controllers continue to use exact Observation and Action contract hashes from the immutable Policy Artifact. Their compatibility boundary is stronger and unchanged.

## Agent and human protocol

`mujica controller list` provides the available Controller kinds and concise interfaces. `mujica controller inspect --controller ID` exposes the complete manifest and identity. Invalid Assembly/Controller combinations fail with a stable message naming the Controller, Assembly, channel, expected shape, and actual or missing value; a Coding Agent should select a compatible Assembly or explicitly develop the missing Component/contract rather than retrying the same Runtime crash.
