# Structural Mount slots

Status: implemented.

Mount compatibility now has an executable structural boundary. A Robot Base may place `<!-- MUJICA_MOUNT:<mount-id> -->` inside the MuJoCo body that owns a Mount. A Component may declare `mountFragment`; the compiler inserts that fragment at the selected slot after type, dependency, and exclusive-occupancy validation. Top-level `fragment` remains available for MuJoCo sections such as `sensor` and `actuator`, and a Component may use either or both.

Every used structural slot must occur exactly once. Unknown or duplicate markers fail compilation, and every unused known marker is removed. This lets Base packages expose deliberate attachment surfaces without giving an Agent an arbitrary XML insertion primitive. Existing Assemblies retain byte-identical MJCF when a new slot is unused.

The checked-in `torso-payload-module` is a physical vertical slice. Its `mount.xml` adds a named, non-colliding box geom with 0.2 kg mass inside the torso body at the exclusive `torso-payload` slot. `baseline` and `payload-equipped` have identical Observation/Action contracts, while Assembly comparison reports the Component, geometry, mass, and cost addition. Python validation independently shows one additional MuJoCo geom and a model body-mass increase from 5.6 kg to 5.8 kg.

V1 slots bind to authored Base body context; they do not infer transforms from arbitrary sites or provide CAD operations. Nested Component-provided structural slots need a future explicit instance-token design before they are enabled.
