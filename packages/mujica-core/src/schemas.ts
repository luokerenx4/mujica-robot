import { z } from "zod";

export const idSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be a lowercase kebab-case id");
const relativeFileSchema = z.string().min(1).refine((value) => !value.startsWith("/") && !value.split("/").includes(".."), "must be a confined relative path");

const channelSchema = z.object({
  name: idSchema,
  kind: z.enum(["joint-position", "joint-velocity", "body-state", "sensor", "actuator"]),
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
  version: z.literal(1), id: idSchema, name: z.string().min(1), type: idSchema, fragment: relativeFileSchema,
  compatibleMounts: z.array(idSchema).min(1), providesMounts: z.array(mountSchema).default([]),
  observations: z.array(channelSchema).default([]), actions: z.array(channelSchema).default([]), dependencies: z.array(idSchema).default([]),
  configSchema: z.record(z.unknown()),
  massKg: z.number().nonnegative(), cost: z.number().nonnegative(), license: z.string().min(1), attribution: z.string(),
}).strict();

export const assemblySchema = z.object({
  version: z.literal(1), id: idSchema, name: z.string().min(1), base: idSchema,
  components: z.array(z.object({ id: idSchema, component: idSchema, mount: idSchema, config: z.record(z.unknown()).optional() }).strict()),
}).strict();

export const controllerSchema = z.discriminatedUnion("kind", [
  z.object({ version: z.literal(1), id: idSchema, name: z.string().min(1), kind: z.literal("program"), entry: relativeFileSchema, config: z.record(z.unknown()).default({}) }).strict(),
  z.object({ version: z.literal(1), id: idSchema, name: z.string().min(1), kind: z.literal("policy"), policy: idSchema, deterministic: z.boolean().default(true) }).strict(),
]);

export const taskSchema = z.object({
  version: z.literal(1), id: idSchema, name: z.string().min(1), durationSeconds: z.number().positive(), controlHz: z.number().positive(),
  targetVelocity: z.tuple([z.number(), z.number(), z.number()]), healthyHeight: z.tuple([z.number(), z.number()]), terminateOnFall: z.boolean(),
}).strict();

export const scenarioSchema = z.object({
  version: z.literal(1), id: idSchema, name: z.string().min(1), friction: z.number().positive(), payloadKg: z.number().nonnegative(),
  lateralPush: z.object({ timeSeconds: z.number().nonnegative(), durationSeconds: z.number().positive(), forceNewton: z.number() }).strict().nullable(),
  observationNoiseStd: z.number().nonnegative(), actuatorDelaySteps: z.number().int().nonnegative(),
  initialJointPositionNoiseStd: z.number().nonnegative().default(0), initialJointVelocityNoiseStd: z.number().nonnegative().default(0),
}).strict();

export const objectiveSchema = z.object({
  version: z.literal(1), id: idSchema, name: z.string().min(1),
  weights: z.object({
    survival: z.number(), velocityTracking: z.number(), forwardProgress: z.number().default(0), upright: z.number(), lateralDrift: z.number().default(0),
    energy: z.number(), smoothness: z.number(), componentMass: z.number(), sensorChannels: z.number(), trainingSteps: z.number(),
  }).strict(),
  gates: z.object({
    minimumSurvivalRate: z.number().min(0).max(1), minimumForwardProgress: z.number().min(0).max(1).default(0),
    maximumLateralDrift: z.number().nonnegative().default(1_000_000), maximumRegression: z.number().nonnegative(),
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
  totalSteps: z.number().int().positive(), rolloutSteps: z.number().int().positive(), epochs: z.number().int().positive(), minibatchSize: z.number().int().positive(),
  learningRate: z.number().positive(), gamma: z.number().min(0).max(1), gaeLambda: z.number().min(0).max(1), clipRatio: z.number().positive(), entropyCoefficient: z.number().nonnegative(),
  residualScale: z.number().min(0).max(1).optional(),
  residualPenalty: z.number().nonnegative().optional(),
}).strict();

export const candidateSchema = z.object({
  version: z.literal(1), id: idSchema, name: z.string().min(1), kind: z.enum(["optimization", "development"]), benchmark: idSchema,
  baseRevision: idSchema.nullable(), baseline: z.object({ assembly: idSchema, controller: idSchema }).strict(), proposed: z.object({ assembly: idSchema, controller: idSchema }).strict(),
  addedComponents: z.array(idSchema), removedComponents: z.array(idSchema), allowedChanges: z.array(relativeFileSchema).min(1), fixedInputs: z.array(relativeFileSchema),
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

export type ControllerDefinition = z.output<typeof controllerSchema>;
export type TaskDefinition = z.output<typeof taskSchema>;
export type ScenarioDefinition = z.output<typeof scenarioSchema>;
export type ObjectiveDefinition = z.output<typeof objectiveSchema>;
export type BenchmarkDefinition = z.output<typeof benchmarkSchema>;
export type TrainerDefinition = z.output<typeof trainerSchema>;
export type TrainingDefinition = z.output<typeof trainingSchema>;
export type CandidateDefinition = z.output<typeof candidateSchema>;
export type ResearchDefinition = z.output<typeof researchSchema>;
export type ResearchProposal = z.output<typeof researchProposalSchema>;
export type TrainingResearchDefinition = z.output<typeof trainingResearchSchema>;
