import { appendFile, cp, mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  assertProgramControllerCompatible, atomicDirectory, compareAssemblies, compileAssembly, confined, domainProfileSchema, hashDirectory, hashJson, listAssemblyIds, listCalibrationIds, listComponentIds, listControllerIds, loadAssembly, loadBenchmark, loadCalibration, loadCandidate, loadComponent,
  listDomainProfileIds, loadController, loadDomainProfile, loadObjective, loadProject, loadResearch, loadScenario, loadTask, loadTrainer, loadTraining, loadTrainingResearch, programControllerInterfaceIssues, researchProposalSchema, sha256, stableJson, trainingSchema, validateProject, verifyCandidateChanges, writeJson,
  type BenchmarkDefinition, type CalibrationDefinition, type CompiledAssembly, type ControllerDefinition, type ProjectContext, type ResearchDefinition, type ResearchProposal, type TrainingDefinition, type TrainingResearchDefinition,
} from "@mujica/core";
import { validateProjectDefinitions } from "@mujica/core";
import { success, type Artifact } from "./contract";
import { dependencyLockHash, harnessDependencyLockHash, harnessSourceHash, invokeRuntime, runtimeCompiled, runtimeSourceHash, runtimeVersion } from "./runtime";
import { writeStudioSnapshot } from "@mujica/studio";

function projectArtifact(kind: Artifact["kind"], id: string, path: string, immutable: boolean): Artifact { return { kind, id, path, immutable }; }
async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

async function domainProfileIdentity(projectDir: string, id: string) {
  const definition = await loadDomainProfile(projectDir, id);
  const evidenceHash = definition.provenance.evidence
    ? sha256(await readFile(confined(projectDir, definition.provenance.evidence)))
    : null;
  return { definition, evidenceHash, hash: hashJson({ definition, evidenceHash }) };
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
  assertProgramControllerCompatible(controller.definition, assembly);
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
  const project = await loadProject(projectDir); const components = await listComponentIds(project.rootDir); const assemblies = await listAssemblyIds(project.rootDir); const controllers = await listControllerIds(project.rootDir); const domainProfiles = await listDomainProfileIds(project.rootDir); const calibrations = await listCalibrationIds(project.rootDir);
  const policies = await listManifestDirectories(join(project.rootDir, "policies")); const runs = await listManifestDirectories(join(project.rootDir, "runs")); const trainingRuns = await listManifestDirectories(join(project.rootDir, "training-runs")); const calibrationRuns = await listManifestDirectories(join(project.rootDir, "calibration-runs")); const revisions = await listManifestDirectories(join(project.rootDir, "revisions")); const policyRevisions = await listManifestDirectories(join(project.rootDir, "policy-revisions"));
  const hardwareBundles = await listManifestDirectories(join(project.rootDir, "hardware-bundles")); const hardwareVerifications = await listManifestDirectories(join(project.rootDir, "hardware-verifications"));
  return success("inspect", { project: project.manifest, counts: { components: components.length, assemblies: assemblies.length, controllers: controllers.length, domainProfiles: domainProfiles.length, calibrations: calibrations.length, policies: policies.length, runs: runs.length, trainingRuns: trainingRuns.length, calibrationRuns: calibrationRuns.length, revisions: revisions.length, policyRevisions: policyRevisions.length, hardwareBundles: hardwareBundles.length, hardwareVerifications: hardwareVerifications.length }, components, assemblies, controllers, domainProfiles, calibrations, policies, runs, trainingRuns, calibrationRuns, revisions, policyRevisions, hardwareBundles, hardwareVerifications }, project);
}

export async function studioCommand(projectDir: string, run?: string, compareRun?: string) {
  const project = await loadProject(projectDir); const runIds = await listManifestDirectories(join(project.rootDir, "runs")); const runId = run ?? runIds.at(-1);
  if (!runId) throw new Error("Studio requires at least one completed Simulation Run");

  const render = async (selectedRunId: string) => {
    if (!runIds.includes(selectedRunId)) throw new Error(`Unknown completed run '${selectedRunId}'`);
    const runId = selectedRunId;
    const runRoot = confined(project.rootDir, `runs/${runId}`); const manifest = JSON.parse(await readFile(join(runRoot, "manifest.json"), "utf8"));
    if (manifest.completed !== true) throw new Error(`Simulation Run '${runId}' is incomplete`);
    const compiledInput = JSON.parse(await readFile(join(runRoot, "inputs", "compiled-assembly.json"), "utf8"));
    if (compiledInput.assemblyHash !== manifest.assemblyHash) throw new Error(`Simulation Run '${runId}' compiled Assembly hash is inconsistent`);
    let modelPath = join(runRoot, "inputs", "model.xml");
    if (await exists(modelPath)) {
      const frozenHash = sha256(await readFile(modelPath));
      if (compiledInput.modelHash !== frozenHash || manifest.modelHash !== frozenHash) throw new Error(`Simulation Run '${runId}' frozen model hash is inconsistent`);
    } else {
      const legacyRoot = confined(project.rootDir, `.mujica/cache/assemblies/${manifest.assemblyHash}`);
      const legacyManifestPath = join(legacyRoot, "compiled-assembly.json"); modelPath = join(legacyRoot, "model.xml");
      if (!(await exists(legacyManifestPath)) || !(await exists(modelPath))) throw new Error(`Simulation Run '${runId}' exact compiled model is unavailable`);
      const legacy = JSON.parse(await readFile(legacyManifestPath, "utf8"));
      if (legacy.assemblyHash !== manifest.assemblyHash || legacy.id !== compiledInput.id) throw new Error(`Simulation Run '${runId}' legacy compiled model cache is inconsistent`);
    }
    const modelHash = sha256(await readFile(modelPath));
    const trajectoryPath = join(runRoot, "trajectory.ndjson"); const trajectoryHash = sha256(await readFile(trajectoryPath));
    const settings = { width: 640, height: 480, stride: 1, camera: { azimuth: 135, elevation: -22, distance: 2.2 } };
    return invokeRuntime("render-replay", {
      runtimeVersion,
      runtimeSourceHash: await runtimeSourceHash(),
      runId,
      resultHash: manifest.resultHash,
      assemblyHash: manifest.assemblyHash,
      modelHash,
      modelPath,
      trajectoryPath,
      trajectoryHash,
      outputRoot: join(project.rootDir, ".mujica", "replays"),
      settings,
    });
  };

  const replay = await render(runId);
  const comparisonReplay = compareRun ? await render(compareRun) : null;
  const result = await writeStudioSnapshot(project.rootDir, {
    run: runId, replay: { path: replay.path, manifest: replay.manifest },
    ...(compareRun && comparisonReplay ? { compareRun, compareReplay: { path: comparisonReplay.path, manifest: comparisonReplay.manifest } } : {}),
  });
  const artifacts = [
    projectArtifact("simulation-replay", replay.id, replay.path, true),
    projectArtifact("studio-snapshot", result.id, result.path, false),
  ];
  if (comparisonReplay && comparisonReplay.id !== replay.id) artifacts.splice(1, 0, projectArtifact("simulation-replay", comparisonReplay.id, comparisonReplay.path, true));
  return success("studio", {
    id: result.id, snapshotHash: result.snapshotHash, path: result.path, indexPath: result.indexPath, selectedRun: result.selectedRun, comparisonRun: result.comparisonRun,
    replay: { id: replay.id, path: replay.path, frameCount: replay.manifest.frameCount, cached: replay.cached },
    comparisonReplay: comparisonReplay ? { id: comparisonReplay.id, path: comparisonReplay.path, frameCount: comparisonReplay.manifest.frameCount, cached: comparisonReplay.cached } : null,
  }, project, artifacts);
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

export async function domainListCommand(projectDir: string) {
  const project = await loadProject(projectDir); const profiles = [];
  for (const id of await listDomainProfileIds(project.rootDir)) {
    const identity = await domainProfileIdentity(project.rootDir, id);
    profiles.push({ ...identity.definition, evidenceHash: identity.evidenceHash, hash: identity.hash });
  }
  return success("domain.list", { profiles }, project);
}

export async function domainInspectCommand(projectDir: string, id: string) {
  const project = await loadProject(projectDir); const identity = await domainProfileIdentity(project.rootDir, id);
  return success("domain.inspect", { definition: identity.definition, evidenceHash: identity.evidenceHash, hash: identity.hash, path: confined(project.rootDir, `domain-profiles/${id}.domain.json`) }, project);
}

export async function calibrationListCommand(projectDir: string) {
  const project = await loadProject(projectDir); const calibrations = [];
  for (const id of await listCalibrationIds(project.rootDir)) {
    const definition = await loadCalibration(project.rootDir, id);
    const sourceHashes = [];
    for (const source of definition.sources) {
      const path = source.kind === "capture"
        ? confined(project.rootDir, source.path)
        : confined(project.rootDir, `runs/${source.run}/manifest.json`);
      sourceHashes.push({ ...source, hash: sha256(await readFile(path)) });
    }
    calibrations.push({ definition, sourceHashes, hash: hashJson({ definition, sourceHashes }) });
  }
  return success("calibration.list", { calibrations }, project);
}

export async function calibrationInspectCommand(projectDir: string, id: string) {
  const project = await loadProject(projectDir); const definition = await loadCalibration(project.rootDir, id);
  const sourceHashes = [];
  for (const source of definition.sources) {
    const path = source.kind === "capture"
      ? confined(project.rootDir, source.path)
      : confined(project.rootDir, `runs/${source.run}/manifest.json`);
    sourceHashes.push({ ...source, hash: sha256(await readFile(path)) });
  }
  return success("calibration.inspect", { definition, sourceHashes, hash: hashJson({ definition, sourceHashes }), path: confined(project.rootDir, `calibrations/${id}.calibration.json`) }, project, [], [
    { id: "run-calibration", description: "Fit the declared plant parameters and publish immutable Calibration evidence", argv: ["calibrate", project.rootDir, "--calibration", id], effect: "creates-artifact" },
  ]);
}

async function calibrationRuntimeSources(project: ProjectContext, definition: CalibrationDefinition, assembly: CompiledAssembly) {
  const sources = [];
  for (let index = 0; index < definition.sources.length; index++) {
    const source = definition.sources[index]!;
    if (source.kind === "capture") {
      const path = confined(project.rootDir, source.path);
      sources.push({ kind: "capture", id: `capture-${index + 1}`, path, hash: sha256(await readFile(path)) });
      continue;
    }
    const root = confined(project.rootDir, `runs/${source.run}`);
    const manifestPath = join(root, "manifest.json"); const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (manifest.completed !== true || Number(manifest.version) < 3) throw new Error(`Calibration source Run '${source.run}' lacks commanded-Action/initial-state evidence`);
    if (manifest.assemblyHash !== assembly.assemblyHash) throw new Error(`Calibration source Run '${source.run}' Assembly differs from '${assembly.id}'`);
    const trajectoryPath = join(root, "trajectory.ndjson"); const initialStatePath = join(root, "inputs", "initial-state.json");
    sources.push({
      kind: "simulation-run", id: source.run, run: source.run,
      manifestHash: sha256(await readFile(manifestPath)),
      resultHash: manifest.resultHash,
      trajectoryPath, trajectoryHash: sha256(await readFile(trajectoryPath)),
      initialStatePath, initialStateHash: sha256(await readFile(initialStatePath)),
    });
  }
  return sources;
}

export async function calibrateCommand(projectDir: string, id: string) {
  const project = await loadProject(projectDir); const calibration = await loadCalibration(project.rootDir, id); const assembly = await compileAssembly(project.rootDir, calibration.assembly);
  const sources = await calibrationRuntimeSources(project, calibration, assembly);
  const result = await invokeRuntime("calibrate", {
    runtimeVersion,
    runtimeSourceHash: await runtimeSourceHash(),
    harnessSourceHash: await harnessSourceHash(),
    projectDir: project.rootDir,
    modelPath: assembly.modelPath,
    compiled: runtimeCompiled(assembly),
    calibration,
    baseScenario: await loadScenario(project.rootDir, calibration.scenario),
    sources,
  });
  return success("calibrate", result, project, [projectArtifact("calibration-run", result.calibrationRunId, result.artifactPath, true)], [
    { id: "promote-profile", description: "Promote the validated Profile proposal into project source", argv: ["calibration", "promote", project.rootDir, "--run", result.calibrationRunId], effect: "mutates-project" },
  ]);
}

export async function calibrationPromoteCommand(projectDir: string, runId: string) {
  const project = await loadProject(projectDir); const root = confined(project.rootDir, `calibration-runs/${runId}`);
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  if (manifest.id !== runId || manifest.completed !== true) throw new Error(`Calibration Run '${runId}' is incomplete or inconsistent`);
  if (!Number.isFinite(manifest.validationLoss)) throw new Error(`Calibration Run '${runId}' has no validation evidence`);
  if (manifest.runtimeSourceHash !== await runtimeSourceHash() || manifest.harnessSourceHash !== await harnessSourceHash()) throw new Error(`Calibration Run '${runId}' was produced by a different Runtime or Harness; rerun Calibration before promotion`);
  const calibration = await loadCalibration(project.rootDir, manifest.calibration); const assembly = await compileAssembly(project.rootDir, calibration.assembly);
  if (manifest.validationLoss > calibration.optimizer.maximumValidationLoss) throw new Error(`Calibration Run '${runId}' validation loss ${manifest.validationLoss} exceeds the promotion limit ${calibration.optimizer.maximumValidationLoss}`);
  if (manifest.assemblyHash !== assembly.assemblyHash || manifest.modelHash !== assembly.modelHash) throw new Error(`Calibration Run '${runId}' model differs from the current Calibration Assembly`);
  const baseScenario = await loadScenario(project.rootDir, calibration.scenario);
  if (manifest.calibrationHash !== hashJson(calibration) || manifest.baseScenarioHash !== hashJson(baseScenario)) throw new Error(`Calibration Run '${runId}' definition or base Scenario changed; rerun Calibration before promotion`);
  const currentSources = (await calibrationRuntimeSources(project, calibration, assembly)).map((source) => Object.fromEntries(Object.entries(source).filter(([key]) => !key.endsWith("Path") && key !== "path")));
  if (stableJson(currentSources) !== stableJson(manifest.sources)) throw new Error(`Calibration Run '${runId}' source evidence changed; rerun Calibration before promotion`);
  const profile = domainProfileSchema.parse(JSON.parse(await readFile(join(root, "profile-proposal.json"), "utf8")));
  if (hashJson(profile) !== manifest.profileProposalHash) throw new Error(`Calibration Run '${runId}' Profile proposal hash differs from its manifest`);
  if (profile.provenance.evidence !== `calibration-runs/${runId}/manifest.json`) throw new Error(`Calibration Run '${runId}' Profile does not bind its evidence manifest`);
  const path = confined(project.rootDir, `domain-profiles/${profile.id}.domain.json`);
  const cached = await exists(path);
  if (cached) {
    const current = domainProfileSchema.parse(JSON.parse(await readFile(path, "utf8")));
    if (hashJson(current) !== hashJson(profile)) throw new Error(`Domain Profile '${profile.id}' already exists with different content`);
  } else {
    await writeJson(path, profile);
  }
  return success("calibration.promote", { run: runId, profile, hash: hashJson(profile), path, cached }, project);
}

async function controllerCompatibility(project: ProjectContext, definition: ControllerDefinition) {
  const compatibleAssemblies: string[] = []; const incompatibleAssemblies: Array<{ assembly: string; issues: Array<{ code: string; channel: string | null; message: string }> }> = [];
  const policyManifest = definition.kind === "policy" ? JSON.parse(await readFile(confined(project.rootDir, `policies/${definition.policy}/manifest.json`), "utf8")) : null;
  for (const assemblyId of await listAssemblyIds(project.rootDir)) {
    const assembly = await compileAssembly(project.rootDir, assemblyId); let issues: Array<{ code: string; channel: string | null; message: string }>;
    if (definition.kind === "program") issues = programControllerInterfaceIssues(definition, assembly);
    else {
      issues = [];
      if (policyManifest.executionHash ? policyManifest.executionHash !== assembly.executionHash : policyManifest.assemblyHash !== assembly.assemblyHash || policyManifest.catalogHash !== assembly.catalogHash) issues.push({ code: "policy.execution", channel: null, message: `Policy '${definition.policy}' executable identity does not match Assembly '${assembly.id}'` });
      if (policyManifest.observationContractHash !== hashJson(assembly.observationContract)) issues.push({ code: "policy.observations", channel: null, message: `Policy '${definition.policy}' Observation Contract does not match Assembly '${assembly.id}'` });
      if (policyManifest.actionContractHash !== hashJson(assembly.actionContract)) issues.push({ code: "policy.actions", channel: null, message: `Policy '${definition.policy}' Action Contract does not match Assembly '${assembly.id}'` });
    }
    if (issues.length) incompatibleAssemblies.push({ assembly: assembly.id, issues }); else compatibleAssemblies.push(assembly.id);
  }
  return { compatibleAssemblies, incompatibleAssemblies };
}

export async function controllerListCommand(projectDir: string) {
  const project = await loadProject(projectDir); const controllers = [];
  for (const id of await listControllerIds(project.rootDir)) {
    const controller = await controllerIdentity(project.rootDir, id); const compatibility = await controllerCompatibility(project, controller.definition);
    controllers.push({ id, name: controller.definition.name, kind: controller.definition.kind, hash: controller.hash, ...(controller.definition.kind === "program" ? { interface: controller.definition.interface } : { policy: controller.definition.policy }), compatibleAssemblies: compatibility.compatibleAssemblies });
  }
  return success("controller.list", { controllers }, project);
}

export async function controllerInspectCommand(projectDir: string, id: string) {
  const project = await loadProject(projectDir); const controller = await controllerIdentity(project.rootDir, id); const compatibility = await controllerCompatibility(project, controller.definition);
  const first = compatibility.compatibleAssemblies[0];
  return success("controller.inspect", { definition: controller.definition, hash: controller.hash, rootDir: controller.rootDir, ...compatibility }, project, [], first ? [{ id: "simulate-compatible", description: "Run this Controller with its first compatible Assembly and project-default test inputs", argv: ["simulate", project.rootDir, "--assembly", first, "--controller", id, "--task", project.manifest.defaults.task, "--scenario", project.manifest.defaults.scenario], effect: "creates-artifact" }] : []);
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

export async function executeTraining(project: ProjectContext, training: TrainingDefinition, seed: number, deadlineMs?: number) {
  const assembly = await compileAssembly(project.rootDir, training.assembly); const trainer = await loadTrainer(project.rootDir, training.trainer);
  const trainerHash = await hashDirectory(trainer.rootDir); const sourceHash = await runtimeSourceHash(); const harnessHash = await harnessSourceHash(); const harnessDependencyHash = await harnessDependencyLockHash(); const scenarios = [];
  for (const id of training.scenarios) scenarios.push(await loadScenario(project.rootDir, id));
  let priorController: { definition: ControllerDefinition; rootDir: string; hash: string } | null = null;
  if (training.priorController) {
    const prior = await loadController(project.rootDir, training.priorController); if (prior.definition.kind !== "program") throw new Error(`Training prior '${training.priorController}' must be a program Controller`);
    assertProgramControllerCompatible(prior.definition, assembly); priorController = { definition: prior.definition, rootDir: prior.rootDir, hash: await hashDirectory(prior.rootDir) };
  }
  const domainProfileIdentityValue = training.domainProfile ? await domainProfileIdentity(project.rootDir, training.domainProfile) : null;
  const domainProfile = domainProfileIdentityValue?.definition ?? null;
  const domainProfileEvidenceHash = domainProfileIdentityValue?.evidenceHash ?? null;
  const domainProfileHash = domainProfileIdentityValue?.hash ?? null;
  const timeoutMs = deadlineMs === undefined ? undefined : deadlineMs - Date.now();
  if (timeoutMs !== undefined && timeoutMs <= 0) throw new Error("Research Lab wall-clock budget exhausted before training");
  return await invokeRuntime("train", {
    runtimeVersion, runtimeSourceHash: sourceHash, harnessSourceHash: harnessHash, harnessDependencyLockHash: harnessDependencyHash, projectDir: project.rootDir, modelPath: assembly.modelPath, compiled: runtimeCompiled(assembly), training, trainer: trainer.definition, trainerRoot: trainer.rootDir, trainerHash,
    priorController: priorController?.definition ?? null, priorControllerRoot: priorController?.rootDir ?? null, priorControllerHash: priorController?.hash ?? null,
    domainProfile, domainProfileHash, domainProfileEvidenceHash,
    task: await loadTask(project.rootDir, training.task), scenarios, seed, dependencyLockHash: await dependencyLockHash(),
    sourceHashes: { runtime: sourceHash, harness: harnessHash, harnessDependencies: harnessDependencyHash, trainer: trainerHash, priorController: priorController?.hash ?? null, domainProfile: domainProfileHash, assembly: assembly.assemblyHash, catalog: assembly.catalogHash, training: hashJson(training) },
  }, timeoutMs);
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

export async function policyRequalifyCommand(projectDir: string, policyId: string, assemblyId: string) {
  const project = await loadProject(projectDir); const source = confined(project.rootDir, `policies/${policyId}`); const manifest = JSON.parse(await readFile(join(source, "manifest.json"), "utf8")); const sourcePolicyHash = await hashDirectory(source);
  const assembly = await compileAssembly(project.rootDir, assemblyId); const oldModelPath = confined(project.rootDir, `.mujica/cache/assemblies/${manifest.assemblyHash}/model.xml`);
  if (!(await exists(oldModelPath))) throw new Error(`Old compiled Assembly '${manifest.assemblyHash}' is unavailable; execution equivalence cannot be proven`);
  const oldModelHash = sha256(await readFile(oldModelPath)); if (oldModelHash !== assembly.modelHash) throw new Error("Old and new compiled MJCF differ; Policy must be retrained");
  const oldObservation = JSON.parse(await readFile(join(source, "observation-contract.json"), "utf8")); const oldAction = JSON.parse(await readFile(join(source, "action-contract.json"), "utf8"));
  const observationContractHash = hashJson(assembly.observationContract); const actionContractHash = hashJson(assembly.actionContract);
  if (hashJson(oldObservation) !== observationContractHash || hashJson(oldAction) !== actionContractHash) throw new Error("Old and new Controller contracts differ; Policy must be retrained");
  const proof = { version: 1, kind: "execution-equivalent-metadata-migration", sourcePolicyId: policyId, sourcePolicyHash, oldAssemblyHash: manifest.assemblyHash, newAssemblyHash: assembly.assemblyHash, oldModelHash, newModelHash: assembly.modelHash, executionHash: assembly.executionHash, observationContractHash, actionContractHash };
  const identity = hashJson(proof); const id = `${manifest.id.split(/-[0-9a-f]{16}$/)[0]}-q-${identity.slice(0, 16)}`; const target = confined(project.rootDir, `policies/${id}`);
  if (!(await exists(join(target, "manifest.json")))) await atomicDirectory(target, async (directory) => {
    await cp(source, directory, { recursive: true }); const sourceHashes = JSON.parse(await readFile(join(source, "source-hashes.json"), "utf8"));
    await writeJson(join(directory, "source-hashes.json"), { ...sourceHashes, assembly: assembly.assemblyHash, catalog: assembly.catalogHash, requalifiedFromPolicy: sourcePolicyHash });
    await writeJson(join(directory, "requalification.json"), proof);
    await writeJson(join(directory, "manifest.json"), { ...manifest, id, assemblyHash: assembly.assemblyHash, executionHash: assembly.executionHash, modelXmlHash: assembly.modelHash, catalogHash: assembly.catalogHash, observationContractHash, actionContractHash, derivedFromPolicy: policyId, derivedFromPolicyHash: sourcePolicyHash, derivation: proof.kind });
  });
  return success("policy.requalify", { id, path: target, sourcePolicyId: policyId, assembly: assemblyId, proof }, project, [projectArtifact("policy", id, target, true)]);
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

export async function requireBenchmarkLock(project: ProjectContext, benchmark: BenchmarkDefinition) {
  const path = join(project.rootDir, "benchmarks", `${benchmark.id}.lock.json`); if (!(await exists(path))) throw new Error(`Benchmark '${benchmark.id}' is not locked; run 'mujica benchmark lock ...'`);
  const stored = JSON.parse(await readFile(path, "utf8")); const current = await currentLockPayload(project, benchmark); const currentHash = hashJson(current);
  if (stored.lockHash !== currentHash) throw new Error(`Benchmark '${benchmark.id}' fixed inputs drifted; review changes and lock again`);
  return stored;
}

export async function evaluatePair(project: ProjectContext, benchmark: BenchmarkDefinition, assemblyId: string, controllerId: string, override?: ControllerDefinition, deadlineMs?: number) {
  const assembly = await compileAssembly(project.rootDir, assemblyId); const results = []; let weighted = 0; let totalWeight = 0;
  for (const item of benchmark.cases) {
    const timeoutMs = deadlineMs === undefined ? undefined : deadlineMs - Date.now();
    if (timeoutMs !== undefined && timeoutMs <= 0) throw new Error("Research Lab wall-clock budget exhausted during evaluation");
    const { request } = await baseRequest(project, assembly, controllerId, item.task, item.scenario, benchmark.objective, item.seed, override); const result = await invokeRuntime("evaluate-case", request, timeoutMs);
    results.push({ case: item, metrics: result.metrics, score: result.score, resultHash: result.resultHash }); weighted += result.score.total * item.weight; totalWeight += item.weight;
  }
  return { assembly: assemblyId, controller: controllerId, assemblyHash: assembly.assemblyHash, aggregateScore: weighted / totalWeight, cases: results };
}

export async function evaluateCommand(projectDir: string, options: { assembly: string; controller: string; benchmark: string }) {
  const project = await loadProject(projectDir); const benchmark = await loadBenchmark(project.rootDir, options.benchmark); const lock = await requireBenchmarkLock(project, benchmark); const evaluation = await evaluatePair(project, benchmark, options.assembly, options.controller);
  return success("evaluate", { benchmark: benchmark.id, lockHash: lock.lockHash, evaluation }, project);
}

export async function candidateCommand(projectDir: string, id: string, apply: boolean, deadlineMs?: number) {
  const project = await loadProject(projectDir); const candidate = await loadCandidate(project.rootDir, id); const benchmark = await loadBenchmark(project.rootDir, candidate.benchmark); const lock = await requireBenchmarkLock(project, benchmark);
  if (stableJson(candidate.baseline) !== stableJson(benchmark.baseline)) throw new Error("Candidate baseline must match its locked Benchmark baseline");
  const [{ comparison, actual: verifiedChanges }, baseline, proposed] = await Promise.all([verifyCandidateChanges(project.rootDir, candidate), evaluatePair(project, benchmark, candidate.baseline.assembly, candidate.baseline.controller, undefined, deadlineMs), evaluatePair(project, benchmark, candidate.proposed.assembly, candidate.proposed.controller, undefined, deadlineMs)]);
  const objective = await loadObjective(project.rootDir, benchmark.objective); const delta = proposed.aggregateScore - baseline.aggregateScore;
  const gateReasons: string[] = [];
  for (let index = 0; index < proposed.cases.length; index++) {
    const candidateCase = proposed.cases[index]; const baselineCase = baseline.cases[index];
    if (candidateCase && candidateCase.case.gating === false) continue;
    if (candidateCase && candidateCase.metrics.survivalRate < objective.gates.minimumSurvivalRate) gateReasons.push(`${candidateCase.case.id}: survival ${candidateCase.metrics.survivalRate.toFixed(3)} below gate`);
    if (candidateCase && candidateCase.metrics.targetDistance > 0 && candidateCase.metrics.forwardProgress < objective.gates.minimumForwardProgress) gateReasons.push(`${candidateCase.case.id}: forward progress ${candidateCase.metrics.forwardProgress.toFixed(3)} below gate`);
    if (candidateCase && candidateCase.metrics.targetDistance > 0 && candidateCase.metrics.signedForwardProgress < objective.gates.minimumSignedForwardProgress) gateReasons.push(`${candidateCase.case.id}: signed forward progress ${candidateCase.metrics.signedForwardProgress.toFixed(3)} below gate`);
    if (candidateCase && candidateCase.metrics.backwardDisplacement > objective.gates.maximumBackwardDisplacement) gateReasons.push(`${candidateCase.case.id}: backward displacement ${candidateCase.metrics.backwardDisplacement.toFixed(3)} exceeds gate`);
    if (candidateCase && candidateCase.metrics.maximumBackwardPitchRad > objective.gates.maximumBackwardPitchRad) gateReasons.push(`${candidateCase.case.id}: backward pitch ${candidateCase.metrics.maximumBackwardPitchRad.toFixed(3)} exceeds gate`);
    if (candidateCase && candidateCase.metrics.maximumAbsolutePitchRad > objective.gates.maximumAbsolutePitchRad) gateReasons.push(`${candidateCase.case.id}: absolute pitch ${candidateCase.metrics.maximumAbsolutePitchRad.toFixed(3)} exceeds gate`);
    if (candidateCase && candidateCase.metrics.maximumAbsolutePitchRateRadPerSec > objective.gates.maximumAbsolutePitchRateRadPerSec) gateReasons.push(`${candidateCase.case.id}: absolute pitch rate ${candidateCase.metrics.maximumAbsolutePitchRateRadPerSec.toFixed(3)} exceeds gate`);
    if (candidateCase && candidateCase.metrics.maximumBodyTiltRad > objective.gates.maximumBodyTiltRad) gateReasons.push(`${candidateCase.case.id}: body tilt ${candidateCase.metrics.maximumBodyTiltRad.toFixed(3)} exceeds gate`);
    if (candidateCase && candidateCase.metrics.lateralDrift > objective.gates.maximumLateralDrift) gateReasons.push(`${candidateCase.case.id}: lateral drift ${candidateCase.metrics.lateralDrift.toFixed(3)} exceeds gate`);
    if (candidateCase && candidateCase.metrics.planarVelocityTrackingError > objective.gates.maximumPlanarVelocityTrackingError) gateReasons.push(`${candidateCase.case.id}: planar velocity tracking error ${candidateCase.metrics.planarVelocityTrackingError.toFixed(3)} exceeds gate`);
    if (candidateCase && candidateCase.metrics.yawRateTrackingError > objective.gates.maximumYawRateTrackingError) gateReasons.push(`${candidateCase.case.id}: yaw rate tracking error ${candidateCase.metrics.yawRateTrackingError.toFixed(3)} exceeds gate`);
    if (candidateCase && candidateCase.metrics.maximumTransitionTerminalPlanarTrackingError > objective.gates.maximumTransitionTerminalPlanarTrackingError) gateReasons.push(`${candidateCase.case.id}: transition terminal planar tracking error ${candidateCase.metrics.maximumTransitionTerminalPlanarTrackingError.toFixed(3)} exceeds gate`);
    if (candidateCase && candidateCase.metrics.maximumTransitionTerminalYawRateTrackingError > objective.gates.maximumTransitionTerminalYawRateTrackingError) gateReasons.push(`${candidateCase.case.id}: transition terminal yaw tracking error ${candidateCase.metrics.maximumTransitionTerminalYawRateTrackingError.toFixed(3)} exceeds gate`);
    if (candidateCase && candidateCase.metrics.maximumPlanarSettlingTimeSeconds > objective.gates.maximumPlanarSettlingTimeSeconds) gateReasons.push(`${candidateCase.case.id}: planar settling time ${candidateCase.metrics.maximumPlanarSettlingTimeSeconds.toFixed(3)} exceeds gate`);
    if (candidateCase && candidateCase.metrics.maximumPlanarBrakingSettlingTimeSeconds > objective.gates.maximumPlanarBrakingSettlingTimeSeconds) gateReasons.push(`${candidateCase.case.id}: planar braking settling time ${candidateCase.metrics.maximumPlanarBrakingSettlingTimeSeconds.toFixed(3)} exceeds gate`);
    if (candidateCase && candidateCase.metrics.maximumYawRateSettlingTimeSeconds > objective.gates.maximumYawRateSettlingTimeSeconds) gateReasons.push(`${candidateCase.case.id}: yaw settling time ${candidateCase.metrics.maximumYawRateSettlingTimeSeconds.toFixed(3)} exceeds gate`);
    if (candidateCase && candidateCase.metrics.maximumPlanarOvershootMps > objective.gates.maximumPlanarOvershootMps) gateReasons.push(`${candidateCase.case.id}: planar overshoot ${candidateCase.metrics.maximumPlanarOvershootMps.toFixed(3)} exceeds gate`);
    if (candidateCase && candidateCase.metrics.maximumYawRateOvershootRadPerSec > objective.gates.maximumYawRateOvershootRadPerSec) gateReasons.push(`${candidateCase.case.id}: yaw-rate overshoot ${candidateCase.metrics.maximumYawRateOvershootRadPerSec.toFixed(3)} exceeds gate`);
    if (candidateCase && candidateCase.metrics.unsettledPlanarTransitionCount > objective.gates.maximumUnsettledPlanarTransitions) gateReasons.push(`${candidateCase.case.id}: ${candidateCase.metrics.unsettledPlanarTransitionCount} planar transitions did not settle`);
    if (candidateCase && candidateCase.metrics.unsettledYawRateTransitionCount > objective.gates.maximumUnsettledYawRateTransitions) gateReasons.push(`${candidateCase.case.id}: ${candidateCase.metrics.unsettledYawRateTransitionCount} yaw transitions did not settle`);
    if (candidateCase && baselineCase && candidateCase.score.total - baselineCase.score.total < -objective.gates.maximumRegression) gateReasons.push(`${candidateCase.case.id}: score regression exceeds gate`);
  }
  const allowedChangeHashes: Record<string, string> = {};
  for (const path of candidate.allowedChanges) allowedChangeHashes[path] = sha256(await readFile(confined(project.rootDir, path)));
  const baselineViolationCount = baseline.cases.reduce((count, baselineCase) => count + diagnosticGates(objective, baselineCase, baselineCase).filter((gate) => gate.enforced && !gate.passed).length, 0);
  const selection = candidateSelection(gateReasons, delta, baselineViolationCount); const { verdict } = selection; const candidateHash = hashJson({ candidate, allowedChangeHashes });
  const proposedRevisionHash = hashJson({ parent: candidate.baseRevision, candidateHash, lockHash: lock.lockHash, proposedHash: proposed.assemblyHash, evaluation: proposed.cases.map((item) => item.resultHash) });
  const proposedRevisionId = `${project.manifest.id}-r-${proposedRevisionHash.slice(0, 12)}`;
  const result = { candidate, candidateHash, allowedChangeHashes, verifiedChanges, benchmarkLockHash: lock.lockHash, comparison, baseline, proposed, scoreDelta: delta, baselineViolationCount, gateReasons, ...selection, proposedRevisionHash, proposedRevisionId };
  if (!apply) return success("candidate", result, project);
  if (verdict !== "KEEP") throw new Error(`Candidate verdict is ${verdict}; only KEEP may create a revision`);
  const revisions = await listManifestDirectories(join(project.rootDir, "revisions"));
  if (candidate.baseRevision === null && revisions.length) throw new Error("Candidate expected no base revision but revision history is no longer empty");
  if (candidate.baseRevision !== null && !revisions.includes(candidate.baseRevision)) throw new Error(`Base revision '${candidate.baseRevision}' does not exist`);
  const revisionHash = proposedRevisionHash; const revisionId = proposedRevisionId; const target = join(project.rootDir, "revisions", revisionId);
  const controller = await controllerIdentity(project.rootDir, candidate.proposed.controller); const policyId = controller.definition.kind === "policy" ? controller.definition.policy : null;
  const policyHash = policyId ? await hashDirectory(confined(project.rootDir, `policies/${policyId}`)) : null;
  const componentHashes = Object.fromEntries(comparison.to.components.map((item) => [item.instanceId, item.hash]));
  await atomicDirectory(target, async (directory) => {
    const sourceClosure = [...new Set([...comparison.to.sourceFiles, ...candidate.allowedChanges, ...candidate.fixedInputs])].sort();
    for (const path of sourceClosure) {
      const destination = join(directory, "sources", path); await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, await readFile(confined(project.rootDir, path)));
    }
    const compiledDirectory = join(directory, "compiled"); await mkdir(compiledDirectory, { recursive: true });
    for (const name of ["model.xml", "observation-contract.json", "action-contract.json", "compiled-assembly.json"]) await writeFile(join(compiledDirectory, name), await readFile(join(comparison.to.artifactDir, name)));
    if (policyId) await cp(confined(project.rootDir, `policies/${policyId}`), join(directory, "policy"), { recursive: true });
    await writeJson(join(directory, "evaluation.json"), result);
    await writeJson(join(directory, "manifest.json"), {
      version: 1, id: revisionId, parent: candidate.baseRevision, candidateId: candidate.id, candidateHash,
      benchmarkId: benchmark.id, benchmarkLockHash: lock.lockHash,
      assembly: candidate.proposed.assembly, assemblyHash: proposed.assemblyHash, componentHashes,
      observationContractHash: hashJson(comparison.to.observationContract), actionContractHash: hashJson(comparison.to.actionContract),
      controller: candidate.proposed.controller, controllerHash: controller.hash, policyId, policyHash,
      verifiedChanges, aggregateScore: proposed.aggregateScore, scoreDelta: delta,
      exactChangedFiles: candidate.allowedChanges, sourceClosure, appliedAt: new Date().toISOString(),
    });
  });
  return success("candidate.apply", { ...result, revisionId, revisionPath: target }, project, [projectArtifact("revision", revisionId, target, true)]);
}

type EvaluationResult = Awaited<ReturnType<typeof evaluatePair>>;

export function candidateSelection(gateReasons: string[], scoreDelta: number, baselineViolationCount: number) {
  const feasible = gateReasons.length === 0;
  const verdict = feasible && (baselineViolationCount > 0 || scoreDelta > 0) ? "KEEP" as const : "REVERT" as const;
  const selectionReason = verdict === "KEEP" ? (baselineViolationCount > 0 ? "fewer-gate-violations" as const : "score-improvement-within-feasibility-tier" as const) : (gateReasons.length ? "candidate-gate-violation" as const : "no-feasibility-or-score-improvement" as const);
  return { verdict, selectionReason };
}

type GateAssessment = {
  id: "survival" | "forward-progress" | "signed-forward-progress" | "backward-displacement" | "backward-pitch" | "pitch-angle" | "pitch-rate" | "body-tilt" | "lateral-drift" | "planar-velocity-tracking" | "yaw-rate-tracking" | "transition-terminal-planar" | "transition-terminal-yaw" | "planar-settling-time" | "planar-braking-settling-time" | "yaw-settling-time" | "planar-overshoot" | "yaw-overshoot" | "unsettled-planar" | "unsettled-yaw" | "joint-jerk" | "body-angular-jerk" | "action-slew" | "actuator-saturation" | "foot-slip" | "foot-impact" | "score-regression";
  metric: string; comparator: ">=" | "<="; threshold: number; value: number; margin: number; passed: boolean; enforced: boolean; severity: number;
};

export function upperViolationSeverity(value: number, threshold: number, normalization = Math.max(Math.abs(threshold), 1e-9)) {
  const margin = threshold - value;
  return margin < 0 ? -margin / Math.max(normalization, 1e-9) : 0;
}

function diagnosticGates(objective: Awaited<ReturnType<typeof loadObjective>>, candidate: EvaluationResult["cases"][number], baseline: EvaluationResult["cases"][number] | undefined): GateAssessment[] {
  const enforced = candidate.case.gating !== false; const gates: GateAssessment[] = [];
  const lower = (id: GateAssessment["id"], metric: string, value: number, threshold: number): GateAssessment => { const margin = value - threshold; return { id, metric, comparator: ">=", threshold, value, margin, passed: margin >= 0, enforced, severity: margin < 0 ? -margin / Math.max(Math.abs(threshold), 1e-9) : 0 }; };
  const upper = (id: GateAssessment["id"], metric: string, value: number, threshold: number, normalization?: number): GateAssessment => { const margin = threshold - value; return { id, metric, comparator: "<=", threshold, value, margin, passed: margin >= 0, enforced, severity: upperViolationSeverity(value, threshold, normalization) }; };
  gates.push(lower("survival", "survivalRate", candidate.metrics.survivalRate, objective.gates.minimumSurvivalRate));
  if (candidate.metrics.targetDistance > 0) gates.push(lower("forward-progress", "forwardProgress", candidate.metrics.forwardProgress, objective.gates.minimumForwardProgress));
  if (candidate.metrics.targetDistance > 0) gates.push(lower("signed-forward-progress", "signedForwardProgress", candidate.metrics.signedForwardProgress ?? candidate.metrics.forwardProgress, objective.gates.minimumSignedForwardProgress));
  gates.push(upper("backward-displacement", "backwardDisplacement", candidate.metrics.backwardDisplacement ?? 0, objective.gates.maximumBackwardDisplacement, 0.1));
  gates.push(upper("backward-pitch", "maximumBackwardPitchRad", candidate.metrics.maximumBackwardPitchRad ?? 0, objective.gates.maximumBackwardPitchRad, 0.5));
  gates.push(upper("pitch-angle", "maximumAbsolutePitchRad", candidate.metrics.maximumAbsolutePitchRad ?? 0, objective.gates.maximumAbsolutePitchRad, 0.5));
  gates.push(upper("pitch-rate", "maximumAbsolutePitchRateRadPerSec", candidate.metrics.maximumAbsolutePitchRateRadPerSec ?? 0, objective.gates.maximumAbsolutePitchRateRadPerSec, 3));
  gates.push(upper("body-tilt", "maximumBodyTiltRad", candidate.metrics.maximumBodyTiltRad ?? 0, objective.gates.maximumBodyTiltRad, 0.5));
  gates.push(upper("lateral-drift", "lateralDrift", candidate.metrics.lateralDrift, objective.gates.maximumLateralDrift));
  gates.push(upper("planar-velocity-tracking", "planarVelocityTrackingError", candidate.metrics.planarVelocityTrackingError, objective.gates.maximumPlanarVelocityTrackingError));
  gates.push(upper("yaw-rate-tracking", "yawRateTrackingError", candidate.metrics.yawRateTrackingError, objective.gates.maximumYawRateTrackingError));
  gates.push(upper("transition-terminal-planar", "maximumTransitionTerminalPlanarTrackingError", candidate.metrics.maximumTransitionTerminalPlanarTrackingError ?? 0, objective.gates.maximumTransitionTerminalPlanarTrackingError));
  gates.push(upper("transition-terminal-yaw", "maximumTransitionTerminalYawRateTrackingError", candidate.metrics.maximumTransitionTerminalYawRateTrackingError ?? 0, objective.gates.maximumTransitionTerminalYawRateTrackingError));
  gates.push(upper("planar-settling-time", "maximumPlanarSettlingTimeSeconds", candidate.metrics.maximumPlanarSettlingTimeSeconds ?? 0, objective.gates.maximumPlanarSettlingTimeSeconds));
  gates.push(upper("planar-braking-settling-time", "maximumPlanarBrakingSettlingTimeSeconds", candidate.metrics.maximumPlanarBrakingSettlingTimeSeconds ?? 0, objective.gates.maximumPlanarBrakingSettlingTimeSeconds));
  gates.push(upper("yaw-settling-time", "maximumYawRateSettlingTimeSeconds", candidate.metrics.maximumYawRateSettlingTimeSeconds ?? 0, objective.gates.maximumYawRateSettlingTimeSeconds));
  gates.push(upper("planar-overshoot", "maximumPlanarOvershootMps", candidate.metrics.maximumPlanarOvershootMps ?? 0, objective.gates.maximumPlanarOvershootMps));
  gates.push(upper("yaw-overshoot", "maximumYawRateOvershootRadPerSec", candidate.metrics.maximumYawRateOvershootRadPerSec ?? 0, objective.gates.maximumYawRateOvershootRadPerSec));
  gates.push(upper("unsettled-planar", "unsettledPlanarTransitionCount", candidate.metrics.unsettledPlanarTransitionCount ?? 0, objective.gates.maximumUnsettledPlanarTransitions, 1));
  gates.push(upper("unsettled-yaw", "unsettledYawRateTransitionCount", candidate.metrics.unsettledYawRateTransitionCount ?? 0, objective.gates.maximumUnsettledYawRateTransitions, 1));
  gates.push(upper("joint-jerk", "meanJointJerkRadPerSec3", candidate.metrics.meanJointJerkRadPerSec3 ?? 0, objective.gates.maximumMeanJointJerkRadPerSec3 ?? 1_000_000));
  gates.push(upper("body-angular-jerk", "meanBodyAngularJerkRadPerSec3", candidate.metrics.meanBodyAngularJerkRadPerSec3 ?? 0, objective.gates.maximumMeanBodyAngularJerkRadPerSec3 ?? 1_000_000));
  gates.push(upper("action-slew", "meanActionSlewRatePerSec", candidate.metrics.meanActionSlewRatePerSec ?? 0, objective.gates.maximumMeanActionSlewRatePerSec ?? 1_000_000));
  gates.push(upper("actuator-saturation", "actuatorSaturationRate", candidate.metrics.actuatorSaturationRate ?? 0, objective.gates.maximumActuatorSaturationRate ?? 1, 1));
  gates.push(upper("foot-slip", "meanFootSlipSpeedMps", candidate.metrics.meanFootSlipSpeedMps ?? 0, objective.gates.maximumMeanFootSlipSpeedMps ?? 1_000_000));
  gates.push(upper("foot-impact", "peakFootContactImpactNPerSec", candidate.metrics.peakFootContactImpactNPerSec ?? 0, objective.gates.maximumPeakFootContactImpactNPerSec ?? 1_000_000));
  if (baseline) gates.push(lower("score-regression", "scoreDelta", candidate.score.total - baseline.score.total, -objective.gates.maximumRegression));
  return gates;
}

function diagnosticHypotheses(violations: GateAssessment[]) {
  const hypotheses: Array<{ kind: "hypothesis"; surface: "controller" | "assembly" | "training"; description: string; rationale: string }> = [];
  if (violations.some((gate) => gate.id === "survival")) hypotheses.push({ kind: "hypothesis", surface: "controller", description: "Inspect the fall event and pre-fall trajectory before changing task performance terms.", rationale: "The measured survival gate failed; stability is prerequisite evidence." });
  if (violations.some((gate) => gate.id === "forward-progress" || gate.id === "signed-forward-progress" || gate.id === "backward-displacement")) hypotheses.push({ kind: "hypothesis", surface: "controller", description: "Inspect target-direction displacement and test gait timing, traction authority, or measured slip recovery on this fixed case.", rationale: "Survival alone did not produce the required signed target-direction progress or the robot moved backward beyond the locked allowance." });
  if (violations.some((gate) => gate.id === "backward-pitch" || gate.id === "pitch-angle" || gate.id === "pitch-rate" || gate.id === "body-tilt")) hypotheses.push({ kind: "hypothesis", surface: "controller", description: "Inspect signed pitch and yaw-invariant body tilt, then test bounded front/rear posture or foot-placement feedback before increasing gait authority.", rationale: "Backward pitch, body pitch angle/rate, or quaternion-derived torso tilt exceeded the locked stability envelope." });
  if (violations.some((gate) => gate.id === "lateral-drift")) hypotheses.push({ kind: "hypothesis", surface: "controller", description: "Test delay-aware lateral-state feedback or foot-placement recovery without changing the fixed disturbance.", rationale: "Measured lateral displacement exceeded the locked gate while the Controller owns the current recovery response." });
  if (violations.some((gate) => gate.id === "planar-velocity-tracking")) hypotheses.push({ kind: "hypothesis", surface: "controller", description: "Compare the commanded direction and speed with gait amplitude, phase, and planar feedback before changing the Task.", rationale: "The measured planar velocity error exceeded the locked command-tracking gate." });
  if (violations.some((gate) => gate.id === "yaw-rate-tracking")) hypotheses.push({ kind: "hypothesis", surface: "controller", description: "Test a bounded left-right or front-rear steering differential against measured body yaw rate.", rationale: "The measured yaw-rate error exceeded the locked command-tracking gate." });
  if (violations.some((gate) => gate.id === "transition-terminal-planar" || gate.id === "planar-settling-time" || gate.id === "planar-braking-settling-time" || gate.id === "planar-overshoot" || gate.id === "unsettled-planar")) hypotheses.push({ kind: "hypothesis", surface: "controller", description: "Inspect command-boundary rows and test bounded planar braking or command-rate state without previewing the schedule.", rationale: "The measured planar transient response ended too far from target, settled too slowly, failed to remain settled, or overshot the new command." });
  if (violations.some((gate) => gate.id === "transition-terminal-yaw" || gate.id === "yaw-settling-time" || gate.id === "yaw-overshoot" || gate.id === "unsettled-yaw")) hypotheses.push({ kind: "hypothesis", surface: "controller", description: "Inspect yaw response after the exact boundary and test bounded steering damping against current measured yaw rate.", rationale: "The measured yaw transient ended too far from target, settled too slowly, failed to remain settled, or overshot the new command." });
  if (violations.some((gate) => gate.id === "joint-jerk" || gate.id === "body-angular-jerk")) hypotheses.push({ kind: "hypothesis", surface: "controller", description: "Inspect frame-local jerk peaks, gait phase discontinuities, feedback gains, and command-boundary behavior before changing the fixed task.", rationale: "Control-grid joint or root-angular jerk exceeded the locked motion-quality envelope." });
  if (violations.some((gate) => gate.id === "action-slew" || gate.id === "actuator-saturation")) hypotheses.push({ kind: "hypothesis", surface: "controller", description: "Inspect applied-Action slew and saturation together, then test bounded output shaping, gain wind-up, delay compensation, or actuator authority.", rationale: "The applied control stream changed too quickly or spent too much time at declared control bounds." });
  if (violations.some((gate) => gate.id === "foot-slip")) hypotheses.push({ kind: "hypothesis", surface: "controller", description: "Inspect planted-foot intervals, load transfer, contact timing, and foot placement without changing the locked friction case.", rationale: "Exact MuJoCo foot-site motion while contact persisted exceeded the planted-slip gate." });
  if (violations.some((gate) => gate.id === "foot-impact")) hypotheses.push({ kind: "hypothesis", surface: "controller", description: "Inspect touchdown frames and test bounded clearance, phase timing, vertical landing speed, or joint damping.", rationale: "The positive touch-force derivative exceeded the locked contact-impact gate." });
  if (violations.some((gate) => gate.id === "score-regression")) hypotheses.push({ kind: "hypothesis", surface: "controller", description: "Compare score terms and preserve the regressed fixed-case behavior before pursuing aggregate gains.", rationale: "The case regressed beyond the locked baseline allowance." });
  return hypotheses;
}

export async function diagnoseCommand(projectDir: string, options: { assembly: string; controller: string; benchmark: string }) {
  const project = await loadProject(projectDir); const benchmark = await loadBenchmark(project.rootDir, options.benchmark); const lock = await requireBenchmarkLock(project, benchmark); const objective = await loadObjective(project.rootDir, benchmark.objective);
  const baseline = await evaluatePair(project, benchmark, benchmark.baseline.assembly, benchmark.baseline.controller); const evaluation = options.assembly === benchmark.baseline.assembly && options.controller === benchmark.baseline.controller ? baseline : await evaluatePair(project, benchmark, options.assembly, options.controller);
  const cases = evaluation.cases.map((item, index) => {
    const gates = diagnosticGates(objective, item, baseline.cases[index]); const violations = gates.filter((gate) => gate.enforced && !gate.passed); const severity = violations.reduce((sum, gate) => sum + gate.severity, 0);
    const reproduceArgv = ["simulate", project.rootDir, "--assembly", options.assembly, "--controller", options.controller, "--task", item.case.task, "--scenario", item.case.scenario, "--objective", benchmark.objective, "--seed", String(item.case.seed)];
    return { id: item.case.id, task: item.case.task, scenario: item.case.scenario, seed: item.case.seed, gating: item.case.gating, score: item.score.total, scoreDelta: item.score.total - (baseline.cases[index]?.score.total ?? item.score.total), metrics: item.metrics, gates, violations, violationSeverity: severity, findings: violations.map((gate) => ({ kind: "evidence" as const, code: `gate.${gate.id}`, metric: gate.metric, value: gate.value, comparator: gate.comparator, threshold: gate.threshold, margin: gate.margin })), hypotheses: diagnosticHypotheses(violations), reproduceArgv };
  });
  const ranked = [...cases].sort((left, right) => right.violationSeverity - left.violationSeverity || left.scoreDelta - right.scoreDelta || left.id.localeCompare(right.id)); const violations = cases.flatMap((item) => item.violations.map((gate) => ({ case: item.id, ...gate }))); const worst = ranked[0] ?? null;
  const result = { benchmark: benchmark.id, lockHash: lock.lockHash, subject: { assembly: options.assembly, controller: options.controller }, baseline: { assembly: baseline.assembly, controller: baseline.controller, aggregateScore: baseline.aggregateScore }, aggregateScore: evaluation.aggregateScore, aggregateDelta: evaluation.aggregateScore - baseline.aggregateScore, status: violations.length ? "FAIL" as const : "PASS" as const, violationCount: violations.length, violations, worstCase: worst?.id ?? null, cases: ranked };
  const nextActions = worst ? [{ id: "reproduce-worst-case", description: `Persist the worst diagnosed case '${worst.id}' for event and trajectory inspection`, argv: worst.reproduceArgv, effect: "creates-artifact" as const }, { id: "inspect-controller", description: "Inspect the Controller interface and compatible Assemblies", argv: ["controller", "inspect", project.rootDir, "--controller", options.controller], effect: "read-only" as const }] : [];
  return success("diagnose", result, project, [], nextActions);
}

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

export function researchGateReasons(objective: Awaited<ReturnType<typeof loadObjective>>, lockedBaseline: EvaluationResult, previous: EvaluationResult, candidate: EvaluationResult): string[] {
  const reasons: string[] = [];
  for (let index = 0; index < candidate.cases.length; index++) {
    const candidateCase = candidate.cases[index]; const previousCase = previous.cases[index]; const baselineCase = lockedBaseline.cases[index];
    if (candidateCase && candidateCase.case.gating === false) continue;
    if (!candidateCase || !previousCase) continue;
    const previousGates = diagnosticGates(objective, previousCase, baselineCase); const candidateGates = diagnosticGates(objective, candidateCase, baselineCase);
    for (const gate of candidateGates) {
      if (!gate.enforced || gate.passed) continue;
      const previousGate = previousGates.find((item) => item.id === gate.id);
      if (previousGate?.passed) reasons.push(`${candidateCase.case.id}: ${gate.id} regressed from passing to failing`);
    }
  }
  return reasons;
}

function researchViolationSummary(objective: Awaited<ReturnType<typeof loadObjective>>, lockedBaseline: EvaluationResult, evaluation: EvaluationResult): { count: number; severity: number } {
  let count = 0; let severity = 0;
  for (let index = 0; index < evaluation.cases.length; index++) {
    const item = evaluation.cases[index]; const baseline = lockedBaseline.cases[index]; if (!item) continue;
    for (const gate of diagnosticGates(objective, item, baseline)) if (gate.enforced && !gate.passed) { count++; severity += gate.severity; }
  }
  return { count, severity };
}

export function researchDecision(objective: Awaited<ReturnType<typeof loadObjective>>, lockedBaseline: EvaluationResult, previous: EvaluationResult, candidate: EvaluationResult, minimumImprovement: number) {
  const gateReasons = researchGateReasons(objective, lockedBaseline, previous, candidate); const previousSummary = researchViolationSummary(objective, lockedBaseline, previous); const candidateSummary = researchViolationSummary(objective, lockedBaseline, candidate); const scoreDelta = candidate.aggregateScore - previous.aggregateScore;
  const feasibilityImproved = candidateSummary.count < previousSummary.count; const sameViolationCount = candidateSummary.count === previousSummary.count; const severityImproved = sameViolationCount && candidateSummary.severity < previousSummary.severity - 1e-9; const sameSeverity = Math.abs(candidateSummary.severity - previousSummary.severity) <= 1e-9; const scoreImproved = scoreDelta >= minimumImprovement;
  const keep = gateReasons.length === 0 && (feasibilityImproved || severityImproved || (sameViolationCount && sameSeverity && scoreImproved));
  const selectionReason = keep ? (feasibilityImproved ? "fewer-gate-violations" as const : severityImproved ? "lower-gate-violation-severity" as const : "score-improvement-within-feasibility-tier" as const) : gateReasons.length ? "gate-regression" as const : "no-lexicographic-improvement" as const;
  return { verdict: keep ? "KEEP" as const : "REVERT" as const, gateReasons, previousViolationCount: previousSummary.count, candidateViolationCount: candidateSummary.count, previousViolationSeverity: previousSummary.severity, candidateViolationSeverity: candidateSummary.severity, feasibilityImproved, severityImproved, scoreImproved, selectionReason };
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
  experimentId: string; experimentHash: string; previous: EvaluationResult; candidate: EvaluationResult; scoreDelta: number; controller: ControllerDefinition; decision: ReturnType<typeof researchDecision>;
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
    await writeJson(join(directory, "evaluation.json"), { proposal: options.proposal, previous: options.previous, candidate: options.candidate, scoreDelta: options.scoreDelta, decision: options.decision });
    await writeJson(join(directory, "manifest.json"), { version: 1, id, kind: "research-optimization", parent, researchId: options.research.id, experimentId: options.experimentId, experimentHash: options.experimentHash, benchmarkId: options.benchmark.id, benchmarkLockHash: options.lockHash, assembly: options.research.assembly, assemblyHash: options.assembly.assemblyHash, controller: options.research.controller, controllerHash: hashJson(options.controller), aggregateScore: options.candidate.aggregateScore, scoreDelta: options.scoreDelta, previousViolationCount: options.decision.previousViolationCount, candidateViolationCount: options.decision.candidateViolationCount, selectionReason: options.decision.selectionReason, sourceClosure, appliedAt: new Date().toISOString() });
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
    const beforeControllerHash = hashJson(beforeDefinition); const beforeFileHash = sha256(await readFile(controllerPath)); let candidate: EvaluationResult | undefined; let errorMessage: string | undefined; let decision: ReturnType<typeof researchDecision> | undefined; let gateReasons: string[] = []; let delta = 0; let verdict: "KEEP" | "REVERT" | "CRASH" = "CRASH";
    try {
      candidate = await evaluatePair(project, benchmark, research.assembly, research.controller, candidateDefinition); delta = candidate.aggregateScore - previousEvaluation.aggregateScore; decision = researchDecision(objective, lockedBaseline, previousEvaluation, candidate, research.minimumImprovement); gateReasons = decision.gateReasons; verdict = decision.verdict;
    } catch (error) { errorMessage = error instanceof Error ? error.message : String(error); }
    const experimentHash = hashJson({ researchHash, programHash, lockHash: lock.lockHash, beforeControllerHash, proposal, candidateControllerHash, verdict, results: candidate?.cases.map((item) => item.resultHash), errorMessage });
    const experimentId = `${String(sequence).padStart(3, "0")}-${experimentHash.slice(0, 12)}`; let revision: { id: string; path: string } | undefined;
    if (verdict === "KEEP" && candidate) {
      if (sha256(await readFile(controllerPath)) !== beforeFileHash) throw new Error("Research Controller changed during evaluation; refusing stale KEEP");
      const original = beforeDefinition;
      await atomicWriteJsonFile(controllerPath, candidateDefinition);
      try { if (!decision) throw new Error("Research KEEP is missing its selection decision"); revision = await publishResearchRevision({ project, research, benchmark, lockHash: lock.lockHash, assembly, proposal, experimentId, experimentHash, previous: previousEvaluation, candidate, scoreDelta: delta, controller: candidateDefinition, decision }); }
      catch (error) { await atomicWriteJsonFile(controllerPath, original); throw error; }
      definition = candidateDefinition; current = candidate;
    }
    const artifactPath = join(researchRoot, experimentId);
    await atomicDirectory(artifactPath, async (directory) => {
      await writeJson(join(directory, "proposal.json"), proposal); await writeJson(join(directory, "before-controller.json"), beforeDefinition); await writeJson(join(directory, "candidate-controller.json"), candidateDefinition);
      if (candidate) await writeJson(join(directory, "evaluation.json"), { previous: previousEvaluation, candidate, delta, gateReasons, decision });
      if (errorMessage) await writeFile(join(directory, "error.txt"), `${errorMessage}\n`);
      await writeFile(join(directory, "report.md"), `# Research experiment ${experimentId}\n\n- Strategy: \`${proposal.strategy}\`\n- Verdict: **${verdict}**\n- Score: \`${candidate?.aggregateScore ?? 0}\`\n- Delta: \`${delta}\`\n${decision ? `- Gate violations: \`${decision.previousViolationCount} -> ${decision.candidateViolationCount}\`\n- Selection: \`${decision.selectionReason}\`\n` : ""}${revision ? `- Revision: \`${revision.id}\`\n` : ""}`);
      await writeJson(join(directory, "manifest.json"), { version: 1, id: experimentId, sequence, researchId: research.id, researchHash, programHash, benchmarkLockHash: lock.lockHash, beforeControllerHash, candidateControllerHash, proposal, strategy: proposal.strategy, score: candidate?.aggregateScore ?? 0, delta, verdict, gateReasons, decision: decision ?? null, error: errorMessage ?? null, revisionId: revision?.id ?? null, completed: true });
    });
    const description = proposal.hypothesis.replace(/[\t\r\n]+/g, " "); await appendFile(ledgerPath, `${sequence}\t${experimentId}\t${candidate?.aggregateScore ?? 0}\t${delta}\t${verdict.toLowerCase()}\t${proposal.strategy}\t${description}\n`);
    const summary = { sequence, experimentId, proposal, candidateControllerHash, score: candidate?.aggregateScore ?? 0, delta, verdict, gateReasons, decision: decision ?? null, error: errorMessage ?? null, revisionId: revision?.id ?? null, artifactPath };
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
  controller: ControllerDefinition; proposal: ResearchProposal; experimentId: string; experimentHash: string; previous: EvaluationResult; candidate: EvaluationResult; scoreDelta: number; policyId: string; decision: ReturnType<typeof researchDecision>;
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
    await writeJson(join(directory, "evaluation.json"), { proposal: options.proposal, previous: options.previous, candidate: options.candidate, scoreDelta: options.scoreDelta, decision: options.decision });
    await writeJson(join(directory, "manifest.json"), { version: 1, id, kind: "policy-optimization", parent, researchId: options.research.id, experimentId: options.experimentId, experimentHash: options.experimentHash, benchmarkId: options.benchmark.id, benchmarkLockHash: options.lockHash, assembly: options.training.assembly, assemblyHash: options.assembly.assemblyHash, controller: options.research.controller, policyId: options.policyId, policyHash, trainingHash: hashJson(options.training), aggregateScore: options.candidate.aggregateScore, scoreDelta: options.scoreDelta, previousViolationCount: options.decision.previousViolationCount, candidateViolationCount: options.decision.candidateViolationCount, selectionReason: options.decision.selectionReason, sourceClosure, appliedAt: new Date().toISOString() });
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
    let trainingResult: any; let candidate: EvaluationResult | undefined; let candidateController: ControllerDefinition | undefined; let errorMessage: string | undefined; let decision: ReturnType<typeof researchDecision> | undefined; let gateReasons: string[] = []; let delta = 0; let verdict: "KEEP" | "REVERT" | "CRASH" = "CRASH";
    try {
      trainingResult = await executeTraining(project, candidateTraining, research.seed); candidateController = { ...beforeController, policy: trainingResult.policyId } as ControllerDefinition;
      candidate = await evaluatePair(project, benchmark, candidateTraining.assembly, research.controller, candidateController); delta = candidate.aggregateScore - previous.aggregateScore; decision = researchDecision(objective, lockedBaseline, previous, candidate, research.minimumImprovement); gateReasons = decision.gateReasons; verdict = decision.verdict;
    } catch (error) { errorMessage = error instanceof Error ? error.message : String(error); }
    const experimentHash = hashJson({ researchHash, programHash, lockHash: lock.lockHash, beforeTraining: hashJson(beforeTraining), proposal, candidateTrainingHash, policyId: trainingResult?.policyId, verdict, results: candidate?.cases.map((item) => item.resultHash), errorMessage }); const experimentId = `${String(sequence).padStart(3, "0")}-${experimentHash.slice(0, 12)}`; let revision: { id: string; path: string } | undefined;
    if (verdict === "KEEP" && candidate && candidateController && trainingResult) {
      if (sha256(await readFile(trainingPath)) !== beforeTrainingFileHash || sha256(await readFile(controllerPath)) !== beforeControllerFileHash) throw new Error("Training Research inputs changed during evaluation; refusing stale KEEP");
      await atomicWriteJsonFile(trainingPath, candidateTraining); await atomicWriteJsonFile(controllerPath, candidateController);
      try {
        if (sha256(await readFile(trainingPath)) === beforeTrainingFileHash || sha256(await readFile(controllerPath)) === beforeControllerFileHash) throw new Error("Training Research KEEP did not change both promoted files");
        if (!decision) throw new Error("Training Research KEEP is missing its selection decision"); revision = await publishPolicyRevision({ project, research, benchmark, lockHash: lock.lockHash, assembly, training: candidateTraining, controller: candidateController, proposal, experimentId, experimentHash, previous, candidate, scoreDelta: delta, policyId: trainingResult.policyId, decision });
      } catch (error) { await atomicWriteJsonFile(trainingPath, beforeTraining); await atomicWriteJsonFile(controllerPath, beforeController); throw error; }
      training = candidateTraining; controller = candidateController; current = candidate;
    }
    const artifactPath = join(root, experimentId); await atomicDirectory(artifactPath, async (directory) => {
      await writeJson(join(directory, "proposal.json"), proposal); await writeJson(join(directory, "before-training.json"), beforeTraining); await writeJson(join(directory, "candidate-training.json"), candidateTraining); if (trainingResult) await writeJson(join(directory, "training-result.json"), trainingResult);
      if (candidate) await writeJson(join(directory, "evaluation.json"), { previous, candidate, delta, gateReasons, decision }); if (errorMessage) await writeFile(join(directory, "error.txt"), `${errorMessage}\n`);
      await writeJson(join(directory, "manifest.json"), { version: 1, id: experimentId, sequence, researchId: research.id, researchHash, programHash, benchmarkLockHash: lock.lockHash, trainerHash, dependencyLockHash: dependencyHash, candidateTrainingHash, proposal, strategy: proposal.strategy, policyId: trainingResult?.policyId ?? null, score: candidate?.aggregateScore ?? previous.aggregateScore, delta, verdict, gateReasons, decision: decision ?? null, error: errorMessage ?? null, policyRevisionId: revision?.id ?? null, completed: true });
    });
    const description = proposal.hypothesis.replace(/[\t\r\n]+/g, " "); await appendFile(ledgerPath, `${sequence}\t${experimentId}\t${trainingResult?.policyId ?? "-"}\t${candidate?.aggregateScore ?? previous.aggregateScore}\t${delta}\t${verdict.toLowerCase()}\t${proposal.strategy}\t${description}\n`);
    const summary = { sequence, experimentId, proposal, candidateTrainingHash, policyId: trainingResult?.policyId ?? null, score: candidate?.aggregateScore ?? previous.aggregateScore, delta, verdict, gateReasons, decision: decision ?? null, error: errorMessage ?? null, policyRevisionId: revision?.id ?? null, artifactPath }; experiments.push(summary); history.push(summary);
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
