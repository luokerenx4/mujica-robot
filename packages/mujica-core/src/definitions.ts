import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { compareAssemblies, compileAssembly } from "./compiler";
import { benchmarkSchema, candidateSchema, controllerSchema, hardwareTargetSchema, objectiveSchema, researchLabSchema, researchSchema, scenarioSchema, taskSchema, trainerSchema, trainingResearchSchema, trainingSchema, type BenchmarkDefinition, type CandidateDefinition, type ControllerDefinition, type HardwareTargetDefinition, type ObjectiveDefinition, type ResearchDefinition, type ResearchLabDefinition, type ScenarioDefinition, type TaskDefinition, type TrainerDefinition, type TrainingDefinition, type TrainingResearchDefinition } from "./schemas";
import type { CompiledAssembly } from "./types";
import { confined, readJson, stableJson } from "./utils";
import { loadProject } from "./workspace";

export async function loadController(projectDir: string, id: string): Promise<{ definition: ControllerDefinition; rootDir: string }> {
  const rootDir = confined(resolve(projectDir), `controllers/${id}`); const definition = await readJson(join(rootDir, "controller.json"), controllerSchema) as ControllerDefinition;
  if (definition.id !== id) throw new Error(`Controller id '${definition.id}' must match directory '${id}'`);
  return { definition, rootDir };
}

export interface ControllerInterfaceIssue {
  code: "observation.missing" | "observation.size" | "action.count" | "action.name" | "action.size" | "action.bounds";
  channel: string | null;
  message: string;
}

export function programControllerInterfaceIssues(controller: ControllerDefinition, assembly: CompiledAssembly): ControllerInterfaceIssue[] {
  if (controller.kind !== "program") return [];
  const issues: ControllerInterfaceIssue[] = [];
  const observations = new Map(assembly.observationContract.channels.map((channel) => [channel.name, channel]));
  for (const requirement of controller.interface.requiredObservations) {
    const actual = observations.get(requirement.name);
    if (!actual) issues.push({ code: "observation.missing", channel: requirement.name, message: `Program Controller '${controller.id}' requires Observation '${requirement.name}' (size ${requirement.size}), but Assembly '${assembly.id}' does not provide it` });
    else if (actual.size !== requirement.size) issues.push({ code: "observation.size", channel: requirement.name, message: `Program Controller '${controller.id}' requires Observation '${requirement.name}' size ${requirement.size}, but Assembly '${assembly.id}' provides size ${actual.size}` });
  }
  const expected = controller.interface.actionChannels; const actual = assembly.actionContract.channels;
  if (expected.length !== actual.length) issues.push({ code: "action.count", channel: null, message: `Program Controller '${controller.id}' produces ${expected.length} Action channels, but Assembly '${assembly.id}' requires ${actual.length}` });
  for (let index = 0; index < Math.min(expected.length, actual.length); index++) {
    const produced = expected[index]!; const required = actual[index]!;
    if (produced.name !== required.name) issues.push({ code: "action.name", channel: produced.name, message: `Program Controller '${controller.id}' Action ${index} is '${produced.name}', but Assembly '${assembly.id}' requires '${required.name}'` });
    if (produced.size !== required.size) issues.push({ code: "action.size", channel: produced.name, message: `Program Controller '${controller.id}' Action '${produced.name}' has size ${produced.size}, but Assembly '${assembly.id}' requires size ${required.size}` });
    if (produced.low !== required.low || produced.high !== required.high) issues.push({ code: "action.bounds", channel: produced.name, message: `Program Controller '${controller.id}' Action '${produced.name}' bounds [${produced.low}, ${produced.high}] do not match Assembly '${assembly.id}' bounds [${required.low ?? "unbounded"}, ${required.high ?? "unbounded"}]` });
  }
  return issues;
}

export function assertProgramControllerCompatible(controller: ControllerDefinition, assembly: CompiledAssembly): void {
  const issues = programControllerInterfaceIssues(controller, assembly);
  if (issues.length) throw new Error(issues.map((issue) => issue.message).join("\n"));
}
export const loadTask = async (projectDir: string, id: string): Promise<TaskDefinition> => await readJson(confined(resolve(projectDir), `tasks/${id}.task.json`), taskSchema) as TaskDefinition;
export const loadScenario = async (projectDir: string, id: string): Promise<ScenarioDefinition> => await readJson(confined(resolve(projectDir), `scenarios/${id}.scenario.json`), scenarioSchema) as ScenarioDefinition;
export const loadObjective = async (projectDir: string, id: string): Promise<ObjectiveDefinition> => await readJson(confined(resolve(projectDir), `objectives/${id}.objective.json`), objectiveSchema) as ObjectiveDefinition;
export const loadBenchmark = async (projectDir: string, id: string): Promise<BenchmarkDefinition> => await readJson(confined(resolve(projectDir), `benchmarks/${id}.benchmark.json`), benchmarkSchema) as BenchmarkDefinition;
export const loadTraining = async (projectDir: string, id: string): Promise<TrainingDefinition> => await readJson(confined(resolve(projectDir), `training/${id}.training.json`), trainingSchema) as TrainingDefinition;
export const loadCandidate = async (projectDir: string, id: string): Promise<CandidateDefinition> => await readJson(confined(resolve(projectDir), `candidates/${id}/candidate.json`), candidateSchema) as CandidateDefinition;
export const loadResearch = async (projectDir: string, id: string): Promise<ResearchDefinition> => await readJson(confined(resolve(projectDir), `research/${id}.research.json`), researchSchema) as ResearchDefinition;
export const loadTrainingResearch = async (projectDir: string, id: string): Promise<TrainingResearchDefinition> => await readJson(confined(resolve(projectDir), `training-research/${id}.training-research.json`), trainingResearchSchema) as TrainingResearchDefinition;
export const loadResearchLab = async (projectDir: string, id: string): Promise<ResearchLabDefinition> => await readJson(confined(resolve(projectDir), `research/${id}/research.json`), researchLabSchema) as ResearchLabDefinition;
export const loadHardwareTarget = async (projectDir: string, id: string): Promise<HardwareTargetDefinition> => await readJson(confined(resolve(projectDir), `hardware-targets/${id}.hardware.json`), hardwareTargetSchema) as HardwareTargetDefinition;
export async function loadTrainer(projectDir: string, id: string): Promise<{ definition: TrainerDefinition; rootDir: string }> {
  const rootDir = confined(resolve(projectDir), `trainers/${id}`); const definition = await readJson(join(rootDir, "trainer.json"), trainerSchema) as TrainerDefinition;
  if (definition.id !== id) throw new Error(`Trainer id '${definition.id}' must match directory '${id}'`);
  return { definition, rootDir };
}

async function directoryIds(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith(".")).map((entry) => entry.name).sort();
}

export async function listControllerIds(projectDir: string): Promise<string[]> {
  return await directoryIds(confined(resolve(projectDir), "controllers"));
}

export async function listResearchLabIds(projectDir: string): Promise<string[]> {
  const root = confined(resolve(projectDir), "research"); const ids: string[] = [];
  for (const id of await directoryIds(root)) if (await Bun.file(join(root, id, "research.json")).exists()) ids.push(id);
  return ids;
}

async function fileIds(root: string, suffix: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(suffix)).map((entry) => entry.name.slice(0, -suffix.length)).sort();
}

async function requireFile(path: string, label: string): Promise<void> {
  if (!(await Bun.file(path).exists())) throw new Error(`${label} does not exist: ${path}`);
}

export async function verifyCandidateChanges(projectDir: string, candidate: CandidateDefinition) {
  const root = resolve(projectDir); const comparison = await compareAssemblies(root, candidate.baseline.assembly, candidate.proposed.assembly);
  const names = (items: Array<{ name: string }>) => items.map((item) => item.name).sort();
  const actual = {
    components: {
      added: comparison.components.added.map((item) => item.componentId).sort(),
      removed: comparison.components.removed.map((item) => item.componentId).sort(),
      modified: comparison.components.changed.map((item) => item.to.componentId).sort(),
    },
    observations: { added: names(comparison.observations.added), removed: names(comparison.observations.removed), changed: comparison.observations.changed.map((item) => item.to.name).sort() },
    actions: { added: names(comparison.actions.added), removed: names(comparison.actions.removed), changed: comparison.actions.changed.map((item) => item.to.name).sort() },
  };
  const normalized = (surface: Record<string, string[]>) => Object.fromEntries(Object.entries(surface).map(([key, values]) => [key, [...values].sort()]));
  for (const surface of ["components", "observations", "actions"] as const) {
    if (stableJson(normalized(candidate.changes[surface])) !== stableJson(actual[surface])) throw new Error(`Candidate '${candidate.id}' declared ${surface} changes do not match compiled Assembly diff`);
  }
  if (candidate.changes.controller.from !== candidate.baseline.controller || candidate.changes.controller.to !== candidate.proposed.controller) throw new Error(`Candidate '${candidate.id}' Controller change must match baseline/proposed Controllers`);
  const baselineController = await loadController(root, candidate.baseline.controller); const proposedController = await loadController(root, candidate.proposed.controller);
  assertProgramControllerCompatible(baselineController.definition, comparison.from); assertProgramControllerCompatible(proposedController.definition, comparison.to);
  const actualPolicy = {
    from: baselineController.definition.kind === "policy" ? baselineController.definition.policy : null,
    to: proposedController.definition.kind === "policy" ? proposedController.definition.policy : null,
  };
  if ((actualPolicy.from !== null || actualPolicy.to !== null) && stableJson(candidate.changes.policy) !== stableJson(actualPolicy)) throw new Error(`Candidate '${candidate.id}' Policy change must match baseline/proposed policy Controllers`);
  if (actualPolicy.from === null && actualPolicy.to === null && candidate.changes.policy !== null) throw new Error(`Candidate '${candidate.id}' declares a Policy change for program Controllers`);
  if (candidate.changes.controller.from !== candidate.changes.controller.to && candidate.changes.controller.files.length === 0) throw new Error(`Candidate '${candidate.id}' changes Controller without declaring files`);
  if (candidate.changes.trainer) {
    if (candidate.changes.trainer.from) await loadTrainer(root, candidate.changes.trainer.from);
    if (candidate.changes.trainer.to) await loadTrainer(root, candidate.changes.trainer.to);
  }
  const allowed = new Set(candidate.allowedChanges);
  for (const path of [...candidate.changes.controller.files, ...(candidate.changes.trainer?.files ?? [])]) if (!allowed.has(path)) throw new Error(`Candidate '${candidate.id}' declares changed file '${path}' outside allowedChanges`);
  return { comparison, declared: candidate.changes, actual };
}

export async function validateProjectDefinitions(projectDir: string): Promise<Record<string, number>> {
  const project = await loadProject(projectDir); const root = project.rootDir;
  const controllerIds = await directoryIds(join(root, "controllers"));
  for (const id of controllerIds) {
    const controller = await loadController(root, id);
    if (controller.definition.kind === "program") await requireFile(confined(controller.rootDir, controller.definition.entry), `Controller '${id}' entry`);
    else await requireFile(confined(root, `policies/${controller.definition.policy}/manifest.json`), `Controller '${id}' frozen policy`);
  }
  const trainerIds = await directoryIds(join(root, "trainers"));
  for (const id of trainerIds) {
    const trainer = await loadTrainer(root, id); await requireFile(confined(trainer.rootDir, trainer.definition.entry), `Trainer '${id}' entry`); await requireFile(confined(trainer.rootDir, trainer.definition.model), `Trainer '${id}' model`);
  }
  const taskIds = await fileIds(join(root, "tasks"), ".task.json"); for (const id of taskIds) await loadTask(root, id);
  const scenarioIds = await fileIds(join(root, "scenarios"), ".scenario.json"); for (const id of scenarioIds) await loadScenario(root, id);
  const objectiveIds = await fileIds(join(root, "objectives"), ".objective.json"); for (const id of objectiveIds) await loadObjective(root, id);
  const trainingIds = await fileIds(join(root, "training"), ".training.json");
  for (const id of trainingIds) {
    const training = await loadTraining(root, id); const assembly = await compileAssembly(root, training.assembly); await loadTrainer(root, training.trainer); await loadTask(root, training.task); for (const scenario of training.scenarios) await loadScenario(root, scenario);
    if (training.priorController) {
      const prior = await loadController(root, training.priorController); if (prior.definition.kind !== "program") throw new Error(`Training '${id}' priorController must be a program Controller`); assertProgramControllerCompatible(prior.definition, assembly);
    }
  }
  const benchmarkIds = await fileIds(join(root, "benchmarks"), ".benchmark.json");
  for (const id of benchmarkIds) {
    const benchmark = await loadBenchmark(root, id); await loadObjective(root, benchmark.objective); const assembly = await compileAssembly(root, benchmark.baseline.assembly); const controller = await loadController(root, benchmark.baseline.controller); assertProgramControllerCompatible(controller.definition, assembly); for (const item of benchmark.cases) { await loadTask(root, item.task); await loadScenario(root, item.scenario); }
  }
  const candidateIds = await directoryIds(join(root, "candidates"));
  for (const id of candidateIds) {
    const candidate = await loadCandidate(root, id); await loadBenchmark(root, candidate.benchmark); await verifyCandidateChanges(root, candidate);
    for (const path of [...candidate.allowedChanges, ...candidate.fixedInputs]) await requireFile(confined(root, path), `Candidate '${id}' input`);
  }
  const hardwareTargetIds = await fileIds(join(root, "hardware-targets"), ".hardware.json");
  for (const id of hardwareTargetIds) {
    const target = await loadHardwareTarget(root, id); if (target.id !== id) throw new Error(`Hardware Target id '${target.id}' must match filename '${id}'`);
    const revisionPath = confined(root, `revisions/${target.revision}`); await requireFile(join(revisionPath, "manifest.json"), `Hardware Target '${id}' Revision`);
    const revision = JSON.parse(await Bun.file(join(revisionPath, "manifest.json")).text());
    if (revision.assembly !== target.assembly || revision.controller !== target.controller) throw new Error(`Hardware Target '${id}' must match its Robot Revision Assembly and Controller`);
    const compiled = await compileAssembly(root, target.assembly); const controller = await loadController(root, target.controller); assertProgramControllerCompatible(controller.definition, compiled); if (target.safety.emergencyStopAction.length !== compiled.actionContract.size) throw new Error(`Hardware Target '${id}' emergency stop Action size does not match contract`);
    const lows = compiled.actionContract.channels.flatMap((channel) => Array(channel.size).fill(channel.low ?? Number.NEGATIVE_INFINITY)); const highs = compiled.actionContract.channels.flatMap((channel) => Array(channel.size).fill(channel.high ?? Number.POSITIVE_INFINITY));
    for (let index = 0; index < target.safety.emergencyStopAction.length; index++) if (target.safety.emergencyStopAction[index]! < lows[index]! || target.safety.emergencyStopAction[index]! > highs[index]!) throw new Error(`Hardware Target '${id}' emergency stop Action exceeds channel bounds`);
  }
  const researchIds = await fileIds(join(root, "research"), ".research.json");
  for (const id of researchIds) {
    const research = await loadResearch(root, id); await loadBenchmark(root, research.benchmark); const assembly = await compileAssembly(root, research.assembly); const controller = await loadController(root, research.controller); assertProgramControllerCompatible(controller.definition, assembly);
    if (controller.definition.kind !== "program") throw new Error(`Research '${id}' requires a program Controller`);
    const expectedPath = `controllers/${research.controller}/controller.json`; if (research.editable.path !== expectedPath) throw new Error(`Research '${id}' editable path must be '${expectedPath}'`);
    await requireFile(confined(root, research.program), `Research '${id}' program`);
    const keys = new Set<string>();
    for (const parameter of research.editable.parameters) {
      if (keys.has(parameter.path)) throw new Error(`Research '${id}' duplicates parameter '${parameter.path}'`); keys.add(parameter.path);
      if (parameter.minimum > parameter.maximum) throw new Error(`Research '${id}' parameter '${parameter.path}' minimum exceeds maximum`);
      const key = parameter.path.slice("/config/".length); const value = controller.definition.config[key];
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Research '${id}' parameter '${parameter.path}' does not name a finite numeric controller config`);
      if (value < parameter.minimum || value > parameter.maximum) throw new Error(`Research '${id}' current '${parameter.path}' value is outside bounds`);
    }
  }
  const trainingResearchIds = await fileIds(join(root, "training-research"), ".training-research.json");
  for (const id of trainingResearchIds) {
    const research = await loadTrainingResearch(root, id); const training = await loadTraining(root, research.training); await loadBenchmark(root, research.benchmark); const controller = await loadController(root, research.controller);
    if (controller.definition.kind !== "policy") throw new Error(`Training Research '${id}' requires a policy Controller`);
    const expectedPath = `training/${research.training}.training.json`; if (research.editable.path !== expectedPath) throw new Error(`Training Research '${id}' editable path must be '${expectedPath}'`);
    await requireFile(confined(root, research.program), `Training Research '${id}' program`); await compileAssembly(root, training.assembly);
    const keys = new Set<string>(); const numeric = training as unknown as Record<string, unknown>;
    for (const parameter of research.editable.parameters) {
      if (keys.has(parameter.path)) throw new Error(`Training Research '${id}' duplicates parameter '${parameter.path}'`); keys.add(parameter.path);
      if (parameter.minimum > parameter.maximum) throw new Error(`Training Research '${id}' parameter '${parameter.path}' minimum exceeds maximum`);
      const value = numeric[parameter.path.slice(1)]; if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Training Research '${id}' parameter '${parameter.path}' is not numeric`);
      if (value < parameter.minimum || value > parameter.maximum) throw new Error(`Training Research '${id}' current '${parameter.path}' value is outside bounds`);
      if (parameter.integer && (!Number.isInteger(value) || !Number.isInteger(parameter.minimum) || !Number.isInteger(parameter.maximum) || !Number.isInteger(parameter.step))) throw new Error(`Training Research '${id}' parameter '${parameter.path}' requires integer bounds and values`);
    }
  }
  const researchLabIds = await listResearchLabIds(root);
  const forbiddenLabRoots = new Set(["benchmarks", "objectives", "tasks", "scenarios", "runs", "training-runs", "research-runs", "training-research-runs", "policies", "revisions", "policy-revisions", "hardware-bundles", "hardware-verifications", ".mujica"]);
  for (const id of researchLabIds) {
    const lab = await loadResearchLab(root, id); if (lab.id !== id) throw new Error(`Research Lab id '${lab.id}' must match directory '${id}'`);
    const expectedProgram = `research/${id}/program.md`; if (lab.program !== expectedProgram) throw new Error(`Research Lab '${id}' program must be '${expectedProgram}'`);
    await requireFile(confined(root, lab.program), `Research Lab '${id}' program`);
    const benchmark = await loadBenchmark(root, lab.benchmark);
    for (const regression of lab.regressions) {
      if (regression === lab.benchmark) throw new Error(`Research Lab '${id}' repeats its primary Benchmark as a regression`);
      await loadBenchmark(root, regression);
    }
    for (const path of lab.editable.paths) {
      const base = path.endsWith("/**") ? path.slice(0, -3) : path; const first = base.split("/")[0]!;
      if (forbiddenLabRoots.has(first)) throw new Error(`Research Lab '${id}' editable path '${path}' overlaps Judge or immutable artifact state`);
      if (base === `research/${id}/research.json` || base === lab.program || base.startsWith(`research/${id}/`)) throw new Error(`Research Lab '${id}' cannot edit its own definition or human program`);
    }
    if (lab.execution.kind === "controller") {
      const assembly = await compileAssembly(root, lab.execution.assembly); const controller = await loadController(root, lab.execution.controller);
      if (controller.definition.kind !== "program") throw new Error(`Research Lab '${id}' controller lane requires a program Controller`);
      assertProgramControllerCompatible(controller.definition, assembly);
      if (lab.promotion === "policy-revision") throw new Error(`Research Lab '${id}' controller lane cannot publish a Policy Revision`);
    } else if (lab.execution.kind === "policy") {
      const training = await loadTraining(root, lab.execution.training); const controller = await loadController(root, lab.execution.controller);
      if (controller.definition.kind !== "policy") throw new Error(`Research Lab '${id}' policy lane requires a policy Controller`);
      if (training.totalSteps > lab.budget.maximumTrainingSteps!) throw new Error(`Research Lab '${id}' Training exceeds its maximumTrainingSteps budget`);
      await compileAssembly(root, training.assembly);
      if (benchmark.cases.length === 0) throw new Error(`Research Lab '${id}' Benchmark has no evaluation cases`);
    } else {
      const candidate = await loadCandidate(root, lab.execution.candidate);
      if (candidate.benchmark !== lab.benchmark) throw new Error(`Research Lab '${id}' Development Candidate must use its primary Benchmark`);
      await verifyCandidateChanges(root, candidate);
      if (lab.promotion === "policy-revision") throw new Error(`Research Lab '${id}' development lane cannot publish a Policy Revision`);
    }
  }
  const defaultAssembly = await compileAssembly(root, project.manifest.defaults.assembly); const defaultController = await loadController(root, project.manifest.defaults.controller); assertProgramControllerCompatible(defaultController.definition, defaultAssembly); await loadTask(root, project.manifest.defaults.task); await loadScenario(root, project.manifest.defaults.scenario); await loadObjective(root, project.manifest.defaults.objective); await loadBenchmark(root, project.manifest.defaults.benchmark);
  return { controllers: controllerIds.length, trainers: trainerIds.length, tasks: taskIds.length, scenarios: scenarioIds.length, objectives: objectiveIds.length, trainings: trainingIds.length, benchmarks: benchmarkIds.length, candidates: candidateIds.length, hardwareTargets: hardwareTargetIds.length, research: researchIds.length, trainingResearch: trainingResearchIds.length, researchLabs: researchLabIds.length };
}
