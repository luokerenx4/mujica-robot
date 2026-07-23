# Hardware capture protocol

## Boundary

A Capture Plan binds one exported Hardware Bundle to a finite set of seeded
episodes. The Bundle freezes the Robot Revision, compiled model and contracts,
and Controller source. The Plan may only reduce authority through Action scaling,
slew limiting, shorter duration, and tighter state gates.

The driver is an executable file, not an arbitrary shell command. Mujica hashes
its exact bytes before launch and records every argument separately. JSONL over
stdin/stdout is the first transport because message order, bytes, and failures
can be preserved without adding a network control plane.

## Protocol

The host and driver exchange:

```text
host hello → driver hello
host start-episode → driver state(step=0)
host action(step=n) → driver state(step=n+1)
host safe-stop → driver stopped
...
host close → driver completed
```

The hello message fixes protocol version, Bundle and contract hashes,
environment, and driver hash. The driver returns its vendor/model/serial identity.
Every state contains full `qpos`, `qvel`, and the ordered Observation vector.

The host executes only the frozen Controller. It scales and slew-limits the
Controller Action, then clips it to the frozen Action Contract. It records the
actual command sent, so calibration does not mistake a safety intervention for
actuator weakness.

## Safety and authority

Before each Action the host checks:

- Controller output shape and finiteness;
- Action Contract bounds and declared Action scale/slew;
- observation/state shape and finiteness;
- maximum joint speed;
- optional free-base height and yaw-invariant tilt;
- Controller-to-driver dispatch deadline and consecutive misses.

Any violation ends the episode, sends the Bundle's emergency-stop Action, and
publishes an `ABORTED` artifact that is not calibration-eligible.

Dry-run sessions need no external authority and can only create synthetic
evidence. HIL and real sessions additionally require an external, expiring
authorization that names the exact Plan hash, Bundle hash, device serial,
operator, and maximum episode count. The authorization is copied and hashed into
the session. This host-side gate is not a substitute for physical E-stop,
firmware current/temperature limits, or supervised operating procedures.

## Artifact

Each immutable Hardware Capture contains:

- frozen request, Plan, Bundle identity, executable hash, arguments, and device;
- raw bidirectional protocol transcript and driver stderr;
- one calibration NDJSON file per completed episode;
- dispatch latency/deadline metrics and every safety intervention;
- a report and manifest declaring `COMPLETED`, `ABORTED`, or `FAILED`.

Only a `COMPLETED` episode may enter a Calibration definition. Calibration
rechecks the Capture manifest, episode hash, Assembly, environment, provenance,
and serialized device identity before invoking the estimator.
