# Hardware capture protocol

## Boundary

A Capture Plan binds one exported Hardware Bundle to a finite set of seeded
episodes. The Bundle freezes the Robot Revision, compiled model and contracts,
and Controller source. The Plan may only reduce authority through `shadow` mode,
Action scaling, slew limiting, shorter duration, and tighter state gates.

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
environment, and driver hash. The driver returns its vendor/model/serial identity
and an explicit capability set. Commissioning requires `shadow-action`,
`applied-action`, `state-age-ms`, and `stop-ack`. Every state contains full
`qpos`, `qvel`, the ordered Observation vector, the Action the device actually
applied, and the device-measured state age.

The host executes only the frozen Controller. It scales and slew-limits the
Controller Action, then clips it to the frozen Action Contract. It records the
proposed, commanded, and driver-reported applied Actions separately, so
calibration does not mistake a safety intervention, device clamp, or actuator
lag for Controller intent.

### Shadow commissioning

An `actuate` Plan sends `action`; a `shadow` Plan sends only
`shadow-action { proposedAction }`. The proposal lets a driver or operator
compare Controller intent with live state, but it grants no ordinary actuation
authority. The driver continues its independent safe behavior and reports the
Action it actually applied. Mujica records that value as both commanded and
applied evidence in shadow rows.

Safe-stop and emergency-stop remain available in both modes because a connected
device may already be moving independently. Shadow artifacts always declare
`actuationAuthorized=false` and can never enter Calibration.

## Safety and authority

Before each Action the host checks:

- Controller output shape and finiteness;
- Action Contract bounds and declared Action scale/slew;
- observation/state shape and finiteness;
- contract-sized applied Action telemetry;
- finite, nonnegative device state age below the Hardware Target limit;
- maximum joint speed;
- optional free-base height and yaw-invariant tilt;
- Controller-to-driver dispatch deadline and consecutive misses.

Any violation ends the episode, sends the Bundle's emergency-stop Action, and
publishes an `ABORTED` artifact that is not calibration-eligible. A stop is not
considered executed merely because the host wrote a message: the driver must
return `stopped` with the exact episode and `safe-stop` or `emergency-stop`
kind. A missing or mismatched acknowledgement makes the session `FAILED`.

State age is device-authored evidence about acquisition/estimation freshness.
Host dispatch or round-trip latency cannot substitute for it. The check occurs
before Controller evaluation and Action dispatch, so a stale initial state
cannot produce an ordinary control message.

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
- proposed/commanded/applied Actions, state-age distribution, stop
  acknowledgements, dispatch latency/deadline metrics, and every intervention;
- a report and manifest declaring `COMPLETED`, `ABORTED`, or `FAILED`.

Only an actuation-authorized `COMPLETED` episode may enter a Calibration
definition. Calibration rechecks the Capture manifest, mode, episode hash,
Assembly, environment, provenance, and serialized device identity before
invoking the estimator.
