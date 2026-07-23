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
  defaults: z.object({ assembly: idSchema, controller: idSchema, task: idSchema, scenario: idSchema, objective: idSchema, benchmark: idSchema }).strict(),
}).strict();

export const workspaceSchema = z.object({ version: z.literal(1), name: z.string().min(1), projectsDirectory: relativeFileSchema, defaultProject: idSchema.nullable() }).strict();

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

export const taskSchema = z.union([
  z.object({ version: z.literal(2), ...taskBase, motionCommand: motionCommandSchema }).strict(),
  scheduledTaskSchema,
]);

export const scenarioSchema = z.object({
  version: z.literal(1), id: idSchema, name: z.string().min(1), friction: z.number().positive(), payloadKg: z.number().nonnegative(),
  lateralPush: z.object({ timeSeconds: z.number().nonnegative(), durationSeconds: z.number().positive(), forceNewton: z.number() }).strict().nullable(),
  observationNoiseStd: z.number().nonnegative(), actuatorDelaySteps: z.number().int().nonnegative(),
  initialJointPositionNoiseStd: z.number().nonnegative().default(0), initialJointVelocityNoiseStd: z.number().nonnegative().default(0),
  bodyMassScale: z.number().positive().optional(), jointDampingScale: z.number().nonnegative().optional(), actuatorStrengthScale: z.number().positive().optional(),
}).strict();

const positiveDomainRangeSchema = z.object({ minimum: z.number().positive(), maximum: z.number().positive() }).strict()
  .refine((value) => value.minimum <= value.maximum, "minimum must not exceed maximum");
const nonnegativeDomainRangeSchema = z.object({ minimum: z.number().nonnegative(), maximum: z.number().nonnegative() }).strict()
  .refine((value) => value.minimum <= value.maximum, "minimum must not exceed maximum");
const integerDomainRangeSchema = z.object({ minimum: z.number().int(), maximum: z.number().int() }).strict()
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
    maximumRegression: z.number().nonnegative(),
  }).strict(),
}).strict();

export const benchmarkSchema = z.object({
  version: z.literal(1), id: idSchema, name: z.string().min(1), objective: idSchema,
  baseline: z.object({ assembly: idSchema, controller: idSchema }).strict(),
  cases: z.array(z.object({ id: idSchema, task: idSchema, scenario: idSchema, seed: z.number().int(), weight: z.number().positive(), gating: z.boolean().default(true) }).strict()).min(1),
}).strict();

export const trainerSchema = z.object({ version: z.literal(1), id: idSchema, name: z.string().min(1), kind: z.literal("ppo"), entry: relativeFileSchema, model: relativeFileSchema }).strict();

export const trainingSchema = z.object({
  version: z.literal(1), id: idSchema, name: z.string().min(1), assembly: idSchema, trainer: idSchema, task: idSchema, scenarios: z.array(idSchema).min(1),
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
}).strict();

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

export const hardwareTargetSchema = z.object({
  version: z.literal(1), id: idSchema, name: z.string().min(1), revision: idSchema, assembly: idSchema, controller: idSchema,
  environment: z.enum(["dry-run", "hil", "real"]), protocol: z.literal("stdio-jsonl-v1"), controlHz: z.number().positive(),
  safety: z.object({
    maximumLatencyMs: z.number().positive(),
    maximumStateAgeMs: z.number().positive().optional(),
    maximumConsecutiveMisses: z.number().int().nonnegative(),
    emergencyStopAction: z.array(z.number().finite()).min(1),
  }).strict(),
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
  safety: z.object({
    maximumJointVelocityRadPerSec: z.number().positive(),
    minimumBaseHeightM: z.number().nonnegative().optional(),
    maximumBaseHeightM: z.number().positive().optional(),
    maximumBodyTiltRad: z.number().positive().max(Math.PI).optional(),
  }).strict(),
  notes: z.string(),
}).strict().superRefine((plan, context) => {
  if (plan.safety.minimumBaseHeightM !== undefined && plan.safety.maximumBaseHeightM !== undefined && plan.safety.minimumBaseHeightM >= plan.safety.maximumBaseHeightM) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["safety"], message: "minimumBaseHeightM must be below maximumBaseHeightM" });
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
  startedAt: z.string().datetime(), endedAt: z.string().datetime(), samples: z.number().int().positive(), maximumObservedLatencyMs: z.number().nonnegative(),
  maximumObservedStateAgeMs: z.number().nonnegative().optional(),
  missedDeadlines: z.number().int().nonnegative(), maximumConsecutiveMissesObserved: z.number().int().nonnegative(), emergencyStops: z.number().int().nonnegative(),
  emergencyStopAcknowledgements: z.number().int().nonnegative().optional(),
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

export type ControllerDefinition = z.output<typeof controllerSchema>;
export type TaskDefinition = z.output<typeof taskSchema>;
export type ScenarioDefinition = z.output<typeof scenarioSchema>;
export type DomainProfileDefinition = z.output<typeof domainProfileSchema>;
export type ObjectiveDefinition = z.output<typeof objectiveSchema>;
export type BenchmarkDefinition = z.output<typeof benchmarkSchema>;
export type TrainerDefinition = z.output<typeof trainerSchema>;
export type TrainingDefinition = z.output<typeof trainingSchema>;
export type CalibrationDefinition = z.output<typeof calibrationSchema>;
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
