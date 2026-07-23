# Hardware capture protocol

## Boundary

A Capture Plan binds one exported Hardware Bundle to a finite set of seeded
episodes. The Bundle freezes either a Robot Revision or Policy Revision, compiled
model and contracts, Controller source, and optional neural Policy. The Plan may
only reduce authority through `shadow` mode, Action scaling, slew limiting,
shorter duration, and tighter state gates.

Robot Revision Bundles may support `actuate`. Policy Revision Bundles are
unconditionally `shadow`-only. This lets a locally improved learned lane collect
HIL evidence without being misrepresented as the promoted robot and without any
source edit granting it ordinary Action authority.

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
host action(step=n) → driver deadline-rejected(step=n)
host safe-stop → driver stopped
...
host close → driver completed
```

The hello message fixes protocol version, Bundle and contract hashes,
environment, and driver hash. The driver returns its vendor/model/serial identity
and an explicit capability set. Commissioning requires `shadow-action`,
`applied-action`, `state-age-ms`, `device-health`, and `stop-ack`. Every state contains full
`qpos`, `qvel`, the ordered Observation vector, the Action the device actually
applied, the device-measured state age, and typed Driver health telemetry.

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

Policy networks are loaded and run through two stateless inference warm-up
passes before the driver process is started. This removes lazy PyTorch kernel
initialization from the first device deadline without mutating model weights,
normalization, recurrent history inputs, or the serialized program prior.
Captures record the warm-up count and `realTimeQualified`; any deadline miss
makes the latter false and prevents calibration eligibility.

### Decision deadline

A Target may require the negotiated `decision-deadline` capability; authoring a
Plan-level deadline also requires that capability. The effective limit is the
Target's `maximumLatencyMs`, optionally tightened by the Plan's
`maximumDecisionLatencyMs`; a Plan may never make it larger.

The deadline is enforced twice, without synchronizing clocks:

1. The host measures from receipt of a state to the instant before dispatch. If
   Controller inference, safety processing, or message preparation is already
   late, it emits no `action` or `shadow-action` and requests an acknowledged
   emergency stop.
2. Every accepted control message carries the effective limit. The driver
   measures locally from sending its state to receiving the control message. If
   transport or scheduling makes it late, the driver applies its local emergency
   action, does not advance the plant or hardware command, and returns
   `deadline-rejected`.

Any rejection aborts the synchronous episode. The host does not use
`maximumConsecutiveMisses` to continue after an expired command because there
is no safe state transition to assume. Captures distinguish host pre-dispatch
misses from driver rejections and preserve both clocks' measurements.

### Device health

A Target with `requireDeviceHealth=true` fixes motor-temperature and absolute
motor-current ceilings plus a valid bus-voltage interval. The negotiated
`device-health` state object contains one temperature and current value per
Action channel, bus voltage, unique machine-safe fault codes, physical E-stop
state, and Driver watchdog health.

The host validates shape, finiteness, fault-code syntax, and boolean status
before Controller evaluation. Over-temperature, over-current, under/over
voltage, any active Driver fault, an engaged physical E-stop, or an unhealthy
watchdog aborts before `action` or `shadow-action` dispatch. The raw health
sample, intervention reason, extrema, and fault/E-stop/watchdog sample counts
enter the immutable Capture.

Health telemetry is a host-visible interlock, not the primary protection.
Firmware must still enforce its own limits and physical E-stop independently if
the host process, transport, or Policy fails.

## Safety and authority

Before each Action the host checks:

- Controller output shape and finiteness;
- Action Contract bounds and declared Action scale/slew;
- observation/state shape and finiteness;
- contract-sized applied Action telemetry;
- finite, nonnegative device state age below the Hardware Target limit;
- contract-sized motor health, bus voltage, Driver faults, E-stop, and watchdog;
- maximum joint speed;
- optional free-base height and yaw-invariant tilt;
- host decision deadline and driver-local receipt deadline;

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
  acknowledgements, Controller warm-up count, real-time qualification,
  host decision/dispatch latency, Driver rejection and health metrics, and every intervention;
- a report and manifest declaring `COMPLETED`, `ABORTED`, or `FAILED`.

Only an actuation-authorized `COMPLETED` episode may enter a Calibration
definition. Calibration rechecks the Capture manifest, mode, episode hash,
Assembly, environment, provenance, and serialized device identity before
invoking the estimator.
