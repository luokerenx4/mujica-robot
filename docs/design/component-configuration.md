# Typed Component configuration

Status: implemented.

Component instance configuration is executable input, not annotation. A Component declares a closed top-level `configSchema`; an Assembly supplies values in its instance `config`; and the Component MJCF fragment binds each resolved property with `{{config.<key>}}`.

V1 deliberately supports only `number`, `integer`, `string`, and `boolean` properties, plus `default`, `minimum`, `maximum`, and `enum`. Values are resolved and validated before template expansion. Strings are XML-escaped, numbers must be finite, unknown keys fail, required values cannot be omitted, and every resolved property must occur in the MJCF fragment. This last rule prevents a plausible-looking hardware parameter from changing only provenance while doing nothing to the executable robot.

For example, `filtered-body-imu` declares a bounded `cutoffHz` parameter and uses it in both MuJoCo sensor definitions. `filtered-imu-default` resolves the default `50`; `filtered-imu-fast` supplies `200`. `mujica assembly compare` reports the same Component instance as modified, the compiled MJCF hashes differ, and MuJoCo validates both models.

The compiled Component records the fully resolved configuration, including defaults. Consequently semantic Assembly diffs and downstream immutable snapshots do not depend on readers reinterpreting a schema later. Runtime-only configuration is intentionally not inferred in V1. Mechanical XML uses the separate, explicit [Structural Mount slot](structural-mount-slots.md) boundary rather than a template convention.
