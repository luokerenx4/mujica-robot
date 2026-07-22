import { appendFile, cp, mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  atomicDirectory, compareAssemblies, compileAssembly, confined, hashDirectory, hashJson, listAssemblyIds, listComponentIds, loadAssembly, loadBenchmark, loadCandidate, loadComponent,
  loadController, loadObjective, loadProject, loadResearch, loadScenario, loadTask, loadTrainer, loadTraining, loadTrainingResearch, researchProposalSchema, sha256, stableJson, trainingSchema, validateProject, writeJson,
  type BenchmarkDefinition, type CompiledAssembly, type ControllerDefinition, type ProjectContext, type ResearchDefinition, type ResearchProposal, type TrainingDefinition, type TrainingResearchDefinition,
} from "@mujica/core";
import { validateProjectDefinitions } from "@mujica/core";
import { success, type Artifact } from "./contract";
import { dependencyLockHash, harnessDependencyLockHash, harnessSourceHash, invokeRuntime, runtimeCompiled, runtimeSourceHash, runtimeVersion } from "./runtime";

function projectArtifact(kind: Artifact["kind"], id: string, path: string, immutable: boolean): Artifact { return { kind, id, path, immutable }; }
async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

async function controllerIdentity(projectDir: string, id: string, override?: ControllerDefinition): Promise<{ definition: ControllerDefinition; rootDir: string; hash: string; trainingSteps: number }> {
  const controller = await loadController(projectDir, id);
  const definition = override ?? controller.definition;
  if (definition.id !== id || definition.kind !== controller.definition.kind) throw new Error(`Controller override must preserve id and kind for '${id}'`);
  if (definition.kind === "program") {
    const entryHash = sha256(await readFile(confined(controller.rootDir, definition.entry)));
    return { definition, rootDir: controller.rootDir, hash: hashJson({ definition, entryHash }), trainingSteps: 0 };
  }
  const policyDir = confined(resolve(projectDir), `policies/${definition.policy}`);
  if (!(await exists(join(policyDir, "manifest.json")))) throw new Error(`Frozen policy '${definition.policy}' does not exist`);
  const manifest = JSON.parse(await readFile(join(policyDir, "manifest.json"), "utf8")); const trainingSteps = Number(manifest.budget); if (!Number.isFinite(trainingSteps) || trainingSteps < 0) throw new Error(`Policy '${definition.policy}' has an invalid training budget`);
  return { definition, rootDir: controller.rootDir, hash: await hashDirectory(policyDir), trainingSteps };
}

async function baseRequest(project: ProjectContext, assembly: CompiledAssembly, controllerId: string, taskId: string, scenarioId: string, objectiveId: string, seed: number, override?: ControllerDefinition) {
  const controller = await controllerIdentity(project.rootDir, controllerId, override);
  return {
    request: {
      runtimeVersion, runtimeSourceHash: await runtimeSourceHash(), harnessSourceHash: await harnessSourceHash(), projectDir: project.rootDir, modelPath: assembly.modelPath, compiled: runtimeCompiled(assembly), controller: controller.definition, controllerRoot: controller.rootDir,
      controllerHash: controller.hash, trainingSteps: controller.trainingSteps, task: await loadTask(project.rootDir, taskId), scenario: await loadScenario(project.rootDir, scenarioId), objective: await loadObjective(project.rootDir, objectiveId), seed,
    },
    controller,
  };
}

export async function validateCommand(projectDir: string) {
  const result = await validateProject(projectDir); const definitions = await validateProjectDefinitions(projectDir); const runtimeModels = [];
  for (const assembly of result.assemblies) runtimeModels.push({ assembly: assembly.id, ...(await invokeRuntime("validate", { modelPath: assembly.modelPath, compiled: runtimeCompiled(assembly) })) });
  return success("validate", { valid: true, project: result.project.manifest, components: result.components, definitions, assemblies: result.assemblies.map((item) => ({ id: item.id, hash: item.assemblyHash, observationSize: item.observationContract.size, actionSize: item.actionContract.size })), runtimeModels }, result.project);
}

export async function inspectCommand(projectDir: string) {
  const project = await loadProject(projectDir); const components = await listComponentIds(project.rootDir); const assemblies = await listAssemblyIds(project.rootDir);
  const policies = await listManifestDirectories(join(project.rootDir, "policies")); const runs = await listManifestDirectories(join(project.rootDir, "runs")); const trainingRuns = await listManifestDirectories(join(project.rootDir, "training-runs")); const revisions = await listManifestDirectories(join(project.rootDir, "revisions")); const policyRevisions = await listManifestDirectories(join(project.rootDir, "policy-revisions"));
  return success("inspect", { project: project.manifest, counts: { components: components.length, assemblies: assemblies.length, policies: policies.length, runs: runs.length, trainingRuns: trainingRuns.length, revisions: revisions.length, policyRevisions: policyRevisions.length }, components, assemblies, policies, runs, trainingRuns, revisions, policyRevisions }, project);
}

export async function componentListCommand(projectDir: string) {
  const project = await loadProject(projectDir); const components = [];
  for (const id of await listComponentIds(project.rootDir)) { const component = await loadComponent(project.rootDir, id); components.push({ ...component.manifest, hash: component.hash }); }
  return success("component.list", { components }, project);
}

export async function componentInspectCommand(projectDir: string, id: string) {
  const project = await loadProject(projectDir); const component = await loadComponent(project.rootDir, id);
  return success("component.inspect", { ...component.manifest, hash: component.hash, rootDir: component.rootDir }, project);
}

export async function assemblyCompileCommand(projectDir: string, id: string) {
  const project = await loadProject(projectDir); const assembly = await compileAssembly(project.rootDir, id); const model = await invokeRuntime("validate", { modelPath: assembly.modelPath, compiled: runtimeCompiled(assembly) });
  return success("assembly.compile", { assembly, model }, project, [projectArtifact("compiled-assembly", assembly.assemblyHash, assembly.artifactDir, false)]);
}

export async function assemblyInspectCommand(projectDir: string, id: string) {
  const project = await loadProject(projectDir); const source = await loadAssembly(project.rootDir, id); const compiled = await compileAssembly(project.rootDir, id);
  return success("assembly.inspect", { source, compiled }, project);
}

export async function assemblyCompareCommand(projectDir: string, from: string, to: string) {
  const project = await loadProject(projectDir); return success("assembly.compare", await compareAssemblies(project.rootDir, from, to), project);
}

export async function simulateCommand(projectDir: string, options: { assembly: string; controller: string; task: string; scenario: string; objective?: string; seed: number }) {
  const project = await loadProject(projectDir); const assembly = await compileAssembly(project.rootDir, options.assembly); const objective = options.objective ?? project.manifest.defaults.objective;
  const { request } = await baseRequest(project, assembly, options.controller, options.task, options.scenario, objective, options.seed);
  const result = await invokeRuntime("simulate", request);
  return success("simulate", result, project, [projectArtifact("simulation-run", result.runId, result.artifactPath, true)]);
}

async function executeTraining(project: ProjectContext, training: TrainingDefinition, seed: number) {
  const assembly = await compileAssembly(project.rootDir, training.assembly); const trainer = await loadTrainer(project.rootDir, training.trainer);
  const trainerHash = await hashDirectory(trainer.rootDir); const sourceHash = await runtimeSourceHash(); const harnessHash = await harnessSourceHash(); const harnessDependencyHash = await harnessDependencyLockHash(); const scenarios = [];
  for (const id of training.scenarios) scenarios.push(await loadScenario(project.rootDir, id));
  return await invokeRuntime("train", {
    runtimeVersion, runtimeSourceHash: sourceHash, harnessSourceHash: harnessHash, harnessDependencyLockHash: harnessDependencyHash, projectDir: project.rootDir, modelPath: assembly.modelPath, compiled: runtimeCompiled(assembly), training, trainer: trainer.definition, trainerRoot: trainer.rootDir, trainerHash,
    task: await loadTask(project.rootDir, training.task), scenarios, seed, dependencyLockHash: await dependencyLockHash(),
    sourceHashes: { runtime: sourceHash, harness: harnessHash, harnessDependencies: harnessDependencyHash, trainer: trainerHash, assembly: assembly.assemblyHash, catalog: assembly.catalogHash, training: hashJson(training) },
  });
}

export async function trainCommand(projectDir: string, trainingId: string, seed: number) {
  const project = await loadProject(projectDir); const training = await loadTraining(project.rootDir, trainingId); const result = await executeTraining(project, training, seed);
  return success("train", result, project, [projectArtifact("training-run", result.trainingRunId, result.artifactPath, true), projectArtifact("policy", result.policyId, result.policyPath, true)], [
    { id: "inspect-policy", description: "Inspect the frozen policy and its provenance", argv: ["policy", "inspect", project.rootDir, "--policy", result.policyId], effect: "read-only" },
  ]);
}

async function listManifestDirectories(root: string): Promise<string[]> {
  if (!(await exists(root))) return [];
  const entries = await readdir(root, { withFileTypes: true }); const ids: string[] = [];
  for (const entry of entries) if (entry.isDirectory() && !entry.isSymbolicLink() && await exists(join(root, entry.name, "manifest.json"))) ids.push(entry.name);
  return ids.sort();
}

export async function policiesCommand(projectDir: string) {
  const project = await loadProject(projectDir); const policies = [];
  for (const id of await listManifestDirectories(join(project.rootDir, "policies"))) policies.push(JSON.parse(await readFile(join(project.rootDir, "policies", id, "manifest.json"), "utf8")));
  return success("policies", { policies }, project);
}

export async function policyInspectCommand(projectDir: string, id: string) {
  const project = await loadProject(projectDir); const root = confined(project.rootDir, `policies/${id}`); const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  return success("policy.inspect", { manifest, architecture: JSON.parse(await readFile(join(root, "architecture.json"), "utf8")), metrics: JSON.parse(await readFile(join(root, "training-metrics.json"), "utf8")), rootDir: root }, project);
}

function lockPayload(benchmark: BenchmarkDefinition, baselineAssemblyHash: string, baselineControllerHash: string, objective: unknown, cases: Array<{ task: unknown; scenario: unknown }>, sourceHash: string, harnessHash: string, dependencyHash: string) {
  return { version: 1, runtimeVersion, runtimeSourceHash: sourceHash, harnessSourceHash: harnessHash, evaluatorDependencyLockHash: dependencyHash, benchmarkId: benchmark.id, benchmarkHash: hashJson(benchmark), baselineAssemblyHash, baselineControllerHash, objectiveHash: hashJson(objective), cases: cases.map((item, index) => ({ id: benchmark.cases[index]?.id, taskHash: hashJson(item.task), scenarioHash: hashJson(item.scenario), seed: benchmark.cases[index]?.seed, weight: benchmark.cases[index]?.weight })) };
}

async function currentLockPayload(project: ProjectContext, benchmark: BenchmarkDefinition) {
  const assembly = await compileAssembly(project.rootDir, benchmark.baseline.assembly); const controller = await controllerIdentity(project.rootDir, benchmark.baseline.controller); const objective = await loadObjective(project.rootDir, benchmark.objective); const cases = [];
  for (const item of benchmark.cases) cases.push({ task: await loadTask(project.rootDir, item.task), scenario: await loadScenario(project.rootDir, item.scenario) });
  const [sourceHash, harnessHash, dependencyHash] = await Promise.all([runtimeSourceHash(), harnessSourceHash(), harnessDependencyLockHash()]); return lockPayload(benchmark, assembly.assemblyHash, controller.hash, objective, cases, sourceHash, harnessHash, dependencyHash);
}

export async function benchmarkLockCommand(projectDir: string, id: string) {
  const project = await loadProject(projectDir); const benchmark = await loadBenchmark(project.rootDir, id); const payload = await currentLockPayload(project, benchmark); const lock = { ...payload, lockHash: hashJson(payload) }; const path = join(project.rootDir, "benchmarks", `${id}.lock.json`); await writeJson(path, lock);
  return success("benchmark.lock", lock, project, [projectArtifact("benchmark-lock", id, path, false)]);
}

async function requireBenchmarkLock(project: ProjectContext, benchmark: BenchmarkDefinition) {
  const path = join(project.rootDir, "benchmarks", `${benchmark.id}.lock.json`); if (!(await exists(path))) throw new Error(`Benchmark '${benchmark.id}' is not locked; run 'mujica benchmark lock ...'`);
  const stored = JSON.parse(await readFile(path, "utf8")); const current = await currentLockPayload(project, benchmark); const currentHash = hashJson(current);
  if (stored.lockHash !== currentHash) throw new Error(`Benchmark '${benchmark.id}' fixed inputs drifted; review changes and lock again`);
  return stored;
}

async function evaluatePair(project: ProjectContext, benchmark: BenchmarkDefinition, assemblyId: string, controllerId: string, override?: ControllerDefinition) {
  const assembly = await compileAssembly(project.rootDir, assemblyId); const results = []; let weighted = 0; let totalWeight = 0;
  for (const item of benchmark.cases) {
    const { request } = await baseRequest(project, assembly, controllerId, item.task, item.scenario, benchmark.objective, item.seed, override); const result = await invokeRuntime("evaluate-case", request);
    results.push({ case: item, metrics: result.metrics, score: result.score, resultHash: result.resultHash }); weighted += result.score.total * item.weight; totalWeight += item.weight;
  }
  return { assembly: assemblyId, controller: controllerId, assemblyHash: assembly.assemblyHash, aggregateScore: weighted / totalWeight, cases: results };
}

export async function evaluateCommand(projectDir: string, options: { assembly: string; controller: string; benchmark: string }) {
  const project = await loadProject(projectDir); const benchmark = await loadBenchmark(project.rootDir, options.benchmark); const lock = await requireBenchmarkLock(project, benchmark); const evaluation = await evaluatePair(project, benchmark, options.assembly, options.controller);
  return success("evaluate", { benchmark: benchmark.id, lockHash: lock.lockHash, evaluation }, project);
}

export async function candidateCommand(projectDir: string, id: string, apply: boolean) {
  const project = await loadProject(projectDir); const candidate = await loadCandidate(project.rootDir, id); const benchmark = await loadBenchmark(project.rootDir, candidate.benchmark); const lock = await requireBenchmarkLock(project, benchmark);
  if (stableJson(candidate.baseline) !== stableJson(benchmark.baseline)) throw new Error("Candidate baseline must match its locked Benchmark baseline");
  const [comparison, baseline, proposed] = await Promise.all([compareAssemblies(project.rootDir, candidate.baseline.assembly, candidate.proposed.assembly), evaluatePair(project, benchmark, candidate.baseline.assembly, candidate.baseline.controller), evaluatePair(project, benchmark, candidate.proposed.assembly, candidate.proposed.controller)]);
  const objective = await loadObjective(project.rootDir, benchmark.objective); const delta = proposed.aggregateScore - baseline.aggregateScore;
  const gateReasons: string[] = [];
  for (let index = 0; index < proposed.cases.length; index++) {
    const candidateCase = proposed.cases[index]; const baselineCase = baseline.cases[index];
    if (candidateCase && candidateCase.case.gating === false) continue;
    if (candidateCase && candidateCase.metrics.survivalRate < objective.gates.minimumSurvivalRate) gateReasons.push(`${candidateCase.case.id}: survival ${candidateCase.metrics.survivalRate.toFixed(3)} below gate`);
    if (candidateCase && candidateCase.metrics.targetDistance > 0 && candidateCase.metrics.forwardProgress < objective.gates.minimumForwardProgress) gateReasons.push(`${candidateCase.case.id}: forward progress ${candidateCase.metrics.forwardProgress.toFixed(3)} below gate`);
    if (candidateCase && candidateCase.metrics.lateralDrift > objective.gates.maximumLateralDrift) gateReasons.push(`${candidateCase.case.id}: lateral drift ${candidateCase.metrics.lateralDrift.toFixed(3)} exceeds gate`);
    if (candidateCase && baselineCase && candidateCase.score.total - baselineCase.score.total < -objective.gates.maximumRegression) gateReasons.push(`${candidateCase.case.id}: score regression exceeds gate`);
  }
  const allowedChangeHashes: Record<string, string> = {};
  for (const path of candidate.allowedChanges) allowedChangeHashes[path] = sha256(await readFile(confined(project.rootDir, path)));
  const verdict = gateReasons.length === 0 && delta > 0 ? "KEEP" : "REVERT"; const candidateHash = hashJson({ candidate, allowedChangeHashes }); const result = { candidate, candidateHash, allowedChangeHashes, benchmarkLockHash: lock.lockHash, comparison, baseline, proposed, scoreDelta: delta, gateReasons, verdict };
  if (!apply) return success("candidate", result, project);
  if (verdict !== "KEEP") throw new Error(`Candidate verdict is ${verdict}; only KEEP may create a revision`);
  const revisions = await listManifestDirectories(join(project.rootDir, "revisions"));
  if (candidate.baseRevision === null && revisions.length) throw new Error("Candidate expected no base revision but revision history is no longer empty");
  if (candidate.baseRevision !== null && !revisions.includes(candidate.baseRevision)) throw new Error(`Base revision '${candidate.baseRevision}' does not exist`);
  const revisionHash = hashJson({ parent: candidate.baseRevision, candidateHash, lockHash: lock.lockHash, proposedHash: proposed.assemblyHash, evaluation: proposed.cases.map((item) => item.resultHash) }); const revisionId = `${project.manifest.id}-r-${revisionHash.slice(0, 12)}`; const target = join(project.rootDir, "revisions", revisionId);
  await atomicDirectory(target, async (directory) => {
    const sourceClosure = [...new Set([...comparison.to.sourceFiles, ...candidate.allowedChanges, ...candidate.fixedInputs])].sort();
    for (const path of sourceClosure) {
      const destination = join(directory, "sources", path); await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, await readFile(confined(project.rootDir, path)));
    }
    const compiledDirectory = join(directory, "compiled"); await mkdir(compiledDirectory, { recursive: true });
    for (const name of ["model.xml", "observation-contract.json", "action-contract.json", "compiled-assembly.json"]) await writeFile(join(compiledDirectory, name), await readFile(join(comparison.to.artifactDir, name)));
    await writeJson(join(directory, "evaluation.json"), result);
    await writeJson(join(directory, "manifest.json"), { version: 1, id: revisionId, parent: candidate.baseRevision, candidateId: candidate.id, candidateHash, benchmarkId: benchmark.id, benchmarkLockHash: lock.lockHash, assembly: candidate.proposed.assembly, assemblyHash: proposed.assemblyHash, controller: candidate.proposed.controller, aggregateScore: proposed.aggregateScore, scoreDelta: delta, exactChangedFiles: candidate.allowedChanges, sourceClosure, appliedAt: new Date().toISOString() });
  });
  return success("candidate.apply", { ...result, revisionId, revisionPath: target }, project, [projectArtifact("revision", revisionId, target, true)]);
}

type EvaluationResult = Awaited<ReturnType<typeof evaluatePair>>;

function researchValue(definition: ControllerDefinition, path: string): number {
  if (definition.kind !== "program") throw new Error("Research requires a program Controller");
  const key = path.slice("/config/".length); const value = definition.config[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Research path '${path}' does not name a finite numeric config value`);
  return value;
}

function applyResearchValues(definition: ControllerDefinition, values: Record<string, number>): ControllerDefinition {
  if (definition.kind !== "program") throw new Error("Research requires a program Controller");
  const next = structuredClone(definition); const config = next.config;
  for (const [path, value] of Object.entries(values)) config[path.slice("/config/".length)] = value;
  return next;
}

export function validateResearchProposal(research: ResearchDefinition, definition: ControllerDefinition, input: unknown): ResearchProposal {
  const proposal = researchProposalSchema.parse(input); const parameters = new Map<string, ResearchDefinition["editable"]["parameters"][number]>(research.editable.parameters.map((parameter) => [parameter.path, parameter]));
  for (const [path, value] of Object.entries(proposal.values)) {
    const parameter = parameters.get(path); if (!parameter) throw new Error(`Proposal path '${path}' is not editable`);
    if (value < parameter.minimum || value > parameter.maximum) throw new Error(`Proposal '${path}'=${value} is outside [${parameter.minimum}, ${parameter.maximum}]`);
    if (value === researchValue(definition, path)) throw new Error(`Proposal '${path}' does not change its current value`);
  }
  return proposal;
}

function builtinResearchProposal(research: ResearchDefinition, definition: ControllerDefinition, seenCandidateHashes: Set<string>): ResearchProposal | null {
  for (const parameter of research.editable.parameters) {
    const current = researchValue(definition, parameter.path);
    for (const direction of parameter.directionOrder) {
      const sign = direction === "increase" ? 1 : -1; const raw = current + sign * parameter.step;
      const value = Math.min(parameter.maximum, Math.max(parameter.minimum, Number(raw.toFixed(12))));
      if (value === current) continue;
      const key = parameter.path.slice("/config/".length); const strategyKey = key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
      const proposal: ResearchProposal = { strategy: `coordinate-${strategyKey}-${direction}`, hypothesis: `${direction === "increase" ? "Increase" : "Decrease"} ${key} by one bounded step.`, expectedEffect: `Test whether ${key}=${value} improves the complete locked quadruped score.`, values: { [parameter.path]: value } };
      const candidate = applyResearchValues(definition, proposal.values); if (!seenCandidateHashes.has(hashJson(candidate))) return proposal;
    }
  }
  return null;
}

function externalResearchProposal(command: string, input: unknown): unknown {
  const child = Bun.spawnSync(["/bin/sh", "-lc", command], { stdin: Buffer.from(JSON.stringify(input)), stdout: "pipe", stderr: "pipe" });
  if (child.exitCode !== 0) throw new Error(`Research agent command failed with exit ${child.exitCode}: ${child.stderr.toString().trim()}`);
  const stdout = child.stdout.toString().trim();
  try { return JSON.parse(stdout); } catch { throw new Error(`Research agent command returned invalid JSON: ${stdout.slice(0, 500)}`); }
}

function researchGateReasons(objective: Awaited<ReturnType<typeof loadObjective>>, baseline: EvaluationResult, candidate: EvaluationResult): string[] {
  const reasons: string[] = [];
  for (let index = 0; index < candidate.cases.length; index++) {
    const candidateCase = candidate.cases[index]; const baselineCase = baseline.cases[index];
    if (candidateCase && candidateCase.case.gating === false) continue;
    // A research loop may start from an infeasible baseline. Permit a monotonic move
    // toward an unmet gate so several small, reviewable changes can cross it.
    if (candidateCase && candidateCase.metrics.survivalRate < objective.gates.minimumSurvivalRate && (!baselineCase || candidateCase.metrics.survivalRate <= baselineCase.metrics.survivalRate)) reasons.push(`${candidateCase.case.id}: survival ${candidateCase.metrics.survivalRate.toFixed(3)} below gate without improving the locked baseline`);
    if (candidateCase && candidateCase.metrics.targetDistance > 0 && candidateCase.metrics.forwardProgress < objective.gates.minimumForwardProgress && (!baselineCase || candidateCase.metrics.forwardProgress <= baselineCase.metrics.forwardProgress)) reasons.push(`${candidateCase.case.id}: forward progress ${candidateCase.metrics.forwardProgress.toFixed(3)} below gate without improving the locked baseline`);
    if (candidateCase && candidateCase.metrics.lateralDrift > objective.gates.maximumLateralDrift && (!baselineCase || candidateCase.metrics.lateralDrift >= baselineCase.metrics.lateralDrift)) reasons.push(`${candidateCase.case.id}: lateral drift ${candidateCase.metrics.lateralDrift.toFixed(3)} exceeds gate without improving the locked baseline`);
    if (candidateCase && baselineCase && candidateCase.score.total - baselineCase.score.total < -objective.gates.maximumRegression) reasons.push(`${candidateCase.case.id}: score regression exceeds locked baseline gate`);
  }
  return reasons;
}

async function atomicWriteJsonFile(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.partial-${process.pid}-${Date.now()}`; await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`); await rename(temporary, path);
}

async function latestRevision(projectDir: string): Promise<string | null> {
  const revisions = [];
  for (const id of await listManifestDirectories(join(projectDir, "revisions"))) revisions.push(JSON.parse(await readFile(join(projectDir, "revisions", id, "manifest.json"), "utf8")));
  revisions.sort((a, b) => String(a.appliedAt).localeCompare(String(b.appliedAt)) || String(a.id).localeCompare(String(b.id)));
  return revisions.length ? String(revisions[revisions.length - 1].id) : null;
}

async function publishResearchRevision(options: {
  project: ProjectContext; research: ResearchDefinition; benchmark: BenchmarkDefinition; lockHash: string; assembly: CompiledAssembly; proposal: ResearchProposal;
  experimentId: string; experimentHash: string; previous: EvaluationResult; candidate: EvaluationResult; scoreDelta: number; controller: ControllerDefinition;
}): Promise<{ id: string; path: string }> {
  const parent = await latestRevision(options.project.rootDir);
  const revisionHash = hashJson({ parent, research: options.research.id, experimentHash: options.experimentHash, assemblyHash: options.assembly.assemblyHash, controller: options.controller, results: options.candidate.cases.map((item) => item.resultHash) });
  const id = `${options.project.manifest.id}-r-${revisionHash.slice(0, 12)}`; const target = join(options.project.rootDir, "revisions", id);
  if (await exists(target)) throw new Error(`Research Revision already exists: ${id}`);
  const controllerRoot = `controllers/${options.research.controller}`;
  const sourceClosure = [...new Set([
    ...options.assembly.sourceFiles, options.research.editable.path, `${controllerRoot}/${options.controller.kind === "program" ? options.controller.entry : "controller.json"}`,
    `research/${options.research.id}.research.json`, options.research.program, `benchmarks/${options.benchmark.id}.benchmark.json`, `benchmarks/${options.benchmark.id}.lock.json`,
    `objectives/${options.benchmark.objective}.objective.json`, ...options.benchmark.cases.flatMap((item) => [`tasks/${item.task}.task.json`, `scenarios/${item.scenario}.scenario.json`]),
  ])].sort();
  await atomicDirectory(target, async (directory) => {
    for (const path of sourceClosure) {
      const destination = join(directory, "sources", path); await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, await readFile(confined(options.project.rootDir, path)));
    }
    const compiledDirectory = join(directory, "compiled"); await mkdir(compiledDirectory, { recursive: true });
    for (const name of ["model.xml", "observation-contract.json", "action-contract.json", "compiled-assembly.json"]) await writeFile(join(compiledDirectory, name), await readFile(join(options.assembly.artifactDir, name)));
    await writeJson(join(directory, "evaluation.json"), { proposal: options.proposal, previous: options.previous, candidate: options.candidate, scoreDelta: options.scoreDelta });
    await writeJson(join(directory, "manifest.json"), { version: 1, id, kind: "research-optimization", parent, researchId: options.research.id, experimentId: options.experimentId, experimentHash: options.experimentHash, benchmarkId: options.benchmark.id, benchmarkLockHash: options.lockHash, assembly: options.research.assembly, assemblyHash: options.assembly.assemblyHash, controller: options.research.controller, controllerHash: hashJson(options.controller), aggregateScore: options.candidate.aggregateScore, scoreDelta: options.scoreDelta, sourceClosure, appliedAt: new Date().toISOString() });
  });
  return { id, path: target };
}

export async function researchCommand(projectDir: string, researchId: string, requestedIterations: number, agentCommand?: string) {
  const project = await loadProject(projectDir); const research = await loadResearch(project.rootDir, researchId); const benchmark = await loadBenchmark(project.rootDir, research.benchmark); const lock = await requireBenchmarkLock(project, benchmark);
  const assembly = await compileAssembly(project.rootDir, research.assembly); const objective = await loadObjective(project.rootDir, benchmark.objective); const controllerPath = confined(project.rootDir, research.editable.path);
  const loaded = await loadController(project.rootDir, research.controller); if (loaded.definition.kind !== "program") throw new Error("Research requires a program Controller");
  if (research.editable.path !== `controllers/${research.controller}/controller.json`) throw new Error("Research editable path does not match selected Controller manifest");
  if (!Number.isInteger(requestedIterations) || requestedIterations <= 0) throw new Error("--iterations must be a positive integer");
  const iterations = Math.min(requestedIterations, research.maxIterations); const program = await readFile(confined(project.rootDir, research.program), "utf8"); const programHash = sha256(program); const researchHash = hashJson(research);
  const researchRoot = join(project.rootDir, "research-runs", research.id); await mkdir(researchRoot, { recursive: true });
  const history = [];
  for (const id of await listManifestDirectories(researchRoot)) history.push(JSON.parse(await readFile(join(researchRoot, id, "manifest.json"), "utf8")));
  history.sort((a, b) => Number(a.sequence) - Number(b.sequence)); const seen = new Set<string>(history.flatMap((item) => item.researchHash === researchHash && item.programHash === programHash && item.benchmarkLockHash === lock.lockHash && typeof item.candidateControllerHash === "string" ? [item.candidateControllerHash] : []));
  let sequence = history.reduce((maximum, item) => Math.max(maximum, Number(item.sequence) || 0), 0) + 1; let definition: ControllerDefinition = loaded.definition;
  const lockedBaseline = await evaluatePair(project, benchmark, benchmark.baseline.assembly, benchmark.baseline.controller); let current = await evaluatePair(project, benchmark, research.assembly, research.controller);
  const initialScore = current.aggregateScore; const experiments: any[] = []; const artifacts: Artifact[] = []; let exhausted = false;
  const ledgerPath = join(researchRoot, "results.tsv"); if (!(await exists(ledgerPath))) await writeFile(ledgerPath, "sequence\texperiment\tscore\tdelta\tstatus\tstrategy\tdescription\n");

  for (let iteration = 0; iteration < iterations; iteration++) {
    const beforeDefinition = definition; const previousEvaluation = current; let proposalInput: unknown;
    try {
      proposalInput = agentCommand ? externalResearchProposal(agentCommand, { version: 1, program, research, lockHash: lock.lockHash, currentController: beforeDefinition, currentControllerHash: hashJson(beforeDefinition), currentBest: previousEvaluation, parameters: research.editable.parameters, history: history.map((item) => ({ sequence: item.sequence, score: item.score, delta: item.delta, verdict: item.verdict, strategy: item.strategy, proposal: item.proposal })) }) : builtinResearchProposal(research, beforeDefinition, seen);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error); const beforeControllerHash = hashJson(beforeDefinition);
      const experimentHash = hashJson({ researchHash, programHash, lockHash: lock.lockHash, beforeControllerHash, proposalInput: null, verdict: "CRASH", errorMessage }); const experimentId = `${String(sequence).padStart(3, "0")}-${experimentHash.slice(0, 12)}`; const artifactPath = join(researchRoot, experimentId);
      await atomicDirectory(artifactPath, async (directory) => {
        await writeJson(join(directory, "proposal-input.json"), null); await writeJson(join(directory, "before-controller.json"), beforeDefinition); await writeFile(join(directory, "error.txt"), `${errorMessage}\n`);
        await writeFile(join(directory, "report.md"), `# Research experiment ${experimentId}\n\n- Strategy: \`proposal-error\`\n- Verdict: **CRASH**\n- Score: \`${previousEvaluation.aggregateScore}\`\n- Delta: \`0\`\n`);
        await writeJson(join(directory, "manifest.json"), { version: 1, id: experimentId, sequence, researchId: research.id, researchHash, programHash, benchmarkLockHash: lock.lockHash, beforeControllerHash, candidateControllerHash: null, proposal: null, strategy: "proposal-error", score: previousEvaluation.aggregateScore, delta: 0, verdict: "CRASH", gateReasons: [], error: errorMessage, revisionId: null, completed: true });
      });
      await appendFile(ledgerPath, `${sequence}\t${experimentId}\t${previousEvaluation.aggregateScore}\t0\tcrash\tproposal-error\t${errorMessage.replace(/[\t\r\n]+/g, " ")}\n`);
      const summary = { sequence, experimentId, proposal: null, candidateControllerHash: null, score: previousEvaluation.aggregateScore, delta: 0, verdict: "CRASH" as const, gateReasons: [], error: errorMessage, revisionId: null, artifactPath };
      experiments.push(summary); history.push(summary); artifacts.push(projectArtifact("research-experiment", experimentId, artifactPath, true)); sequence++; continue;
    }
    if (proposalInput === null) { exhausted = true; break; }
    let proposal: ResearchProposal | undefined; let candidateDefinition: ControllerDefinition | undefined; let candidateControllerHash: string | undefined;
    try {
      proposal = validateResearchProposal(research, beforeDefinition, proposalInput); candidateDefinition = applyResearchValues(beforeDefinition, proposal.values); candidateControllerHash = hashJson(candidateDefinition);
      if (seen.has(candidateControllerHash)) throw new Error(`Research proposal repeats candidate Controller ${candidateControllerHash.slice(0, 12)}`);
    }
    catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error); const beforeControllerHash = hashJson(beforeDefinition);
      const experimentHash = hashJson({ researchHash, programHash, lockHash: lock.lockHash, beforeControllerHash, proposalInput, verdict: "CRASH", errorMessage }); const experimentId = `${String(sequence).padStart(3, "0")}-${experimentHash.slice(0, 12)}`; const artifactPath = join(researchRoot, experimentId);
      await atomicDirectory(artifactPath, async (directory) => {
        await writeJson(join(directory, "proposal-input.json"), proposalInput); await writeJson(join(directory, "before-controller.json"), beforeDefinition); await writeFile(join(directory, "error.txt"), `${errorMessage}\n`);
        await writeFile(join(directory, "report.md"), `# Research experiment ${experimentId}\n\n- Strategy: \`proposal-invalid\`\n- Verdict: **CRASH**\n- Score: \`${previousEvaluation.aggregateScore}\`\n- Delta: \`0\`\n`);
        await writeJson(join(directory, "manifest.json"), { version: 1, id: experimentId, sequence, researchId: research.id, researchHash, programHash, benchmarkLockHash: lock.lockHash, beforeControllerHash, candidateControllerHash: candidateControllerHash ?? null, proposal: proposal ?? null, strategy: proposal?.strategy ?? "proposal-invalid", score: previousEvaluation.aggregateScore, delta: 0, verdict: "CRASH", gateReasons: [], error: errorMessage, revisionId: null, completed: true });
      });
      await appendFile(ledgerPath, `${sequence}\t${experimentId}\t${previousEvaluation.aggregateScore}\t0\tcrash\tproposal-invalid\t${errorMessage.replace(/[\t\r\n]+/g, " ")}\n`);
      const summary = { sequence, experimentId, proposal: proposal ?? null, candidateControllerHash: candidateControllerHash ?? null, score: previousEvaluation.aggregateScore, delta: 0, verdict: "CRASH" as const, gateReasons: [], error: errorMessage, revisionId: null, artifactPath };
      experiments.push(summary); history.push(summary); artifacts.push(projectArtifact("research-experiment", experimentId, artifactPath, true)); sequence++; continue;
    }
    if (!proposal || !candidateDefinition || !candidateControllerHash) throw new Error("Research proposal validation did not produce a candidate");
    seen.add(candidateControllerHash);
    const beforeControllerHash = hashJson(beforeDefinition); const beforeFileHash = sha256(await readFile(controllerPath)); let candidate: EvaluationResult | undefined; let errorMessage: string | undefined; let gateReasons: string[] = []; let delta = 0; let verdict: "KEEP" | "REVERT" | "CRASH" = "CRASH";
    try {
      candidate = await evaluatePair(project, benchmark, research.assembly, research.controller, candidateDefinition); delta = candidate.aggregateScore - previousEvaluation.aggregateScore; gateReasons = researchGateReasons(objective, lockedBaseline, candidate);
      verdict = gateReasons.length === 0 && delta >= research.minimumImprovement ? "KEEP" : "REVERT";
    } catch (error) { errorMessage = error instanceof Error ? error.message : String(error); }
    const experimentHash = hashJson({ researchHash, programHash, lockHash: lock.lockHash, beforeControllerHash, proposal, candidateControllerHash, verdict, results: candidate?.cases.map((item) => item.resultHash), errorMessage });
    const experimentId = `${String(sequence).padStart(3, "0")}-${experimentHash.slice(0, 12)}`; let revision: { id: string; path: string } | undefined;
    if (verdict === "KEEP" && candidate) {
      if (sha256(await readFile(controllerPath)) !== beforeFileHash) throw new Error("Research Controller changed during evaluation; refusing stale KEEP");
      const original = beforeDefinition;
      await atomicWriteJsonFile(controllerPath, candidateDefinition);
      try { revision = await publishResearchRevision({ project, research, benchmark, lockHash: lock.lockHash, assembly, proposal, experimentId, experimentHash, previous: previousEvaluation, candidate, scoreDelta: delta, controller: candidateDefinition }); }
      catch (error) { await atomicWriteJsonFile(controllerPath, original); throw error; }
      definition = candidateDefinition; current = candidate;
    }
    const artifactPath = join(researchRoot, experimentId);
    await atomicDirectory(artifactPath, async (directory) => {
      await writeJson(join(directory, "proposal.json"), proposal); await writeJson(join(directory, "before-controller.json"), beforeDefinition); await writeJson(join(directory, "candidate-controller.json"), candidateDefinition);
      if (candidate) await writeJson(join(directory, "evaluation.json"), { previous: previousEvaluation, candidate, delta, gateReasons });
      if (errorMessage) await writeFile(join(directory, "error.txt"), `${errorMessage}\n`);
      await writeFile(join(directory, "report.md"), `# Research experiment ${experimentId}\n\n- Strategy: \`${proposal.strategy}\`\n- Verdict: **${verdict}**\n- Score: \`${candidate?.aggregateScore ?? 0}\`\n- Delta: \`${delta}\`\n${revision ? `- Revision: \`${revision.id}\`\n` : ""}`);
      await writeJson(join(directory, "manifest.json"), { version: 1, id: experimentId, sequence, researchId: research.id, researchHash, programHash, benchmarkLockHash: lock.lockHash, beforeControllerHash, candidateControllerHash, proposal, strategy: proposal.strategy, score: candidate?.aggregateScore ?? 0, delta, verdict, gateReasons, error: errorMessage ?? null, revisionId: revision?.id ?? null, completed: true });
    });
    const description = proposal.hypothesis.replace(/[\t\r\n]+/g, " "); await appendFile(ledgerPath, `${sequence}\t${experimentId}\t${candidate?.aggregateScore ?? 0}\t${delta}\t${verdict.toLowerCase()}\t${proposal.strategy}\t${description}\n`);
    const summary = { sequence, experimentId, proposal, candidateControllerHash, score: candidate?.aggregateScore ?? 0, delta, verdict, gateReasons, error: errorMessage ?? null, revisionId: revision?.id ?? null, artifactPath };
    experiments.push(summary); history.push({ ...summary, candidateControllerHash }); artifacts.push(projectArtifact("research-experiment", experimentId, artifactPath, true)); if (revision) artifacts.push(projectArtifact("revision", revision.id, revision.path, true)); sequence++;
  }
  return success("research", { research: research.id, programHash, benchmark: benchmark.id, lockHash: lock.lockHash, initialScore, finalScore: current.aggregateScore, scoreDelta: current.aggregateScore - initialScore, iterationsRequested: requestedIterations, iterationsCompleted: experiments.length, exhausted, experiments, controller: definition, revisionHead: await latestRevision(project.rootDir), ledgerPath }, project, artifacts);
}

function trainingValue(training: TrainingDefinition, path: string): number {
  const value = (training as unknown as Record<string, unknown>)[path.slice(1)];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Training Research path '${path}' is not numeric`);
  return value;
}

function applyTrainingValues(training: TrainingDefinition, values: Record<string, number>): TrainingDefinition {
  const next = structuredClone(training) as unknown as Record<string, unknown>;
  for (const [path, value] of Object.entries(values)) next[path.slice(1)] = value;
  return trainingSchema.parse(next) as TrainingDefinition;
}

export function validateTrainingProposal(research: TrainingResearchDefinition, training: TrainingDefinition, input: unknown): ResearchProposal {
  const proposal = researchProposalSchema.parse(input); const parameters = new Map<string, TrainingResearchDefinition["editable"]["parameters"][number]>(research.editable.parameters.map((parameter) => [parameter.path, parameter]));
  for (const [path, value] of Object.entries(proposal.values)) {
    const parameter = parameters.get(path); if (!parameter) throw new Error(`Proposal path '${path}' is not editable`);
    if (value < parameter.minimum || value > parameter.maximum) throw new Error(`Proposal '${path}'=${value} is outside [${parameter.minimum}, ${parameter.maximum}]`);
    if (parameter.integer && !Number.isInteger(value)) throw new Error(`Proposal '${path}' must be an integer`);
    if (value === trainingValue(training, path)) throw new Error(`Proposal '${path}' does not change its current value`);
  }
  return proposal;
}

function builtinTrainingProposal(research: TrainingResearchDefinition, training: TrainingDefinition, seen: Set<string>): ResearchProposal | null {
  for (const parameter of research.editable.parameters) {
    const current = trainingValue(training, parameter.path);
    for (const direction of parameter.directionOrder) {
      const raw = current + (direction === "increase" ? parameter.step : -parameter.step); let value = Math.min(parameter.maximum, Math.max(parameter.minimum, Number(raw.toPrecision(12))));
      if (parameter.integer) value = Math.round(value); if (value === current) continue;
      const key = parameter.path.slice(1); const strategyKey = key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
      const proposal: ResearchProposal = { strategy: `training-${strategyKey}-${direction}`, hypothesis: `${direction === "increase" ? "Increase" : "Decrease"} ${key} by one bounded step.`, expectedEffect: `Test whether ${key}=${value} improves deterministic frozen-policy evaluation.`, values: { [parameter.path]: value } };
      if (!seen.has(hashJson(applyTrainingValues(training, proposal.values)))) return proposal;
    }
  }
  return null;
}

async function latestPolicyRevision(projectDir: string, researchId: string): Promise<string | null> {
  const manifests = [];
  for (const id of await listManifestDirectories(join(projectDir, "policy-revisions"))) {
    const manifest = JSON.parse(await readFile(join(projectDir, "policy-revisions", id, "manifest.json"), "utf8")); if (manifest.researchId === researchId) manifests.push(manifest);
  }
  manifests.sort((a, b) => String(a.appliedAt).localeCompare(String(b.appliedAt)) || String(a.id).localeCompare(String(b.id)));
  return manifests.length ? String(manifests[manifests.length - 1].id) : null;
}

async function publishPolicyRevision(options: {
  project: ProjectContext; research: TrainingResearchDefinition; benchmark: BenchmarkDefinition; lockHash: string; assembly: CompiledAssembly; training: TrainingDefinition;
  controller: ControllerDefinition; proposal: ResearchProposal; experimentId: string; experimentHash: string; previous: EvaluationResult; candidate: EvaluationResult; scoreDelta: number; policyId: string;
}): Promise<{ id: string; path: string }> {
  const parent = await latestPolicyRevision(options.project.rootDir, options.research.id); const policyPath = confined(options.project.rootDir, `policies/${options.policyId}`); const policyHash = await hashDirectory(policyPath);
  const revisionHash = hashJson({ parent, research: options.research.id, experimentHash: options.experimentHash, training: options.training, policyHash, results: options.candidate.cases.map((item) => item.resultHash) });
  const id = `${options.project.manifest.id}-p-${revisionHash.slice(0, 12)}`; const target = join(options.project.rootDir, "policy-revisions", id); if (await exists(target)) throw new Error(`Policy Revision already exists: ${id}`);
  const trainer = await loadTrainer(options.project.rootDir, options.training.trainer);
  const sourceClosure = [...new Set([
    ...options.assembly.sourceFiles, options.research.editable.path, `controllers/${options.research.controller}/controller.json`, `trainers/${options.training.trainer}/trainer.json`,
    `trainers/${options.training.trainer}/${trainer.definition.entry}`, `trainers/${options.training.trainer}/${trainer.definition.model}`, `training-research/${options.research.id}.training-research.json`, options.research.program,
    `benchmarks/${options.benchmark.id}.benchmark.json`, `benchmarks/${options.benchmark.id}.lock.json`, `objectives/${options.benchmark.objective}.objective.json`,
    ...options.benchmark.cases.flatMap((item) => [`tasks/${item.task}.task.json`, `scenarios/${item.scenario}.scenario.json`]),
  ])].sort();
  await atomicDirectory(target, async (directory) => {
    for (const path of sourceClosure) { const destination = join(directory, "sources", path); await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, await readFile(confined(options.project.rootDir, path))); }
    await cp(policyPath, join(directory, "policy"), { recursive: true });
    const compiledDirectory = join(directory, "compiled"); await mkdir(compiledDirectory, { recursive: true });
    for (const name of ["model.xml", "observation-contract.json", "action-contract.json", "compiled-assembly.json"]) await writeFile(join(compiledDirectory, name), await readFile(join(options.assembly.artifactDir, name)));
    await writeJson(join(directory, "evaluation.json"), { proposal: options.proposal, previous: options.previous, candidate: options.candidate, scoreDelta: options.scoreDelta });
    await writeJson(join(directory, "manifest.json"), { version: 1, id, kind: "policy-optimization", parent, researchId: options.research.id, experimentId: options.experimentId, experimentHash: options.experimentHash, benchmarkId: options.benchmark.id, benchmarkLockHash: options.lockHash, assembly: options.training.assembly, assemblyHash: options.assembly.assemblyHash, controller: options.research.controller, policyId: options.policyId, policyHash, trainingHash: hashJson(options.training), aggregateScore: options.candidate.aggregateScore, scoreDelta: options.scoreDelta, sourceClosure, appliedAt: new Date().toISOString() });
  });
  return { id, path: target };
}

export async function trainingResearchCommand(projectDir: string, researchId: string, requestedIterations: number, agentCommand?: string) {
  const project = await loadProject(projectDir); const research = await loadTrainingResearch(project.rootDir, researchId); const benchmark = await loadBenchmark(project.rootDir, research.benchmark); const lock = await requireBenchmarkLock(project, benchmark);
  let training = await loadTraining(project.rootDir, research.training); const assembly = await compileAssembly(project.rootDir, training.assembly); const objective = await loadObjective(project.rootDir, benchmark.objective); const loadedController = await loadController(project.rootDir, research.controller);
  if (loadedController.definition.kind !== "policy") throw new Error("Training Research requires a policy Controller"); let controller: ControllerDefinition = loadedController.definition;
  if (!Number.isInteger(requestedIterations) || requestedIterations <= 0) throw new Error("--iterations must be a positive integer"); const iterations = Math.min(requestedIterations, research.maxIterations);
  const trainingPath = confined(project.rootDir, research.editable.path); const controllerPath = join(loadedController.rootDir, "controller.json"); const program = await readFile(confined(project.rootDir, research.program), "utf8"); const programHash = sha256(program); const researchHash = hashJson(research); const trainer = await loadTrainer(project.rootDir, training.trainer); const trainerHash = await hashDirectory(trainer.rootDir); const dependencyHash = await harnessDependencyLockHash();
  const root = join(project.rootDir, "training-research-runs", research.id); await mkdir(root, { recursive: true }); const history = [];
  for (const id of await listManifestDirectories(root)) history.push(JSON.parse(await readFile(join(root, id, "manifest.json"), "utf8"))); history.sort((a, b) => Number(a.sequence) - Number(b.sequence));
  const seen = new Set<string>(history.flatMap((item) => item.researchHash === researchHash && item.programHash === programHash && item.benchmarkLockHash === lock.lockHash && item.trainerHash === trainerHash && item.dependencyLockHash === dependencyHash && typeof item.candidateTrainingHash === "string" ? [item.candidateTrainingHash] : [])); let sequence = history.reduce((maximum, item) => Math.max(maximum, Number(item.sequence) || 0), 0) + 1;
  const lockedBaseline = await evaluatePair(project, benchmark, benchmark.baseline.assembly, benchmark.baseline.controller); let current = await evaluatePair(project, benchmark, training.assembly, research.controller); const initialScore = current.aggregateScore;
  const ledgerPath = join(root, "results.tsv"); if (!(await exists(ledgerPath))) await writeFile(ledgerPath, "sequence\texperiment\tpolicy\tscore\tdelta\tstatus\tstrategy\tdescription\n");
  const experiments: any[] = []; const artifacts: Artifact[] = []; let exhausted = false;
  for (let iteration = 0; iteration < iterations; iteration++) {
    const beforeTraining = training; const beforeController = controller; const previous = current; const beforeTrainingFileHash = sha256(await readFile(trainingPath)); const beforeControllerFileHash = sha256(await readFile(controllerPath)); let proposalInput: unknown; let proposal: ResearchProposal | undefined; let candidateTraining: TrainingDefinition | undefined; let candidateTrainingHash: string | undefined;
    try {
      proposalInput = agentCommand ? externalResearchProposal(agentCommand, { version: 1, program, research, lockHash: lock.lockHash, currentTraining: beforeTraining, currentTrainingHash: hashJson(beforeTraining), currentController: beforeController, currentBest: previous, history: history.map((item) => ({ sequence: item.sequence, score: item.score, delta: item.delta, verdict: item.verdict, strategy: item.strategy, proposal: item.proposal })) }) : builtinTrainingProposal(research, beforeTraining, seen);
      if (proposalInput === null) { exhausted = true; break; }
      proposal = validateTrainingProposal(research, beforeTraining, proposalInput); candidateTraining = applyTrainingValues(beforeTraining, proposal.values); candidateTrainingHash = hashJson(candidateTraining);
      if (seen.has(candidateTrainingHash)) throw new Error(`Training Research repeats candidate ${candidateTrainingHash.slice(0, 12)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error); const experimentHash = hashJson({ researchHash, programHash, lockHash: lock.lockHash, beforeTraining: hashJson(beforeTraining), proposalInput: proposalInput ?? null, verdict: "CRASH", message }); const experimentId = `${String(sequence).padStart(3, "0")}-${experimentHash.slice(0, 12)}`; const artifactPath = join(root, experimentId);
      await atomicDirectory(artifactPath, async (directory) => { await writeJson(join(directory, "proposal-input.json"), proposalInput ?? null); await writeJson(join(directory, "before-training.json"), beforeTraining); await writeFile(join(directory, "error.txt"), `${message}\n`); await writeJson(join(directory, "manifest.json"), { version: 1, id: experimentId, sequence, researchId: research.id, researchHash, programHash, benchmarkLockHash: lock.lockHash, trainerHash, dependencyLockHash: dependencyHash, candidateTrainingHash: candidateTrainingHash ?? null, proposal: proposal ?? null, strategy: proposal?.strategy ?? "proposal-invalid", policyId: null, score: previous.aggregateScore, delta: 0, verdict: "CRASH", error: message, policyRevisionId: null, completed: true }); });
      const strategy = proposal?.strategy ?? "proposal-invalid"; await appendFile(ledgerPath, `${sequence}\t${experimentId}\t-\t${previous.aggregateScore}\t0\tcrash\t${strategy}\t${message.replace(/[\t\r\n]+/g, " ")}\n`);
      const summary = { sequence, experimentId, proposal: proposal ?? null, candidateTrainingHash: candidateTrainingHash ?? null, policyId: null, score: previous.aggregateScore, delta: 0, verdict: "CRASH", error: message, policyRevisionId: null, artifactPath }; experiments.push(summary); history.push(summary); artifacts.push(projectArtifact("training-research-experiment", experimentId, artifactPath, true)); sequence++; continue;
    }
    if (!proposal || !candidateTraining || !candidateTrainingHash) throw new Error("Training proposal did not produce a candidate"); seen.add(candidateTrainingHash);
    let trainingResult: any; let candidate: EvaluationResult | undefined; let candidateController: ControllerDefinition | undefined; let errorMessage: string | undefined; let gateReasons: string[] = []; let delta = 0; let verdict: "KEEP" | "REVERT" | "CRASH" = "CRASH";
    try {
      trainingResult = await executeTraining(project, candidateTraining, research.seed); candidateController = { ...beforeController, policy: trainingResult.policyId } as ControllerDefinition;
      candidate = await evaluatePair(project, benchmark, candidateTraining.assembly, research.controller, candidateController); delta = candidate.aggregateScore - previous.aggregateScore; gateReasons = researchGateReasons(objective, lockedBaseline, candidate); verdict = gateReasons.length === 0 && delta >= research.minimumImprovement ? "KEEP" : "REVERT";
    } catch (error) { errorMessage = error instanceof Error ? error.message : String(error); }
    const experimentHash = hashJson({ researchHash, programHash, lockHash: lock.lockHash, beforeTraining: hashJson(beforeTraining), proposal, candidateTrainingHash, policyId: trainingResult?.policyId, verdict, results: candidate?.cases.map((item) => item.resultHash), errorMessage }); const experimentId = `${String(sequence).padStart(3, "0")}-${experimentHash.slice(0, 12)}`; let revision: { id: string; path: string } | undefined;
    if (verdict === "KEEP" && candidate && candidateController && trainingResult) {
      if (sha256(await readFile(trainingPath)) !== beforeTrainingFileHash || sha256(await readFile(controllerPath)) !== beforeControllerFileHash) throw new Error("Training Research inputs changed during evaluation; refusing stale KEEP");
      await atomicWriteJsonFile(trainingPath, candidateTraining); await atomicWriteJsonFile(controllerPath, candidateController);
      try {
        if (sha256(await readFile(trainingPath)) === beforeTrainingFileHash || sha256(await readFile(controllerPath)) === beforeControllerFileHash) throw new Error("Training Research KEEP did not change both promoted files");
        revision = await publishPolicyRevision({ project, research, benchmark, lockHash: lock.lockHash, assembly, training: candidateTraining, controller: candidateController, proposal, experimentId, experimentHash, previous, candidate, scoreDelta: delta, policyId: trainingResult.policyId });
      } catch (error) { await atomicWriteJsonFile(trainingPath, beforeTraining); await atomicWriteJsonFile(controllerPath, beforeController); throw error; }
      training = candidateTraining; controller = candidateController; current = candidate;
    }
    const artifactPath = join(root, experimentId); await atomicDirectory(artifactPath, async (directory) => {
      await writeJson(join(directory, "proposal.json"), proposal); await writeJson(join(directory, "before-training.json"), beforeTraining); await writeJson(join(directory, "candidate-training.json"), candidateTraining); if (trainingResult) await writeJson(join(directory, "training-result.json"), trainingResult);
      if (candidate) await writeJson(join(directory, "evaluation.json"), { previous, candidate, delta, gateReasons }); if (errorMessage) await writeFile(join(directory, "error.txt"), `${errorMessage}\n`);
      await writeJson(join(directory, "manifest.json"), { version: 1, id: experimentId, sequence, researchId: research.id, researchHash, programHash, benchmarkLockHash: lock.lockHash, trainerHash, dependencyLockHash: dependencyHash, candidateTrainingHash, proposal, strategy: proposal.strategy, policyId: trainingResult?.policyId ?? null, score: candidate?.aggregateScore ?? previous.aggregateScore, delta, verdict, gateReasons, error: errorMessage ?? null, policyRevisionId: revision?.id ?? null, completed: true });
    });
    const description = proposal.hypothesis.replace(/[\t\r\n]+/g, " "); await appendFile(ledgerPath, `${sequence}\t${experimentId}\t${trainingResult?.policyId ?? "-"}\t${candidate?.aggregateScore ?? previous.aggregateScore}\t${delta}\t${verdict.toLowerCase()}\t${proposal.strategy}\t${description}\n`);
    const summary = { sequence, experimentId, proposal, candidateTrainingHash, policyId: trainingResult?.policyId ?? null, score: candidate?.aggregateScore ?? previous.aggregateScore, delta, verdict, gateReasons, error: errorMessage ?? null, policyRevisionId: revision?.id ?? null, artifactPath }; experiments.push(summary); history.push(summary);
    artifacts.push(projectArtifact("training-research-experiment", experimentId, artifactPath, true)); if (trainingResult) { artifacts.push(projectArtifact("training-run", trainingResult.trainingRunId, trainingResult.artifactPath, true)); artifacts.push(projectArtifact("policy", trainingResult.policyId, trainingResult.policyPath, true)); } if (revision) artifacts.push(projectArtifact("policy-revision", revision.id, revision.path, true)); sequence++;
  }
  return success("train-research", { research: research.id, programHash, benchmark: benchmark.id, lockHash: lock.lockHash, initialScore, finalScore: current.aggregateScore, scoreDelta: current.aggregateScore - initialScore, iterationsRequested: requestedIterations, iterationsCompleted: experiments.length, exhausted, experiments, training, controller, policyRevisionHead: await latestPolicyRevision(project.rootDir, research.id), ledgerPath }, project, artifacts);
}

export async function revisionsCommand(projectDir: string) {
  const project = await loadProject(projectDir); const revisions = [];
  for (const id of await listManifestDirectories(join(project.rootDir, "revisions"))) revisions.push(JSON.parse(await readFile(join(project.rootDir, "revisions", id, "manifest.json"), "utf8")));
  return success("revisions", { revisions }, project);
}

export async function policyRevisionsCommand(projectDir: string) {
  const project = await loadProject(projectDir); const revisions = [];
  for (const id of await listManifestDirectories(join(project.rootDir, "policy-revisions"))) revisions.push(JSON.parse(await readFile(join(project.rootDir, "policy-revisions", id, "manifest.json"), "utf8")));
  return success("policy-revisions", { revisions }, project);
}

export async function revisionInspectCommand(projectDir: string, id: string) {
  const project = await loadProject(projectDir); const root = confined(project.rootDir, `revisions/${id}`); const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  return success("revision.inspect", { manifest, evaluation: JSON.parse(await readFile(join(root, "evaluation.json"), "utf8")), rootDir: root }, project);
}

export async function policyRevisionInspectCommand(projectDir: string, id: string) {
  const project = await loadProject(projectDir); const root = confined(project.rootDir, `policy-revisions/${id}`); const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  return success("policy-revision.inspect", { manifest, evaluation: JSON.parse(await readFile(join(root, "evaluation.json"), "utf8")), rootDir: root }, project);
}
