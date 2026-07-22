import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { compileAssembly } from "./compiler";
import { benchmarkSchema, candidateSchema, controllerSchema, objectiveSchema, scenarioSchema, taskSchema, trainerSchema, trainingSchema, type BenchmarkDefinition, type CandidateDefinition, type ControllerDefinition, type ObjectiveDefinition, type ScenarioDefinition, type TaskDefinition, type TrainerDefinition, type TrainingDefinition } from "./schemas";
import { confined, readJson } from "./utils";
import { loadProject } from "./workspace";

export async function loadController(projectDir: string, id: string): Promise<{ definition: ControllerDefinition; rootDir: string }> {
  const rootDir = confined(resolve(projectDir), `controllers/${id}`); const definition = await readJson(join(rootDir, "controller.json"), controllerSchema) as ControllerDefinition;
  if (definition.id !== id) throw new Error(`Controller id '${definition.id}' must match directory '${id}'`);
  return { definition, rootDir };
}
export const loadTask = async (projectDir: string, id: string): Promise<TaskDefinition> => await readJson(confined(resolve(projectDir), `tasks/${id}.task.json`), taskSchema) as TaskDefinition;
export const loadScenario = async (projectDir: string, id: string): Promise<ScenarioDefinition> => await readJson(confined(resolve(projectDir), `scenarios/${id}.scenario.json`), scenarioSchema) as ScenarioDefinition;
export const loadObjective = async (projectDir: string, id: string): Promise<ObjectiveDefinition> => await readJson(confined(resolve(projectDir), `objectives/${id}.objective.json`), objectiveSchema) as ObjectiveDefinition;
export const loadBenchmark = async (projectDir: string, id: string): Promise<BenchmarkDefinition> => await readJson(confined(resolve(projectDir), `benchmarks/${id}.benchmark.json`), benchmarkSchema) as BenchmarkDefinition;
export const loadTraining = async (projectDir: string, id: string): Promise<TrainingDefinition> => await readJson(confined(resolve(projectDir), `training/${id}.training.json`), trainingSchema) as TrainingDefinition;
export const loadCandidate = async (projectDir: string, id: string): Promise<CandidateDefinition> => await readJson(confined(resolve(projectDir), `candidates/${id}/candidate.json`), candidateSchema) as CandidateDefinition;
export async function loadTrainer(projectDir: string, id: string): Promise<{ definition: TrainerDefinition; rootDir: string }> {
  const rootDir = confined(resolve(projectDir), `trainers/${id}`); const definition = await readJson(join(rootDir, "trainer.json"), trainerSchema) as TrainerDefinition;
  if (definition.id !== id) throw new Error(`Trainer id '${definition.id}' must match directory '${id}'`);
  return { definition, rootDir };
}

async function directoryIds(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith(".")).map((entry) => entry.name).sort();
}

async function fileIds(root: string, suffix: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(suffix)).map((entry) => entry.name.slice(0, -suffix.length)).sort();
}

async function requireFile(path: string, label: string): Promise<void> {
  if (!(await Bun.file(path).exists())) throw new Error(`${label} does not exist: ${path}`);
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
    const training = await loadTraining(root, id); await compileAssembly(root, training.assembly); await loadTrainer(root, training.trainer); await loadTask(root, training.task); for (const scenario of training.scenarios) await loadScenario(root, scenario);
  }
  const benchmarkIds = await fileIds(join(root, "benchmarks"), ".benchmark.json");
  for (const id of benchmarkIds) {
    const benchmark = await loadBenchmark(root, id); await loadObjective(root, benchmark.objective); await compileAssembly(root, benchmark.baseline.assembly); await loadController(root, benchmark.baseline.controller); for (const item of benchmark.cases) { await loadTask(root, item.task); await loadScenario(root, item.scenario); }
  }
  const candidateIds = await directoryIds(join(root, "candidates"));
  for (const id of candidateIds) {
    const candidate = await loadCandidate(root, id); await loadBenchmark(root, candidate.benchmark); await compileAssembly(root, candidate.baseline.assembly); await compileAssembly(root, candidate.proposed.assembly); await loadController(root, candidate.baseline.controller); await loadController(root, candidate.proposed.controller);
    for (const path of [...candidate.allowedChanges, ...candidate.fixedInputs]) await requireFile(confined(root, path), `Candidate '${id}' input`);
  }
  await loadController(root, project.manifest.defaults.controller); await loadTask(root, project.manifest.defaults.task); await loadScenario(root, project.manifest.defaults.scenario); await loadObjective(root, project.manifest.defaults.objective); await loadBenchmark(root, project.manifest.defaults.benchmark);
  return { controllers: controllerIds.length, trainers: trainerIds.length, tasks: taskIds.length, scenarios: scenarioIds.length, objectives: objectiveIds.length, trainings: trainingIds.length, benchmarks: benchmarkIds.length, candidates: candidateIds.length };
}
