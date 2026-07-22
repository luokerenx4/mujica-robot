import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import {
  atomicDirectory, compareAssemblies, compileAssembly, confined, hashDirectory, hashJson, listAssemblyIds, listComponentIds, loadAssembly, loadBenchmark, loadCandidate, loadComponent,
  loadController, loadObjective, loadProject, loadScenario, loadTask, loadTrainer, loadTraining, readJson, sha256, stableJson, validateProject, writeJson,
  type BenchmarkDefinition, type CompiledAssembly, type ControllerDefinition, type ProjectContext,
} from "@mujica/core";
import { validateProjectDefinitions } from "@mujica/core";
import { success, type Artifact } from "./contract";
import { dependencyLockHash, invokeRuntime, runtimeCompiled, runtimeVersion } from "./runtime";

function projectArtifact(kind: Artifact["kind"], id: string, path: string, immutable: boolean): Artifact { return { kind, id, path, immutable }; }
async function exists(path: string): Promise<boolean> { return Bun.file(path).exists(); }

async function controllerIdentity(projectDir: string, id: string): Promise<{ definition: ControllerDefinition; rootDir: string; hash: string }> {
  const controller = await loadController(projectDir, id);
  if (controller.definition.kind === "program") return { ...controller, hash: await hashDirectory(controller.rootDir) };
  const policyDir = confined(resolve(projectDir), `policies/${controller.definition.policy}`);
  if (!(await exists(join(policyDir, "manifest.json")))) throw new Error(`Frozen policy '${controller.definition.policy}' does not exist`);
  return { ...controller, hash: await hashDirectory(policyDir) };
}

async function baseRequest(project: ProjectContext, assembly: CompiledAssembly, controllerId: string, taskId: string, scenarioId: string, objectiveId: string, seed: number) {
  const controller = await controllerIdentity(project.rootDir, controllerId);
  return {
    request: {
      runtimeVersion, projectDir: project.rootDir, modelPath: assembly.modelPath, compiled: runtimeCompiled(assembly), controller: controller.definition, controllerRoot: controller.rootDir,
      controllerHash: controller.hash, task: await loadTask(project.rootDir, taskId), scenario: await loadScenario(project.rootDir, scenarioId), objective: await loadObjective(project.rootDir, objectiveId), seed,
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
  const policies = await listManifestDirectories(join(project.rootDir, "policies")); const runs = await listManifestDirectories(join(project.rootDir, "runs")); const revisions = await listManifestDirectories(join(project.rootDir, "revisions"));
  return success("inspect", { project: project.manifest, counts: { components: components.length, assemblies: assemblies.length, policies: policies.length, runs: runs.length, revisions: revisions.length }, components, assemblies, policies, runs, revisions }, project);
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

export async function trainCommand(projectDir: string, trainingId: string, seed: number) {
  const project = await loadProject(projectDir); const training = await loadTraining(project.rootDir, trainingId); const assembly = await compileAssembly(project.rootDir, training.assembly); const trainer = await loadTrainer(project.rootDir, training.trainer);
  const trainerHash = await hashDirectory(trainer.rootDir); const scenarios = [];
  for (const id of training.scenarios) scenarios.push(await loadScenario(project.rootDir, id));
  const result = await invokeRuntime("train", {
    runtimeVersion, projectDir: project.rootDir, modelPath: assembly.modelPath, compiled: runtimeCompiled(assembly), training, trainer: trainer.definition, trainerRoot: trainer.rootDir, trainerHash,
    task: await loadTask(project.rootDir, training.task), scenarios, seed, dependencyLockHash: await dependencyLockHash(),
    sourceHashes: { trainer: trainerHash, assembly: assembly.assemblyHash, catalog: assembly.catalogHash, training: hashJson(training) },
  });
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

function lockPayload(benchmark: BenchmarkDefinition, baselineAssemblyHash: string, baselineControllerHash: string, objective: unknown, cases: Array<{ task: unknown; scenario: unknown }>) {
  return { version: 1, benchmarkId: benchmark.id, benchmarkHash: hashJson(benchmark), baselineAssemblyHash, baselineControllerHash, objectiveHash: hashJson(objective), cases: cases.map((item, index) => ({ id: benchmark.cases[index]?.id, taskHash: hashJson(item.task), scenarioHash: hashJson(item.scenario), seed: benchmark.cases[index]?.seed, weight: benchmark.cases[index]?.weight })) };
}

async function currentLockPayload(project: ProjectContext, benchmark: BenchmarkDefinition) {
  const assembly = await compileAssembly(project.rootDir, benchmark.baseline.assembly); const controller = await controllerIdentity(project.rootDir, benchmark.baseline.controller); const objective = await loadObjective(project.rootDir, benchmark.objective); const cases = [];
  for (const item of benchmark.cases) cases.push({ task: await loadTask(project.rootDir, item.task), scenario: await loadScenario(project.rootDir, item.scenario) });
  return lockPayload(benchmark, assembly.assemblyHash, controller.hash, objective, cases);
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

async function evaluatePair(project: ProjectContext, benchmark: BenchmarkDefinition, assemblyId: string, controllerId: string) {
  const assembly = await compileAssembly(project.rootDir, assemblyId); const results = []; let weighted = 0; let totalWeight = 0;
  for (const item of benchmark.cases) {
    const { request } = await baseRequest(project, assembly, controllerId, item.task, item.scenario, benchmark.objective, item.seed); const result = await invokeRuntime("evaluate-case", request);
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
    if (candidateCase && candidateCase.metrics.survivalRate < objective.gates.minimumSurvivalRate) gateReasons.push(`${candidateCase.case.id}: survival ${candidateCase.metrics.survivalRate.toFixed(3)} below gate`);
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

export async function revisionsCommand(projectDir: string) {
  const project = await loadProject(projectDir); const revisions = [];
  for (const id of await listManifestDirectories(join(project.rootDir, "revisions"))) revisions.push(JSON.parse(await readFile(join(project.rootDir, "revisions", id, "manifest.json"), "utf8")));
  return success("revisions", { revisions }, project);
}

export async function revisionInspectCommand(projectDir: string, id: string) {
  const project = await loadProject(projectDir); const root = confined(project.rootDir, `revisions/${id}`); const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  return success("revision.inspect", { manifest, evaluation: JSON.parse(await readFile(join(root, "evaluation.json"), "utf8")), rootDir: root }, project);
}
