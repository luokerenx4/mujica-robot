import { z } from "zod";

export const idSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be a lowercase kebab-case id");
const relativeFileSchema = z.string().min(1).refine((value) => !value.startsWith("/") && !value.split("/").includes(".."), "must be a confined relative path");

const channelSchema = z.object({
  name: idSchema,
  kind: z.enum(["joint-position", "joint-velocity", "body-state", "sensor", "command", "actuator"]),
  size: z.number().int().positive(),
  source: z.string().min(1),
  unit: z.string().min(1),
  low: z.number().finite().optional(),
  high: z.number().finite().optional(),
}).strict().refine((value) => value.low === undefined || value.high === undefined || value.low <= value.high, "low must not exceed high");

const mountSchema = z.object({ id: idSchema, type: idSchema, site: z.string().min(1), exclusive: z.boolean().default(true) }).strict();

export const manifestSchema = z.object({
  version: z.literal(1), id: idSchema, name: z.string().min(1),
  charter: relativeFileSchema,
  morphology: relativeFileSchema,
  defaults: z.object({ assembly: idSchema, controller: idSchema, task: idSchema, scenario: idSchema, objective: idSchema, benchmark: idSchema }).strict(),
}).strict();

export const workspaceSchema = z.object({ version: z.literal(1), name: z.string().min(1), projectsDirectory: relativeFileSchema, defaultProject: idSchema.nullable() }).strict();

export const developmentCharterSchema = z.object({
  version: z.literal(1),
  project: idSchema,
  title: z.string().min(1),
  proposition: z.string().min(1),
  stakeholders: z.array(z.string().min(1)).min(1),
  operationalDesignDomain: z.object({
    environments: z.array(z.string().min(1)).min(1),
    terrain: z.array(z.string().min(1)).min(1),
    conditions: z.array(z.string().min(1)),
    exclusions: z.array(z.string().min(1)),
  }).strict(),
  morphology: z.object({
    class: z.enum(["legged", "manipulator", "wheeled", "aerial", "other"]),
    locomotion: z.enum(["walking", "rolling", "flying", "fixed", "hybrid"]),
    limbCount: z.number().int().nonnegative(),
    notes: z.string(),
  }).strict(),
  northStar: z.object({
    statement: z.string().min(1),
    stage: idSchema,
    benchmark: idSchema,
    requireHumanReview: z.boolean(),
  }).strict(),
  designConstraints: z.object({
    maximumTotalMassKg: z.number().positive(),
    maximumComponentCost: z.number().nonnegative(),
    maximumActionSize: z.number().int().positive(),
    maximumObservationSize: z.number().int().positive(),
    requiredContactPointCount: z.number().int().nonnegative(),
  }).strict(),
  capabilityStages: z.array(z.object({
    id: idSchema,
    name: z.string().min(1),
    question: z.string().min(1),
    status: z.enum(["planned", "active", "accepted"]),
    scenarios: z.array(z.object({
      task: idSchema,
      scenario: idSchema,
      benchmark: idSchema,
      role: z.enum(["development", "regression", "release"]),
    }).strict()).min(1),
    exitCriteria: z.array(z.string().min(1)).min(1),
  }).strict()).min(1).refine((stages) => new Set(stages.map((stage) => stage.id)).size === stages.length, "capability stage ids must be unique"),
  nonGoals: z.array(z.string().min(1)),
}).strict();

export const robotMorphologySchema = z.object({
  version: z.literal(1),
  project: idSchema,
  class: z.enum(["legged", "manipulator", "wheeled", "aerial", "other"]),
  baseBody: z.string().min(1),
  limbCount: z.number().int().nonnegative(),
  contactPoints: z.array(z.object({
    id: idSchema,
    site: z.string().min(1),
    sensor: z.string().min(1).optional(),
  }).strict()).refine((points) => new Set(points.map((point) => point.id)).size === points.length, "contact point ids must be unique"),
}).strict();

export const robotSchema = z.object({
  version: z.literal(1), id: idSchema, name: z.string().min(1), mjcf: relativeFileSchema,
  mounts: z.array(mountSchema), observations: z.array(channelSchema), actions: z.array(channelSchema),
  massKg: z.number().nonnegative(), license: z.string().min(1), attribution: z.string(),
}).strict();

export const componentSchema = z.object({
  version: z.literal(1), id: idSchema, name: z.string().min(1), type: idSchema, fragment: relativeFileSchema.optional(), mountFragment: relativeFileSchema.optional(),
  compatibleMounts: z.array(idSchema).min(1), providesMounts: z.array(mountSchema).default([]),
  observations: z.array(channelSchema).default([]), actions: z.array(channelSchema).default([]), dependencies: z.array(idSchema).default([]),
  configSchema: z.record(z.unknown()),
  physical: z.object({ centerOfMassM: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]), inertiaDiagonalKgM2: z.tuple([z.number().nonnegative(), z.number().nonnegative(), z.number().nonnegative()]) }).strict(),
  geometry: z.array(z.object({ name: idSchema, kind: z.enum(["box", "sphere", "capsule", "mesh"]), collision: z.boolean() }).strict()),
  joints: z.array(z.object({ name: idSchema, kind: z.enum(["hinge", "slide", "ball", "free"]), axis: z.tuple([z.number(), z.number(), z.number()]).optional() }).strict()),
  actuators: z.array(z.object({ name: idSchema, kind: z.enum(["motor", "position", "velocity", "general"]), joint: idSchema, controlRange: z.tuple([z.number().finite(), z.number().finite()]) }).strict()),
  sensors: z.array(z.object({ name: idSchema, kind: idSchema, source: z.enum(["mjcf", "runtime"]) }).strict()),
  massKg: z.number().nonnegative(), cost: z.number().nonnegative(), license: z.string().min(1), attribution: z.string(),
}).strict().refine((value) => value.fragment !== undefined || value.mountFragment !== undefined, "fragment or mountFragment is required");

export const assemblySchema = z.object({
  version: z.literal(1), id: idSchema, name: z.string().min(1), base: idSchema,
  components: z.array(z.object({ id: idSchema, component: idSchema, mount: idSchema, config: z.record(z.unknown()).optional() }).strict()),
}).strict();

export const controllerSchema = z.discriminatedUnion("kind", [
  z.object({
    version: z.literal(1), id: idSchema, name: z.string().min(1), kind: z.literal("program"), entry: relativeFileSchema,
    interface: z.object({
      requiredObservations: z.array(z.object({ name: idSchema, size: z.number().int().positive() }).strict()).min(1).refine((channels) => new Set(channels.map((channel) => channel.name)).size === channels.length, "required Observation names must be unique"),
      actionChannels: z.array(z.object({ name: idSchema, size: z.number().int().positive(), low: z.number().finite(), high: z.number().finite() }).strict().refine((value) => value.low <= value.high, "low must not exceed high")).min(1).refine((channels) => new Set(channels.map((channel) => channel.name)).size === channels.length, "Action channel names must be unique"),
    }).strict(),
    config: z.record(z.unknown()).default({}),
  }).strict(),
  z.object({ version: z.literal(1), id: idSchema, name: z.string().min(1), kind: z.literal("policy"), policy: idSchema, deterministic: z.boolean().default(true) }).strict(),
]);

const motionCommandSchema = z.object({
  frame: z.literal("world"), linearVelocityMps: z.tuple([z.number().finite().min(-1).max(1), z.number().finite().min(-1).max(1)]), yawRateRadPerSec: z.number().finite().min(-2).max(2),
}).strict();

const taskBase = { id: idSchema, name: z.string().min(1), durationSeconds: z.number().finite().positive(), controlHz: z.number().finite().positive(), healthyHeight: z.tuple([z.number(), z.number()]), terminateOnFall: z.boolean() };

const scheduledTaskSchema = z.object({
  version: z.literal(3), ...taskBase,
  motionCommandSchedule: z.array(z.object({ atSeconds: z.number().finite().nonnegative(), command: motionCommandSchema }).strict()).min(1).max(16),
}).strict().superRefine((task, context) => {
  const aligned = (seconds: number) => Math.abs(seconds * task.controlHz - Math.round(seconds * task.controlHz)) <= 1e-9;
  if (!aligned(task.durationSeconds)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["durationSeconds"], message: "must align to an integer control step" });
  task.motionCommandSchedule.forEach((segment, index) => {
    if (index === 0 && segment.atSeconds !== 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ["motionCommandSchedule", index, "atSeconds"], message: "first segment must start at 0 seconds" });
    if (index > 0 && segment.atSeconds <= task.motionCommandSchedule[index - 1]!.atSeconds) context.addIssue({ code: z.ZodIssueCode.custom, path: ["motionCommandSchedule", index, "atSeconds"], message: "segment times must be strictly increasing" });
    if (segment.atSeconds >= task.durationSeconds) context.addIssue({ code: z.ZodIssueCode.custom, path: ["motionCommandSchedule", index, "atSeconds"], message: "segment must start before the episode ends" });
    if (!aligned(segment.atSeconds)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["motionCommandSchedule", index, "atSeconds"], message: "must align to an integer control step" });
  });
});

const recoveryTaskSchema = z.object({
  version: z.literal(4), ...taskBase,
  motionCommand: motionCommandSchema,
  recoveryTarget: z.object({
    minimumBaseHeightM: z.number().finite().positive(),
    maximumBodyTiltRad: z.number().finite().min(0).max(Math.PI),
    maximumLinearSpeedMps: z.number().finite().nonnegative(),
    maximumAngularSpeedRadPerSec: z.number().finite().nonnegative(),
    holdSeconds: z.number().finite().positive(),
  }).strict(),
}).strict().superRefine((task, context) => {
  const aligned = (seconds: number) => Math.abs(seconds * task.controlHz - Math.round(seconds * task.controlHz)) <= 1e-9;
  if (!aligned(task.durationSeconds)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["durationSeconds"], message: "must align to an integer control step" });
  if (!aligned(task.recoveryTarget.holdSeconds)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["recoveryTarget", "holdSeconds"], message: "must align to an integer control step" });
  if (task.recoveryTarget.holdSeconds > task.durationSeconds) context.addIssue({ code: z.ZodIssueCode.custom, path: ["recoveryTarget", "holdSeconds"], message: "must not exceed Task duration" });
  if (task.motionCommand.linearVelocityMps.some((value) => value !== 0) || task.motionCommand.yawRateRadPerSec !== 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["motionCommand"], message: "recovery Tasks require a zero motion command" });
  }
});

const scheduledRecoveryTaskSchema = z.object({
  version: z.literal(5), ...taskBase,
  motionCommandSchedule: z.array(z.object({ atSeconds: z.number().finite().nonnegative(), command: motionCommandSchema }).strict()).min(1).max(16),
  mobilityMeasurementStartSeconds: z.number().finite().nonnegative(),
  recoveryTarget: z.object({
    minimumBaseHeightM: z.number().finite().positive(),
    maximumBodyTiltRad: z.number().finite().min(0).max(Math.PI),
    maximumLinearSpeedMps: z.number().finite().nonnegative(),
    maximumAngularSpeedRadPerSec: z.number().finite().nonnegative(),
    holdSeconds: z.number().finite().positive(),
  }).strict(),
}).strict().superRefine((task, context) => {
  const aligned = (seconds: number) => Math.abs(seconds * task.controlHz - Math.round(seconds * task.controlHz)) <= 1e-9;
  if (!aligned(task.durationSeconds)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["durationSeconds"], message: "must align to an integer control step" });
  if (!aligned(task.mobilityMeasurementStartSeconds)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["mobilityMeasurementStartSeconds"], message: "must align to an integer control step" });
  if (task.mobilityMeasurementStartSeconds >= task.durationSeconds) context.addIssue({ code: z.ZodIssueCode.custom, path: ["mobilityMeasurementStartSeconds"], message: "must start before the episode ends" });
  if (!aligned(task.recoveryTarget.holdSeconds)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["recoveryTarget", "holdSeconds"], message: "must align to an integer control step" });
  if (task.recoveryTarget.holdSeconds > task.durationSeconds) context.addIssue({ code: z.ZodIssueCode.custom, path: ["recoveryTarget", "holdSeconds"], message: "must not exceed Task duration" });
  task.motionCommandSchedule.forEach((segment, index) => {
    if (index === 0 && segment.atSeconds !== 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ["motionCommandSchedule", index, "atSeconds"], message: "first segment must start at 0 seconds" });
    if (index > 0 && segment.atSeconds <= task.motionCommandSchedule[index - 1]!.atSeconds) context.addIssue({ code: z.ZodIssueCode.custom, path: ["motionCommandSchedule", index, "atSeconds"], message: "segment times must be strictly increasing" });
    if (segment.atSeconds >= task.durationSeconds) context.addIssue({ code: z.ZodIssueCode.custom, path: ["motionCommandSchedule", index, "atSeconds"], message: "segment must start before the episode ends" });
    if (!aligned(segment.atSeconds)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["motionCommandSchedule", index, "atSeconds"], message: "must align to an integer control step" });
  });
});

const continuousRecoveryTaskSchema = z.object({
  version: z.literal(6), ...taskBase,
  motionCommandSchedule: z.array(z.object({ atSeconds: z.number().finite().nonnegative(), command: motionCommandSchema }).strict()).min(1).max(16),
  recoveryEvaluationStartSeconds: z.number().finite().nonnegative(),
  mobilityMeasurementStartSeconds: z.number().finite().nonnegative(),
  recoveryTarget: z.object({
    minimumBaseHeightM: z.number().finite().positive(),
    maximumBodyTiltRad: z.number().finite().min(0).max(Math.PI),
    maximumLinearSpeedMps: z.number().finite().nonnegative(),
    maximumAngularSpeedRadPerSec: z.number().finite().nonnegative(),
    holdSeconds: z.number().finite().positive(),
  }).strict(),
}).strict().superRefine((task, context) => {
  const aligned = (seconds: number) => Math.abs(seconds * task.controlHz - Math.round(seconds * task.controlHz)) <= 1e-9;
  if (!aligned(task.durationSeconds)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["durationSeconds"], message: "must align to an integer control step" });
  if (!aligned(task.recoveryEvaluationStartSeconds)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["recoveryEvaluationStartSeconds"], message: "must align to an integer control step" });
  if (!aligned(task.mobilityMeasurementStartSeconds)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["mobilityMeasurementStartSeconds"], message: "must align to an integer control step" });
  if (task.recoveryEvaluationStartSeconds >= task.durationSeconds) context.addIssue({ code: z.ZodIssueCode.custom, path: ["recoveryEvaluationStartSeconds"], message: "must start before the episode ends" });
  if (task.mobilityMeasurementStartSeconds <= task.recoveryEvaluationStartSeconds || task.mobilityMeasurementStartSeconds >= task.durationSeconds) context.addIssue({ code: z.ZodIssueCode.custom, path: ["mobilityMeasurementStartSeconds"], message: "must start after recovery evaluation and before episode end" });
  if (!aligned(task.recoveryTarget.holdSeconds)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["recoveryTarget", "holdSeconds"], message: "must align to an integer control step" });
  if (task.recoveryTarget.holdSeconds > task.durationSeconds - task.recoveryEvaluationStartSeconds) context.addIssue({ code: z.ZodIssueCode.custom, path: ["recoveryTarget", "holdSeconds"], message: "must fit after recovery evaluation starts" });
  task.motionCommandSchedule.forEach((segment, index) => {
    if (index === 0 && segment.atSeconds !== 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ["motionCommandSchedule", index, "atSeconds"], message: "first segment must start at 0 seconds" });
    if (index > 0 && segment.atSeconds <= task.motionCommandSchedule[index - 1]!.atSeconds) context.addIssue({ code: z.ZodIssueCode.custom, path: ["motionCommandSchedule", index, "atSeconds"], message: "segment times must be strictly increasing" });
    if (segment.atSeconds >= task.durationSeconds) context.addIssue({ code: z.ZodIssueCode.custom, path: ["motionCommandSchedule", index, "atSeconds"], message: "segment must start before the episode ends" });
    if (!aligned(segment.atSeconds)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["motionCommandSchedule", index, "atSeconds"], message: "must align to an integer control step" });
  });
});

const missionPhaseSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  atSeconds: z.number().finite().nonnegative(),
  intent: z.enum(["operate", "disturbance", "recover", "resume", "stop"]),
  requiredCapabilities: z.array(idSchema).min(1).refine(
    (capabilities) => new Set(capabilities).size === capabilities.length,
    "required capabilities must be unique",
  ),
}).strict();

const integratedMissionTaskSchema = z.object({
  version: z.literal(7), ...taskBase,
  motionCommandSchedule: z.array(z.object({ atSeconds: z.number().finite().nonnegative(), command: motionCommandSchema }).strict()).min(1).max(16),
  missionPhases: z.array(missionPhaseSchema).min(3).max(32),
  recoveryEvaluationStartSeconds: z.number().finite().nonnegative(),
  mobilityMeasurementStartSeconds: z.number().finite().nonnegative(),
  recoveryTarget: z.object({
    minimumBaseHeightM: z.number().finite().positive(),
    maximumBodyTiltRad: z.number().finite().min(0).max(Math.PI),
    maximumLinearSpeedMps: z.number().finite().nonnegative(),
    maximumAngularSpeedRadPerSec: z.number().finite().nonnegative(),
    holdSeconds: z.number().finite().positive(),
  }).strict(),
}).strict().superRefine((task, context) => {
  const aligned = (seconds: number) => Math.abs(seconds * task.controlHz - Math.round(seconds * task.controlHz)) <= 1e-9;
  if (!aligned(task.durationSeconds)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["durationSeconds"], message: "must align to an integer control step" });
  if (!aligned(task.recoveryEvaluationStartSeconds)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["recoveryEvaluationStartSeconds"], message: "must align to an integer control step" });
  if (!aligned(task.mobilityMeasurementStartSeconds)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["mobilityMeasurementStartSeconds"], message: "must align to an integer control step" });
  if (task.recoveryEvaluationStartSeconds >= task.durationSeconds) context.addIssue({ code: z.ZodIssueCode.custom, path: ["recoveryEvaluationStartSeconds"], message: "must start before the episode ends" });
  if (task.mobilityMeasurementStartSeconds <= task.recoveryEvaluationStartSeconds || task.mobilityMeasurementStartSeconds >= task.durationSeconds) context.addIssue({ code: z.ZodIssueCode.custom, path: ["mobilityMeasurementStartSeconds"], message: "must start after recovery evaluation and before episode end" });
  if (!aligned(task.recoveryTarget.holdSeconds)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["recoveryTarget", "holdSeconds"], message: "must align to an integer control step" });
  if (task.recoveryTarget.holdSeconds > task.durationSeconds - task.recoveryEvaluationStartSeconds) context.addIssue({ code: z.ZodIssueCode.custom, path: ["recoveryTarget", "holdSeconds"], message: "must fit after recovery evaluation starts" });
  task.motionCommandSchedule.forEach((segment, index) => {
    if (index === 0 && segment.atSeconds !== 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ["motionCommandSchedule", index, "atSeconds"], message: "first segment must start at 0 seconds" });
    if (index > 0 && segment.atSeconds <= task.motionCommandSchedule[index - 1]!.atSeconds) context.addIssue({ code: z.ZodIssueCode.custom, path: ["motionCommandSchedule", index, "atSeconds"], message: "segment times must be strictly increasing" });
    if (segment.atSeconds >= task.durationSeconds) context.addIssue({ code: z.ZodIssueCode.custom, path: ["motionCommandSchedule", index, "atSeconds"], message: "segment must start before the episode ends" });
    if (!aligned(segment.atSeconds)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["motionCommandSchedule", index, "atSeconds"], message: "must align to an integer control step" });
  });
  const phaseIds = new Set<string>();
  const phaseTimes = new Set<number>();
  task.missionPhases.forEach((phase, index) => {
    if (phaseIds.has(phase.id)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["missionPhases", index, "id"], message: "mission phase ids must be unique" });
    phaseIds.add(phase.id);
    if (index === 0 && phase.atSeconds !== 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ["missionPhases", index, "atSeconds"], message: "first mission phase must start at 0 seconds" });
    if (index > 0 && phase.atSeconds <= task.missionPhases[index - 1]!.atSeconds) context.addIssue({ code: z.ZodIssueCode.custom, path: ["missionPhases", index, "atSeconds"], message: "mission phase times must be strictly increasing" });
    if (phase.atSeconds >= task.durationSeconds) context.addIssue({ code: z.ZodIssueCode.custom, path: ["missionPhases", index, "atSeconds"], message: "mission phase must start before the episode ends" });
    if (!aligned(phase.atSeconds)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["missionPhases", index, "atSeconds"], message: "must align to an integer control step" });
    phaseTimes.add(phase.atSeconds);
  });
  task.motionCommandSchedule.forEach((segment, index) => {
    if (!phaseTimes.has(segment.atSeconds)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["motionCommandSchedule", index, "atSeconds"], message: "every command boundary must coincide with a named mission phase" });
  });
  if (!task.missionPhases.some((phase) => phase.intent === "disturbance")) context.addIssue({ code: z.ZodIssueCode.custom, path: ["missionPhases"], message: "integrated mission requires a disturbance phase" });
  if (!task.missionPhases.some((phase) => phase.intent === "recover")) context.addIssue({ code: z.ZodIssueCode.custom, path: ["missionPhases"], message: "integrated mission requires a recovery phase" });
  if (!task.missionPhases.some((phase) => phase.intent === "resume")) context.addIssue({ code: z.ZodIssueCode.custom, path: ["missionPhases"], message: "integrated mission requires a resume phase" });
});

export const taskSchema = z.union([
  z.object({ version: z.literal(2), ...taskBase, motionCommand: motionCommandSchema }).strict(),
  scheduledTaskSchema,
  recoveryTaskSchema,
  scheduledRecoveryTaskSchema,
  continuousRecoveryTaskSchema,
  integratedMissionTaskSchema,
]);

const initialBasePoseSchema = z.object({
  positionM: z.tuple([z.number().finite(), z.number().finite(), z.number().finite().positive()]),
  orientationWxyz: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]),
}).strict().superRefine((pose, context) => {
  const norm = Math.hypot(...pose.orientationWxyz);
  if (Math.abs(norm - 1) > 1e-9) context.addIssue({ code: z.ZodIssueCode.custom, path: ["orientationWxyz"], message: "must be a normalized quaternion" });
});

const scenarioBase = {
  id: idSchema, name: z.string().min(1), friction: z.number().positive(), payloadKg: z.number().nonnegative(),
  observationNoiseStd: z.number().nonnegative(), actuatorDelaySteps: z.number().int().nonnegative(),
  initialJointPositionNoiseStd: z.number().nonnegative().default(0), initialJointVelocityNoiseStd: z.number().nonnegative().default(0),
  initialBasePose: initialBasePoseSchema.optional(),
  bodyMassScale: z.number().positive().optional(), jointDampingScale: z.number().nonnegative().optional(), actuatorStrengthScale: z.number().positive().optional(),
};

const planarDirectionSchema = z.tuple([z.number().finite(), z.number().finite()]).superRefine((direction, context) => {
  if (Math.hypot(...direction) <= 1e-9) context.addIssue({ code: z.ZodIssueCode.custom, message: "external push direction must be nonzero" });
});

export const scenarioSchema = z.union([
  z.object({
  version: z.literal(1), ...scenarioBase,
  lateralPush: z.object({ timeSeconds: z.number().nonnegative(), durationSeconds: z.number().positive(), forceNewton: z.number() }).strict().nullable(),
  }).strict(),
  z.object({
    version: z.literal(2), ...scenarioBase,
    externalPush: z.object({
      timeSeconds: z.number().nonnegative(),
      durationSeconds: z.number().positive(),
      forceNewton: z.number().positive(),
      directionXY: planarDirectionSchema,
    }).strict().nullable(),
  }).strict(),
]);

const positiveDomainRangeSchema = z.object({ minimum: z.number().positive(), maximum: z.number().positive() }).strict()
  .refine((value) => value.minimum <= value.maximum, "minimum must not exceed maximum");
const nonnegativeDomainRangeSchema = z.object({ minimum: z.number().nonnegative(), maximum: z.number().nonnegative() }).strict()
  .refine((value) => value.minimum <= value.maximum, "minimum must not exceed maximum");
const integerDomainRangeSchema = z.object({ minimum: z.number().int(), maximum: z.number().int() }).strict()
  .refine((value) => value.minimum <= value.maximum, "minimum must not exceed maximum");
const finiteDomainRangeSchema = z.object({ minimum: z.number().finite(), maximum: z.number().finite() }).strict()
  .refine((value) => value.minimum <= value.maximum, "minimum must not exceed maximum");

export const domainProfileSchema = z.object({
  version: z.literal(1), id: idSchema, name: z.string().min(1),
  plantHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  provenance: z.object({
    kind: z.enum(["synthetic", "hil", "real"]), evidence: relativeFileSchema.nullable(), notes: z.string(),
  }).strict(),
  parameters: z.object({
    bodyMassScale: positiveDomainRangeSchema.optional(),
    jointDampingScale: nonnegativeDomainRangeSchema.optional(),
    actuatorStrengthScale: positiveDomainRangeSchema.optional(),
    frictionScale: positiveDomainRangeSchema.optional(),
    observationNoiseStd: nonnegativeDomainRangeSchema.optional(),
    actuatorDelayJitterSteps: integerDomainRangeSchema.optional(),
    pushTimeOffsetSeconds: finiteDomainRangeSchema.optional(),
    pushForceScale: positiveDomainRangeSchema.optional(),
    pushDirectionJitterRad: finiteDomainRangeSchema.optional(),
  }).strict(),
}).strict().superRefine((profile, context) => {
  if (profile.provenance.kind !== "synthetic" && profile.provenance.evidence === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["provenance", "evidence"], message: "HIL and real Domain Profiles require an evidence path" });
  }
  if (Object.keys(profile.parameters).length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["parameters"], message: "Domain Profile must bound at least one parameter" });
  }
});

export const objectiveSchema = z.object({
  version: z.literal(1), id: idSchema, name: z.string().min(1),
  weights: z.object({
    survival: z.number(), velocityTracking: z.number(), forwardProgress: z.number().default(0), upright: z.number(), lateralDrift: z.number().default(0),
    transitionTracking: z.number().default(0), energy: z.number(), smoothness: z.number(), componentMass: z.number(), sensorChannels: z.number(), trainingSteps: z.number(),
    jointJerk: z.number().default(0), bodyAngularJerk: z.number().default(0), actionSlew: z.number().default(0),
    actuatorSaturation: z.number().default(0), footSlip: z.number().default(0), footImpact: z.number().default(0),
    selfRighting: z.number().default(0), recoveryTime: z.number().default(0), jointLimitMargin: z.number().default(0),
  }).strict(),
  transientMeasurement: z.object({
    planarToleranceMps: z.number().finite().nonnegative(), yawRateToleranceRadPerSec: z.number().finite().nonnegative(), holdSeconds: z.number().finite().positive(),
  }).strict().default({ planarToleranceMps: 0.12, yawRateToleranceRadPerSec: 0.25, holdSeconds: 0.2 }),
  gates: z.object({
    minimumSurvivalRate: z.number().min(0).max(1), minimumForwardProgress: z.number().min(0).max(1).default(0),
    minimumSignedForwardProgress: z.number().finite().default(-1_000_000), maximumBackwardDisplacement: z.number().nonnegative().default(1_000_000),
    maximumBackwardPitchRad: z.number().nonnegative().default(1_000_000), maximumAbsolutePitchRad: z.number().nonnegative().default(1_000_000), maximumAbsolutePitchRateRadPerSec: z.number().nonnegative().default(1_000_000), maximumBodyTiltRad: z.number().nonnegative().default(1_000_000),
    maximumLateralDrift: z.number().nonnegative().default(1_000_000), maximumPlanarVelocityTrackingError: z.number().nonnegative().default(1_000_000),
    maximumYawRateTrackingError: z.number().nonnegative().default(1_000_000),
    maximumTransitionTerminalPlanarTrackingError: z.number().nonnegative().default(1_000_000), maximumTransitionTerminalYawRateTrackingError: z.number().nonnegative().default(1_000_000),
    maximumPlanarSettlingTimeSeconds: z.number().nonnegative().default(1_000_000), maximumPlanarBrakingSettlingTimeSeconds: z.number().nonnegative().default(1_000_000),
    maximumYawRateSettlingTimeSeconds: z.number().nonnegative().default(1_000_000),
    maximumPlanarOvershootMps: z.number().nonnegative().default(1_000_000), maximumYawRateOvershootRadPerSec: z.number().nonnegative().default(1_000_000),
    maximumUnsettledPlanarTransitions: z.number().int().nonnegative().default(1_000_000), maximumUnsettledYawRateTransitions: z.number().int().nonnegative().default(1_000_000),
    maximumMeanJointJerkRadPerSec3: z.number().nonnegative().default(1_000_000), maximumMeanBodyAngularJerkRadPerSec3: z.number().nonnegative().default(1_000_000),
    maximumMeanActionSlewRatePerSec: z.number().nonnegative().default(1_000_000), maximumActuatorSaturationRate: z.number().min(0).max(1).default(1),
    maximumMeanFootSlipSpeedMps: z.number().nonnegative().default(1_000_000), maximumPeakFootContactImpactNPerSec: z.number().nonnegative().default(1_000_000),
    minimumSelfRightingSuccess: z.number().min(0).max(1).default(0),
    maximumTimeToStableStandSeconds: z.number().nonnegative().default(1_000_000),
    minimumStableStandingDwellSeconds: z.number().nonnegative().default(0),
    maximumFinalBodyTiltRad: z.number().nonnegative().default(Math.PI),
    minimumFinalBaseHeightM: z.number().nonnegative().default(0),
    minimumJointLimitMarginRad: z.number().finite().default(-1_000_000),
    maximumPeakActuator: z.number().nonnegative().default(1_000_000),
    maximumDisallowedCollisionSteps: z.number().int().nonnegative().default(1_000_000),
    maximumRegression: z.number().nonnegative(),
  }).strict(),
}).strict();

const benchmarkCaseSchema = z.object({ id: idSchema, task: idSchema, scenario: idSchema, seed: z.number().int(), weight: z.number().positive(), gating: z.boolean().default(true) }).strict();
const benchmarkBase = {
  id: idSchema, name: z.string().min(1), objective: idSchema,
  baseline: z.object({ assembly: idSchema, controller: idSchema }).strict(),
  cases: z.array(benchmarkCaseSchema).min(1),
};

export const benchmarkSchema = z.union([z.object({
  version: z.literal(1), id: idSchema, name: z.string().min(1), objective: idSchema,
  baseline: z.object({ assembly: idSchema, controller: idSchema }).strict(),
  cases: z.array(benchmarkCaseSchema).min(1),
}).strict(), z.object({
  version: z.literal(2), ...benchmarkBase,
  kind: z.literal("mission-suite"),
  resetPolicy: z.literal("between-cases"),
  requiredCapabilities: z.array(idSchema).min(2).refine(
    (capabilities) => new Set(capabilities).size === capabilities.length,
    "required capabilities must be unique",
  ),
}).strict()]);

export const trainerSchema = z.object({ version: z.literal(1), id: idSchema, name: z.string().min(1), kind: z.literal("ppo"), entry: relativeFileSchema, model: relativeFileSchema }).strict();

const trainingOptimizationFields = {
  id: idSchema, name: z.string().min(1), assembly: idSchema, trainer: idSchema,
  priorController: idSchema.optional(),
  domainProfile: idSchema.optional(),
  totalSteps: z.number().int().positive(), rolloutSteps: z.number().int().positive(), epochs: z.number().int().positive(), minibatchSize: z.number().int().positive(),
  learningRate: z.number().positive(), gamma: z.number().min(0).max(1), gaeLambda: z.number().min(0).max(1), clipRatio: z.number().positive(), entropyCoefficient: z.number().nonnegative(),
  residualScale: z.number().min(0).max(1).optional(),
  residualPenalty: z.number().nonnegative().optional(),
  qualityReward: z.object({
    jointAcceleration: z.number().nonnegative(), bodyAngularAcceleration: z.number().nonnegative(), actionSlew: z.number().nonnegative(),
    actuatorSaturation: z.number().nonnegative(), footSlip: z.number().nonnegative(), footImpact: z.number().nonnegative(),
  }).strict().optional(),
  missionReward: z.object({
    commandProgress: z.number().finite().min(0).max(20),
    velocityTracking: z.number().finite().min(0).max(20),
    stopStability: z.number().finite().min(0).max(20),
  }).strict().optional(),
};

export const trainingSchema = z.union([
  z.object({
    version: z.literal(1), ...trainingOptimizationFields,
    task: idSchema,
    scenarios: z.array(idSchema).min(1),
  }).strict(),
  z.object({
    version: z.literal(2), ...trainingOptimizationFields,
    curriculumSampling: z.enum(["episode-probability", "step-share"]).optional(),
    curriculum: z.array(z.object({
      id: idSchema,
      role: z.enum(["skill", "mission"]),
      task: idSchema,
      scenarios: z.array(idSchema).min(1),
      weight: z.number().positive(),
    }).strict()).min(2).max(16),
    promotionBenchmark: idSchema,
  }).strict().superRefine((training, context) => {
    if (new Set(training.curriculum.map((item) => item.id)).size !== training.curriculum.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["curriculum"], message: "curriculum ids must be unique" });
    }
    if (!training.curriculum.some((item) => item.role === "skill")) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["curriculum"], message: "curriculum requires at least one Skill entry" });
    }
    if (!training.curriculum.some((item) => item.role === "mission")) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["curriculum"], message: "curriculum requires at least one Mission entry" });
    }
  }),
  z.object({
    version: z.literal(3), ...trainingOptimizationFields,
    mission: z.object({
      task: idSchema,
      scenarios: z.array(idSchema).min(1),
    }).strict(),
    progression: z.array(z.object({
      id: idSchema,
      throughPhase: idSchema,
      untilStep: z.number().int().positive(),
      domainProfile: idSchema.optional(),
    }).strict()).min(2).max(8),
    promotionBenchmark: idSchema,
  }).strict().superRefine((training, context) => {
    if (new Set(training.progression.map((item) => item.id)).size !== training.progression.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["progression"], message: "progression ids must be unique" });
    }
    training.progression.forEach((stage, index) => {
      if (index > 0 && stage.untilStep <= training.progression[index - 1]!.untilStep) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["progression", index, "untilStep"], message: "progression step boundaries must be strictly increasing" });
      }
    });
    if (training.progression.at(-1)?.untilStep !== training.totalSteps) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["progression"], message: "final progression boundary must equal totalSteps" });
    }
  }),
]);

export const calibrationSchema = z.object({
  version: z.literal(1),
  id: idSchema,
  name: z.string().min(1),
  assembly: idSchema,
  scenario: idSchema,
  controlHz: z.number().positive(),
  provenance: z.object({
    kind: z.enum(["synthetic", "hil", "real"]),
    device: z.object({
      vendor: z.string().min(1),
      model: z.string().min(1),
      serial: z.string().min(1),
    }).strict().nullable(),
    capturedAt: z.string().datetime(),
    operator: z.string().min(1),
    notes: z.string(),
  }).strict(),
  sources: z.array(z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("simulation-run"), run: idSchema }).strict(),
    z.object({ kind: z.literal("capture"), path: relativeFileSchema }).strict(),
    z.object({ kind: z.literal("hardware-capture"), capture: idSchema, episode: idSchema }).strict(),
  ])).min(2),
  parameters: z.object({
    bodyMassScale: positiveDomainRangeSchema.optional(),
    jointDampingScale: nonnegativeDomainRangeSchema.optional(),
    actuatorStrengthScale: positiveDomainRangeSchema.optional(),
    frictionScale: positiveDomainRangeSchema.optional(),
    actuatorDelaySteps: z.object({ minimum: z.number().int().nonnegative(), maximum: z.number().int().nonnegative() }).strict()
      .refine((value) => value.minimum <= value.maximum, "minimum must not exceed maximum").optional(),
  }).strict(),
  optimizer: z.object({
    rounds: z.number().int().min(1).max(6),
    samplesPerAxis: z.number().int().min(3).max(11).refine((value) => value % 2 === 1, "samplesPerAxis must be odd"),
    validationSources: z.number().int().positive(),
    maximumValidationLoss: z.number().nonnegative(),
  }).strict(),
  profile: z.object({
    id: idSchema,
    name: z.string().min(1),
    uncertaintyFraction: z.number().min(0).max(1),
    delayMarginSteps: z.number().int().nonnegative(),
  }).strict(),
}).strict().superRefine((calibration, context) => {
  if (Object.keys(calibration.parameters).length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["parameters"], message: "Calibration must fit at least one parameter" });
  }
  if (calibration.optimizer.validationSources >= calibration.sources.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["optimizer", "validationSources"], message: "Calibration must retain at least one fitting source" });
  }
  if (calibration.provenance.kind !== "synthetic" && calibration.provenance.device === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["provenance", "device"], message: "HIL and real Calibration require serialized device identity" });
  }
  if (calibration.provenance.kind !== "synthetic" && calibration.sources.some((source) => source.kind !== "hardware-capture")) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["sources"], message: "HIL and real Calibration require immutable Hardware Capture sources" });
  }
});

export const driverPackageSchema = z.object({
  version: z.literal(1),
  id: idSchema,
  name: z.string().min(1),
  protocol: z.literal("stdio-jsonl-v1"),
  executable: relativeFileSchema,
  environments: z.array(z.enum(["dry-run", "hil", "real"])).min(1).refine((items) => new Set(items).size === items.length, "Driver environments must be unique"),
  device: z.object({ vendor: z.string().min(1), model: z.string().min(1) }).strict(),
  capabilities: z.array(idSchema).min(1).refine((items) => new Set(items).size === items.length, "Driver capabilities must be unique"),
}).strict();

export const hardwareTargetSchema = z.object({
  version: z.literal(1), id: idSchema, name: z.string().min(1), revision: idSchema,
  revisionKind: z.enum(["robot", "policy"]).optional(),
  assembly: idSchema, controller: idSchema, driver: idSchema.optional(),
  environment: z.enum(["dry-run", "hil", "real"]), protocol: z.literal("stdio-jsonl-v1"), controlHz: z.number().positive(),
  safety: z.object({
    maximumLatencyMs: z.number().positive(),
    commandLeaseMs: z.number().int().min(10).max(60_000).optional(),
    maximumCommandLeaseOverrunMs: z.number().positive().max(1_000).optional(),
    maximumStateAgeMs: z.number().positive().optional(),
    requireDecisionDeadline: z.boolean().optional(),
    requireDeviceHealth: z.boolean().optional(),
    maximumMotorTemperatureC: z.number().positive().optional(),
    maximumMotorCurrentA: z.number().positive().optional(),
    minimumBusVoltageV: z.number().positive().optional(),
    maximumBusVoltageV: z.number().positive().optional(),
    requirePostStopHealthCheck: z.boolean().optional(),
    postStopHealthySamples: z.number().int().min(2).max(100).optional(),
    postStopMinimumHealthyDurationMs: z.number().positive().max(60_000).optional(),
    maximumConsecutiveMisses: z.number().int().nonnegative(),
    emergencyStopAction: z.array(z.number().finite()).min(1),
  }).strict().superRefine((safety, context) => {
    const healthFields = ["maximumMotorTemperatureC", "maximumMotorCurrentA", "minimumBusVoltageV", "maximumBusVoltageV"] as const;
    const recoveryFields = ["postStopHealthySamples", "postStopMinimumHealthyDurationMs"] as const;
    if (safety.commandLeaseMs === undefined && safety.maximumCommandLeaseOverrunMs !== undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["commandLeaseMs"], message: "commandLeaseMs is required when maximumCommandLeaseOverrunMs is declared" });
    }
    if (safety.commandLeaseMs !== undefined && safety.maximumCommandLeaseOverrunMs === undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["maximumCommandLeaseOverrunMs"], message: "maximumCommandLeaseOverrunMs is required when commandLeaseMs is declared" });
    }
    if (safety.minimumBusVoltageV !== undefined && safety.maximumBusVoltageV !== undefined && safety.minimumBusVoltageV >= safety.maximumBusVoltageV) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["minimumBusVoltageV"], message: "minimumBusVoltageV must be below maximumBusVoltageV" });
    }
    if (!safety.requireDeviceHealth && healthFields.some((field) => safety[field] !== undefined)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["requireDeviceHealth"], message: "requireDeviceHealth must be true when device health limits are declared" });
    }
    if (safety.requireDeviceHealth) {
      for (const field of healthFields) {
        if (safety[field] === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${field} is required when requireDeviceHealth is true` });
      }
    }
    if (!safety.requirePostStopHealthCheck && recoveryFields.some((field) => safety[field] !== undefined)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["requirePostStopHealthCheck"], message: "requirePostStopHealthCheck must be true when post-stop health limits are declared" });
    }
    if (safety.requirePostStopHealthCheck) {
      if (!safety.requireDeviceHealth) context.addIssue({ code: z.ZodIssueCode.custom, path: ["requireDeviceHealth"], message: "requireDeviceHealth must be true when requirePostStopHealthCheck is true" });
      for (const field of recoveryFields) {
        if (safety[field] === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${field} is required when requirePostStopHealthCheck is true` });
      }
    }
  }),
  device: z.object({ vendor: z.string().min(1), model: z.string().min(1), serialRequired: z.boolean() }).strict(),
}).strict();

export const hardwareCapturePlanSchema = z.object({
  version: z.literal(1),
  id: idSchema,
  name: z.string().min(1),
  target: idSchema,
  bundle: idSchema,
  mode: z.enum(["shadow", "actuate"]).default("actuate"),
  episodes: z.array(z.object({
    id: idSchema,
    seed: z.number().int(),
    steps: z.number().int().min(2).max(50_000),
  }).strict()).min(1).max(32).refine((episodes) => new Set(episodes.map((episode) => episode.id)).size === episodes.length, "Capture episode ids must be unique"),
  action: z.object({
    scale: z.number().positive().max(1),
    maximumSlewPerSecond: z.number().positive(),
  }).strict(),
  hostLossTest: z.object({
    episode: idSchema,
    afterStateStep: z.number().int().nonnegative(),
  }).strict().optional(),
  safety: z.object({
    maximumJointVelocityRadPerSec: z.number().positive(),
    maximumDecisionLatencyMs: z.number().positive().optional(),
    minimumBaseHeightM: z.number().nonnegative().optional(),
    maximumBaseHeightM: z.number().positive().optional(),
    maximumBodyTiltRad: z.number().positive().max(Math.PI).optional(),
  }).strict(),
  notes: z.string(),
}).strict().superRefine((plan, context) => {
  if (plan.safety.minimumBaseHeightM !== undefined && plan.safety.maximumBaseHeightM !== undefined && plan.safety.minimumBaseHeightM >= plan.safety.maximumBaseHeightM) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["safety"], message: "minimumBaseHeightM must be below maximumBaseHeightM" });
  }
  if (plan.hostLossTest !== undefined) {
    const episode = plan.episodes.find((item) => item.id === plan.hostLossTest?.episode);
    if (!episode) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["hostLossTest", "episode"], message: "hostLossTest episode must name one Capture episode" });
    } else if (plan.hostLossTest.afterStateStep >= episode.steps) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["hostLossTest", "afterStateStep"], message: "hostLossTest afterStateStep must be before the episode terminal state" });
    }
  }
});

export const hardwareCaptureAuthorizationSchema = z.object({
  version: z.literal(1),
  plan: idSchema,
  planHash: z.string().regex(/^[0-9a-f]{64}$/),
  target: idSchema,
  bundleHash: z.string().regex(/^[0-9a-f]{64}$/),
  environment: z.enum(["hil", "real"]),
  device: z.object({ vendor: z.string().min(1), model: z.string().min(1), serial: z.string().min(1) }).strict(),
  operator: z.string().min(1),
  approvedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  maximumEpisodes: z.number().int().positive(),
  notes: z.string(),
}).strict();

export const hardwareEvidenceSchema = z.object({
  version: z.literal(1), target: idSchema, bundleHash: z.string().regex(/^[0-9a-f]{64}$/), environment: z.enum(["dry-run", "hil", "real"]),
  device: z.object({ vendor: z.string().min(1), model: z.string().min(1), serial: z.string().min(1) }).strict(),
  observationContractHash: z.string().regex(/^[0-9a-f]{64}$/), actionContractHash: z.string().regex(/^[0-9a-f]{64}$/), driverHash: z.string().regex(/^[0-9a-f]{64}$/),
  stateContractHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  driverPackageHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  startedAt: z.string().datetime(), endedAt: z.string().datetime(), samples: z.number().int().positive(), maximumObservedLatencyMs: z.number().nonnegative(),
  maximumObservedStateAgeMs: z.number().nonnegative().optional(),
  missedDeadlines: z.number().int().nonnegative(), maximumConsecutiveMissesObserved: z.number().int().nonnegative(), emergencyStops: z.number().int().nonnegative(),
  emergencyStopAcknowledgements: z.number().int().nonnegative().optional(),
  decisionDeadlineRejections: z.number().int().nonnegative().optional(),
  deviceHealthSamples: z.number().int().nonnegative().optional(),
  deviceHealthTrips: z.number().int().nonnegative().optional(),
  actuatorIsolationTrips: z.number().int().nonnegative().optional(),
  postStopHealthChecks: z.number().int().nonnegative().optional(),
  postStopRecoveryCandidates: z.number().int().nonnegative().optional(),
  commandLeaseExpirations: z.number().int().nonnegative().optional(),
  driverAutonomousStops: z.number().int().nonnegative().optional(),
  maximumObservedCommandSilenceMs: z.number().nonnegative().optional(),
  passed: z.boolean(), operator: z.string().min(1), notes: z.string(),
}).strict();

export const candidateSchema = z.object({
  version: z.literal(1), id: idSchema, name: z.string().min(1), kind: z.enum(["optimization", "development"]), benchmark: idSchema,
  baseRevision: idSchema.nullable(), baseline: z.object({ assembly: idSchema, controller: idSchema }).strict(), proposed: z.object({ assembly: idSchema, controller: idSchema }).strict(),
  changes: z.object({
    components: z.object({ added: z.array(idSchema), removed: z.array(idSchema), modified: z.array(idSchema) }).strict(),
    observations: z.object({ added: z.array(idSchema), removed: z.array(idSchema), changed: z.array(idSchema) }).strict(),
    actions: z.object({ added: z.array(idSchema), removed: z.array(idSchema), changed: z.array(idSchema) }).strict(),
    controller: z.object({ from: idSchema, to: idSchema, files: z.array(relativeFileSchema) }).strict(),
    trainer: z.object({ from: idSchema.nullable(), to: idSchema.nullable(), files: z.array(relativeFileSchema) }).strict().nullable(),
    policy: z.object({ from: idSchema.nullable(), to: idSchema.nullable() }).strict().nullable(),
  }).strict(),
  allowedChanges: z.array(relativeFileSchema).min(1), fixedInputs: z.array(relativeFileSchema),
  hypothesis: z.string().min(1), expectedEffect: z.string().min(1),
}).strict();

export const researchSchema = z.object({
  version: z.literal(1), id: idSchema, name: z.string().min(1), benchmark: idSchema, assembly: idSchema, controller: idSchema, program: relativeFileSchema,
  editable: z.object({
    path: relativeFileSchema,
    parameters: z.array(z.object({
      path: z.string().regex(/^\/config\/[A-Za-z0-9_-]+$/, "V1 research parameters must be one numeric /config/<key> path"),
      minimum: z.number().finite(), maximum: z.number().finite(), step: z.number().positive(),
      directionOrder: z.tuple([z.enum(["decrease", "increase"]), z.enum(["decrease", "increase"])]).refine((value) => value[0] !== value[1], "directionOrder must contain both directions"),
    }).strict()).min(1),
  }).strict(),
  minimumImprovement: z.number().nonnegative(), maxIterations: z.number().int().positive(),
}).strict();

export const researchProposalSchema = z.object({
  strategy: idSchema, hypothesis: z.string().min(1), expectedEffect: z.string().min(1), values: z.record(z.number().finite()).refine((value) => Object.keys(value).length > 0, "proposal must change at least one value"),
}).strict();

const researchDirectionSchema = z.tuple([z.enum(["decrease", "increase"]), z.enum(["decrease", "increase"])]).refine((value) => value[0] !== value[1], "directionOrder must contain both directions");

export const trainingResearchSchema = z.object({
  version: z.literal(1), id: idSchema, name: z.string().min(1), benchmark: idSchema, training: idSchema, controller: idSchema, program: relativeFileSchema, seed: z.number().int(),
  editable: z.object({
    path: relativeFileSchema,
    parameters: z.array(z.object({
      path: z.enum(["/totalSteps", "/rolloutSteps", "/epochs", "/minibatchSize", "/learningRate", "/gamma", "/gaeLambda", "/clipRatio", "/entropyCoefficient", "/residualScale", "/residualPenalty"]),
      minimum: z.number().finite(), maximum: z.number().finite(), step: z.number().positive(), integer: z.boolean().default(false), directionOrder: researchDirectionSchema,
    }).strict()).min(1),
  }).strict(),
  minimumImprovement: z.number().nonnegative(), maxIterations: z.number().int().positive(),
}).strict();

const researchSourcePathSchema = relativeFileSchema.refine(
  (value) => !value.includes("*") || value.endsWith("/**") && !value.slice(0, -3).includes("*"),
  "editable source paths may only use a trailing /** directory closure",
);

export const researchLabSchema = z.object({
  version: z.literal(2),
  id: idSchema,
  name: z.string().min(1),
  program: relativeFileSchema,
  benchmark: idSchema,
  regressions: z.array(idSchema).default([]),
  execution: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("controller"), assembly: idSchema, controller: idSchema }).strict(),
    z.object({ kind: z.literal("policy"), training: idSchema, controller: idSchema, referenceController: idSchema.optional(), seed: z.number().int() }).strict(),
    z.object({ kind: z.literal("development"), candidate: idSchema }).strict(),
  ]),
  editable: z.object({
    paths: z.array(researchSourcePathSchema).min(1).refine((paths) => new Set(paths).size === paths.length, "editable source paths must be unique"),
  }).strict(),
  budget: z.object({
    maxExperiments: z.number().int().positive(),
    maxWallClockSeconds: z.number().int().positive(),
    maximumTrainingSteps: z.number().int().positive().optional(),
  }).strict(),
  minimumImprovement: z.number().nonnegative(),
  promotion: z.enum(["evidence-only", "policy-revision", "robot-revision"]),
}).strict().superRefine((lab, context) => {
  if (lab.execution.kind === "policy" && lab.budget.maximumTrainingSteps === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["budget", "maximumTrainingSteps"], message: "policy Labs require a maximumTrainingSteps budget" });
  }
  if (lab.execution.kind !== "policy" && lab.promotion === "policy-revision") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["promotion"], message: "only policy Labs may publish Policy Revisions" });
  }
  if (lab.execution.kind === "policy" && lab.promotion === "robot-revision") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["promotion"], message: "policy Labs publish Policy Revisions; a Development Candidate must promote a Robot Revision" });
  }
});

export const researchLabProposalSchema = z.object({
  strategy: idSchema,
  hypothesis: z.string().min(1),
  expectedEffect: z.string().min(1),
}).strict();

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, "must be a lowercase SHA-256 digest");

const developmentGateSchema = z.object({
  id: z.string().min(1),
  metric: z.string().min(1),
  comparator: z.string().min(1),
  value: z.number().finite(),
  threshold: z.number().finite(),
  margin: z.number().finite(),
  severity: z.number().finite().nonnegative(),
  enforced: z.boolean(),
  passed: z.boolean(),
}).passthrough();

const developmentHypothesisSchema = z.object({
  kind: z.literal("hypothesis"),
  surface: z.enum(["controller", "assembly", "training"]),
  description: z.string().min(1),
  rationale: z.string().min(1),
}).strict();

const developmentBenchmarkCaseSchema = z.object({
  id: idSchema,
  task: idSchema,
  scenario: idSchema,
  seed: z.number().int(),
  gating: z.boolean(),
  score: z.number().finite(),
  scoreDelta: z.number().finite(),
  resultHash: sha256Schema,
  metrics: z.record(z.unknown()),
  gates: z.array(developmentGateSchema),
  violations: z.array(developmentGateSchema),
  violationSeverity: z.number().finite().nonnegative(),
  findings: z.array(z.record(z.unknown())),
  hypotheses: z.array(developmentHypothesisSchema),
  reproduceArgv: z.array(z.string()).min(1),
}).strict();

export const developmentReviewSchema = z.object({
  version: z.literal(1),
  kind: z.literal("mujica-development-review"),
  project: idSchema,
  charterHash: sha256Schema,
  morphologyHash: sha256Schema,
  subject: z.object({
    assembly: idSchema,
    assemblyHash: sha256Schema,
    controller: idSchema,
    controllerHash: sha256Schema,
    controllerKind: z.enum(["program", "policy"]),
  }).strict(),
  design: z.object({
    subject: z.object({
      totalMassKg: z.number().finite().nonnegative(),
      componentCost: z.number().finite().nonnegative(),
      actionSize: z.number().int().positive(),
      observationSize: z.number().int().positive(),
      contactPointCount: z.number().int().nonnegative(),
    }).strict(),
    constraints: z.array(z.object({
      id: idSchema,
      label: z.string().min(1),
      comparator: z.enum(["<=", "=="]),
      value: z.number().finite(),
      threshold: z.number().finite(),
      unit: z.string().min(1),
      margin: z.number().finite(),
      passed: z.boolean(),
    }).strict()),
  }).strict(),
  benchmarks: z.array(z.object({
    id: idSchema,
    lockHash: sha256Schema,
    objective: idSchema,
    subject: z.object({ assembly: idSchema, controller: idSchema }).strict(),
    baseline: z.object({ assembly: idSchema, controller: idSchema }).strict(),
    aggregateScore: z.number().finite(),
    aggregateDelta: z.number().finite(),
    status: z.enum(["PASS", "FAIL"]),
    violationCount: z.number().int().nonnegative(),
    violations: z.array(z.record(z.unknown())),
    worstCase: idSchema.nullable(),
    cases: z.array(developmentBenchmarkCaseSchema),
  }).strict()),
  stages: z.array(z.object({
    id: idSchema,
    name: z.string().min(1),
    authoredStatus: z.enum(["planned", "active", "accepted"]),
    observedStatus: z.enum(["PASS", "FAIL"]),
    benchmarks: z.array(z.object({ id: idSchema, status: z.enum(["PASS", "FAIL"]), lockHash: sha256Schema, violationCount: z.number().int().nonnegative() }).strict()),
    witnesses: z.array(z.object({ task: idSchema, scenario: idSchema, benchmark: idSchema, role: z.enum(["development", "regression", "release"]), cases: z.array(idSchema), passed: z.boolean() }).strict()),
    exitCriteria: z.array(z.string().min(1)),
  }).strict()),
  northStar: z.object({
    statement: z.string().min(1),
    stage: idSchema,
    benchmark: idSchema,
    requireHumanReview: z.boolean(),
    satisfied: z.boolean(),
    numericalSatisfied: z.boolean(),
    humanReviewStatus: z.enum(["REQUIRED", "NOT_REQUIRED"]),
    designPassed: z.boolean(),
    stageStatus: z.enum(["PASS", "FAIL"]),
    benchmarkStatus: z.enum(["PASS", "FAIL"]),
  }).strict(),
  summary: z.object({
    status: z.enum(["NORTH_STAR_SATISFIED", "HUMAN_REVIEW_REQUIRED", "DEVELOPMENT_REQUIRED"]),
    designPassed: z.boolean(),
    passedStages: z.number().int().nonnegative(),
    totalStages: z.number().int().positive(),
    violationCount: z.number().int().nonnegative(),
    worstCase: z.object({ benchmark: idSchema, case: idSchema, severity: z.number().finite().nonnegative() }).strict().nullable(),
    interventionSurfaces: z.array(z.object({
      surface: z.enum(["design", "controller", "assembly", "training", "human-review"]),
      rationale: z.string().min(1),
    }).strict()),
  }).strict(),
}).strict();

export const developmentWorkOrderSchema = z.object({
  version: z.literal(1),
  kind: z.literal("mujica-development-work-order"),
  project: idSchema,
  charterHash: sha256Schema,
  review: z.object({ id: z.string().regex(/^development-review-[a-f0-9]{16}$/), hash: sha256Schema }).strict(),
  subject: developmentReviewSchema.shape.subject,
  status: z.enum(["READY", "PARTIALLY_ROUTED", "NO_ELIGIBLE_LANES", "HUMAN_REVIEW_REQUIRED", "NORTH_STAR_SATISFIED"]),
  blockers: z.array(z.object({
    rank: z.number().int().positive(),
    benchmark: idSchema,
    case: idSchema,
    severity: z.number().finite().nonnegative(),
    violations: z.array(developmentGateSchema),
    hypotheses: z.array(developmentHypothesisSchema),
    reproduceArgv: z.array(z.string()).min(1),
  }).strict()),
  lanes: z.array(z.object({
    id: idSchema,
    kind: z.enum(["controller-code", "rl-policy", "complete-design"]),
    researchLab: idSchema,
    labHash: sha256Schema,
    programHash: sha256Schema,
    primaryBenchmark: idSchema,
    blockerCases: z.array(idSchema).min(1),
    regressions: z.array(idSchema),
    subject: z.object({ assembly: idSchema, controller: idSchema, training: idSchema.optional(), candidate: idSchema.optional() }).strict(),
    editablePaths: z.array(z.string().min(1)).min(1),
    budget: z.object({ maxExperiments: z.number().int().positive(), maxWallClockSeconds: z.number().int().positive(), maximumTrainingSteps: z.number().int().positive().optional() }).strict(),
    promotion: z.enum(["evidence-only", "policy-revision", "robot-revision"]),
    runArgv: z.array(z.string()).min(1),
    reviewArgv: z.array(z.string()).min(1),
  }).strict()),
  uncoveredSurfaces: z.array(z.object({
    surface: z.enum(["design", "controller", "assembly", "training", "human-review"]),
    rationale: z.string().min(1),
  }).strict()),
  authorityBoundary: z.object({
    prioritization: z.literal("derived"),
    experimentDecision: z.literal("locked-judge"),
    sourcePromotion: z.literal("verdict-governed"),
    northStarClaim: z.literal("new-development-review-required"),
  }).strict(),
}).strict();

export const humanObservationSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("run-frame"),
    runId: idSchema,
    resultHash: sha256Schema,
    timeSeconds: z.number().finite().nonnegative(),
    comparisonRunId: idSchema.optional(),
    comparisonResultHash: sha256Schema.optional(),
  }).strict(),
  z.object({
    kind: z.literal("hardware-capture-event"),
    captureId: idSchema,
    captureHash: sha256Schema,
    eventIndex: z.number().int().nonnegative(),
  }).strict(),
  z.object({
    kind: z.literal("hardware-capture-frame"),
    captureId: idSchema,
    captureHash: sha256Schema,
    bundleHash: sha256Schema,
    episodeId: idSchema,
    episodeHash: sha256Schema,
    timeSeconds: z.number().finite().nonnegative(),
  }).strict(),
  z.object({
    kind: z.literal("digital-twin-audit-transition"),
    auditId: idSchema,
    auditHash: sha256Schema,
    captureId: idSchema,
    captureHash: sha256Schema,
    bundleHash: sha256Schema,
    episodeId: idSchema,
    episodeHash: sha256Schema,
    transitionIndex: z.number().int().nonnegative(),
  }).strict(),
]);

export const humanObservationAssessmentSchema = z.object({
  category: z.enum(["motion", "stability", "contact", "control", "timing", "safety", "other"]),
  severity: z.enum(["info", "investigate", "blocking"]),
  confidence: z.enum(["low", "medium", "high"]),
  summary: z.string().trim().min(1).max(240),
  details: z.string().trim().max(2_000).optional(),
  suggestedNextAction: z.string().trim().max(500).optional(),
}).strict();

export const humanObservationDraftSchema = z.object({
  version: z.literal(1),
  kind: z.literal("mujica-human-observation-draft"),
  source: humanObservationSourceSchema,
  assessment: humanObservationAssessmentSchema,
}).strict().superRefine((draft, context) => {
  if (
    draft.source.kind === "run-frame"
    && (draft.source.comparisonRunId === undefined) !== (draft.source.comparisonResultHash === undefined)
  ) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["source"], message: "comparison Run id and result hash must be supplied together" });
  }
});

export const researchBriefSchema = z.object({
  version: z.literal(1),
  kind: z.literal("mujica-research-brief"),
  authority: z.literal("derived-handoff"),
  claimKind: z.literal("research-prioritization"),
  lab: z.object({
    definition: researchLabSchema,
    labHash: sha256Schema,
    programHash: sha256Schema,
    benchmarkLockHash: sha256Schema,
  }).strict(),
  observations: z.array(z.object({
    id: idSchema,
    observationHash: sha256Schema,
    contextHash: sha256Schema,
    draftHash: sha256Schema,
    observer: z.string().min(1).max(120),
    recordedAt: z.string().datetime(),
    source: humanObservationSourceSchema,
    assessment: humanObservationAssessmentSchema,
    context: z.record(z.string(), z.unknown()),
  }).strict()).min(1).max(16),
  authorityBoundary: z.object({
    humanInput: z.literal("hypothesis-only"),
    sourceContext: z.literal("immutable-evidence"),
    sourceEdits: z.literal("lab-closure-only"),
    promotion: z.literal("locked-judge-only"),
  }).strict(),
}).strict();

const researchJudgeDecisionSchema = z.object({
  verdict: z.enum(["KEEP", "REVERT"]),
  gateReasons: z.array(z.string()),
  previousViolationCount: z.number().int().nonnegative(),
  candidateViolationCount: z.number().int().nonnegative(),
  previousViolationSeverity: z.number().finite().nonnegative(),
  candidateViolationSeverity: z.number().finite().nonnegative(),
  feasibilityImproved: z.boolean(),
  severityImproved: z.boolean(),
  scoreImproved: z.boolean(),
  selectionReason: z.enum([
    "fewer-gate-violations",
    "lower-gate-violation-severity",
    "score-improvement-within-feasibility-tier",
    "gate-regression",
    "no-lexicographic-improvement",
  ]),
}).strict();

const researchReviewRunSchema = z.object({
  role: z.enum(["accepted", "candidate"]),
  id: idSchema,
  runKey: sha256Schema,
  resultHash: sha256Schema,
  artifactHash: sha256Schema,
  manifestHash: sha256Schema,
  metricsHash: sha256Schema,
  scoreHash: sha256Schema,
  assembly: idSchema,
  controller: idSchema,
  score: z.number().finite(),
}).strict();

export const researchReviewSchema = z.object({
  version: z.literal(1),
  kind: z.literal("mujica-research-review"),
  authority: z.literal("derived-human-review"),
  claimKind: z.literal("visual-witness"),
  lineage: z.object({
    researchId: idSchema,
    labHash: sha256Schema,
    programHash: sha256Schema,
    benchmarkLockHash: sha256Schema,
    researchBriefId: idSchema.nullable(),
    researchBriefHash: sha256Schema.nullable(),
    observationIds: z.array(idSchema),
    sessionId: idSchema,
    experimentId: idSchema,
    experimentHash: sha256Schema,
  }).strict(),
  proposal: researchLabProposalSchema,
  judge: z.object({
    verdict: z.enum(["KEEP", "REVERT"]),
    decision: researchJudgeDecisionSchema,
    decisionHash: sha256Schema,
  }).strict(),
  selectedCase: z.object({
    benchmark: idSchema,
    id: idSchema,
    task: idSchema,
    scenario: idSchema,
    seed: z.number().int(),
    weight: z.number().positive(),
    gating: z.boolean(),
    selectionPolicy: z.enum([
      "first-primary-gate-regression",
      "largest-absolute-weighted-score-delta",
      "first-primary-case",
    ]),
    selectionReason: z.string().min(1),
    candidateScoreDelta: z.number().finite(),
    weightedScoreDelta: z.number().finite(),
  }).strict(),
  accepted: researchReviewRunSchema.extend({ role: z.literal("accepted") }).strict(),
  candidate: researchReviewRunSchema.extend({ role: z.literal("candidate") }).strict(),
  authorityBoundary: z.object({
    visualInterpretation: z.literal("hypothesis-only"),
    simulationEvidence: z.literal("immutable-runs"),
    experimentDecision: z.literal("locked-judge"),
    sourcePromotion: z.literal("verdict-governed"),
  }).strict(),
}).strict();

export type ControllerDefinition = z.output<typeof controllerSchema>;
export type DevelopmentCharter = z.output<typeof developmentCharterSchema>;
export type TaskDefinition = z.output<typeof taskSchema>;
export type ScenarioDefinition = z.output<typeof scenarioSchema>;
export type DomainProfileDefinition = z.output<typeof domainProfileSchema>;
export type ObjectiveDefinition = z.output<typeof objectiveSchema>;
export type BenchmarkDefinition = z.output<typeof benchmarkSchema>;
export type TrainerDefinition = z.output<typeof trainerSchema>;
export type TrainingDefinition = z.output<typeof trainingSchema>;
export type CalibrationDefinition = z.output<typeof calibrationSchema>;
export type DriverPackageDefinition = z.output<typeof driverPackageSchema>;
export type HardwareTargetDefinition = z.output<typeof hardwareTargetSchema>;
export type HardwareCapturePlanDefinition = z.output<typeof hardwareCapturePlanSchema>;
export type HardwareCaptureAuthorization = z.output<typeof hardwareCaptureAuthorizationSchema>;
export type HardwareEvidence = z.output<typeof hardwareEvidenceSchema>;
export type CandidateDefinition = z.output<typeof candidateSchema>;
export type ResearchDefinition = z.output<typeof researchSchema>;
export type ResearchProposal = z.output<typeof researchProposalSchema>;
export type TrainingResearchDefinition = z.output<typeof trainingResearchSchema>;
export type ResearchLabDefinition = z.output<typeof researchLabSchema>;
export type ResearchLabProposal = z.output<typeof researchLabProposalSchema>;
export type DevelopmentReview = z.output<typeof developmentReviewSchema>;
export type DevelopmentWorkOrder = z.output<typeof developmentWorkOrderSchema>;
export type HumanObservationDraft = z.output<typeof humanObservationDraftSchema>;
export type ResearchBrief = z.output<typeof researchBriefSchema>;
export type ResearchReview = z.output<typeof researchReviewSchema>;
