import { appendFile, cp, mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  assertProgramControllerCompatible, atomicDirectory, compareAssemblies, compileAssembly, confined, domainProfileSchema, hashDirectory, hashJson, listAssemblyIds, listCalibrationIds, listComponentIds, listControllerIds, loadAssembly, loadBenchmark, loadCalibration, loadCandidate, loadComponent,
  listDesignStudyIds, listDomainProfileIds, listDriverPackageIds, listHardwareCapturePlanIds, loadController, loadDesignStudy, loadDevelopmentCharter, loadDomainProfile, loadDriverPackage, loadObjective, loadProject, loadResearch, loadScenario, loadTask, loadTrainer, loadTraining, loadTrainingResearch, programControllerInterfaceIssues, researchProposalSchema, sha256, stableJson, trainingSchema, validateProject, verifyCandidateChanges, writeJson,
  type BenchmarkDefinition, type CalibrationDefinition, type CompiledAssembly, type ControllerDefinition, type DesignStudyDefinition, type ProjectContext, type ResearchDefinition, type ResearchProposal, type ResearchReview, type TrainingDefinition, type TrainingResearchDefinition,
} from "@mujica/core";
import { validateProjectDefinitions } from "@mujica/core";
import { success, type Artifact } from "./contract";
import { verifyHardwareBundleIntegrity, verifyHardwareCaptureIntegrity } from "./hardware";
import { dependencyLockHash, harnessDependencyLockHash, harnessSourceHash, invokeRuntime, runtimeCompiled, runtimeSourceHash, runtimeVersion } from "./runtime";
import { writeStudioSnapshot, type ResearchTimelineInput } from "@mujica/studio";
import { loadReflexSearch } from "./reflex-artifact";
import { loadFrozenPolicyArtifact } from "./policy-artifact";

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

export function assertDomainProfilePlantCompatible(profile: { id: string; plantHash?: string | undefined }, assembly: Pick<CompiledAssembly, "id" | "plantHash">): void {
  if (profile.plantHash !== undefined && profile.plantHash !== assembly.plantHash) {
    throw new Error(`Training Domain Profile '${profile.id}' plantHash does not match Assembly '${assembly.id}'`);
  }
}

export async function controllerIdentity(projectDir: string, id: string, override?: ControllerDefinition): Promise<{ definition: ControllerDefinition; rootDir: string; hash: string; trainingSteps: number }> {
  const controller = await loadController(projectDir, id);
  const definition = override ?? controller.definition;
  if (definition.id !== id || definition.kind !== controller.definition.kind) throw new Error(`Controller override must preserve id and kind for '${id}'`);
  if (definition.kind === "program") {
    confined(controller.rootDir, definition.entry);
    const packageHash = await hashDirectory(controller.rootDir);
    return { definition, rootDir: controller.rootDir, hash: override ? hashJson({ packageHash, definition }) : packageHash, trainingSteps: 0 };
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
  const project = await loadProject(projectDir); const charter = await loadDevelopmentCharter(project.rootDir); const components = await listComponentIds(project.rootDir); const assemblies = await listAssemblyIds(project.rootDir); const controllers = await listControllerIds(project.rootDir); const designStudies = await listDesignStudyIds(project.rootDir); const domainProfiles = await listDomainProfileIds(project.rootDir); const drivers = await listDriverPackageIds(project.rootDir); const calibrations = await listCalibrationIds(project.rootDir); const capturePlans = await listHardwareCapturePlanIds(project.rootDir);
  const policies = await listManifestDirectories(join(project.rootDir, "policies")); const runs = await listManifestDirectories(join(project.rootDir, "runs")); const trainingRuns = await listManifestDirectories(join(project.rootDir, "training-runs")); const calibrationRuns = await listManifestDirectories(join(project.rootDir, "calibration-runs")); const revisions = await listManifestDirectories(join(project.rootDir, "revisions")); const policyRevisions = await listManifestDirectories(join(project.rootDir, "policy-revisions"));
  const hardwareBundles = await listManifestDirectories(join(project.rootDir, "hardware-bundles")); const hardwareVerifications = await listManifestDirectories(join(project.rootDir, "hardware-verifications")); const hardwareCaptures = await listManifestDirectories(join(project.rootDir, "hardware-captures")); const humanObservations = await listManifestDirectories(join(project.rootDir, "human-observations")); const researchBriefs = await listManifestDirectories(join(project.rootDir, "research-briefs"));
  const twinAudits = await listManifestDirectories(join(project.rootDir, "twin-audits"));
  return success("inspect", { project: project.manifest, charter, counts: { components: components.length, assemblies: assemblies.length, controllers: controllers.length, designStudies: designStudies.length, domainProfiles: domainProfiles.length, drivers: drivers.length, calibrations: calibrations.length, capturePlans: capturePlans.length, policies: policies.length, runs: runs.length, trainingRuns: trainingRuns.length, calibrationRuns: calibrationRuns.length, revisions: revisions.length, policyRevisions: policyRevisions.length, hardwareBundles: hardwareBundles.length, hardwareVerifications: hardwareVerifications.length, hardwareCaptures: hardwareCaptures.length, twinAudits: twinAudits.length, humanObservations: humanObservations.length, researchBriefs: researchBriefs.length }, components, assemblies, controllers, designStudies, domainProfiles, drivers, calibrations, capturePlans, policies, runs, trainingRuns, calibrationRuns, revisions, policyRevisions, hardwareBundles, hardwareVerifications, hardwareCaptures, twinAudits, humanObservations, researchBriefs }, project);
}

export async function driverListCommand(projectDir: string) {
  const project = await loadProject(projectDir); const drivers = [];
  for (const id of await listDriverPackageIds(project.rootDir)) {
    const driver = await loadDriverPackage(project.rootDir, id);
    drivers.push({
      definition: driver.definition,
      packageHash: await hashDirectory(driver.rootDir),
      executableHash: sha256(await readFile(confined(driver.rootDir, driver.definition.executable))),
      rootDir: driver.rootDir,
    });
  }
  return success("driver.list", { drivers }, project);
}

export async function driverInspectCommand(projectDir: string, id: string) {
  const project = await loadProject(projectDir); const driver = await loadDriverPackage(project.rootDir, id);
  return success("driver.inspect", {
    definition: driver.definition,
    packageHash: await hashDirectory(driver.rootDir),
    executableHash: sha256(await readFile(confined(driver.rootDir, driver.definition.executable))),
    rootDir: driver.rootDir,
  }, project);
}

export async function studioCommand(
  projectDir: string,
  run?: string,
  compareRun?: string,
  researchReview?: { review: ResearchReview; reviewHash: string },
  researchTimeline?: Omit<ResearchTimelineInput, "entries"> & {
    entries: Array<{ review: ResearchReview; reviewHash: string }>;
  },
  authorityCounterfactual?: Record<string, any>,
) {
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

  const replayByRun = new Map<string, Awaited<ReturnType<typeof render>>>();
  const renderOnce = async (selectedRunId: string) => {
    const cached = replayByRun.get(selectedRunId);
    if (cached) return cached;
    const rendered = await render(selectedRunId);
    replayByRun.set(selectedRunId, rendered);
    return rendered;
  };
  const replay = await renderOnce(runId);
  const comparisonReplay = compareRun ? await renderOnce(compareRun) : null;
  const timelineEntries = [];
  for (const entry of researchTimeline?.entries ?? []) {
    timelineEntries.push({
      ...entry,
      acceptedReplay: await renderOnce(entry.review.accepted.id).then((rendered) => ({ path: rendered.path, manifest: rendered.manifest })),
      candidateReplay: await renderOnce(entry.review.candidate.id).then((rendered) => ({ path: rendered.path, manifest: rendered.manifest })),
    });
  }
  const result = await writeStudioSnapshot(project.rootDir, {
    run: runId, replay: { path: replay.path, manifest: replay.manifest },
    ...(compareRun && comparisonReplay ? { compareRun, compareReplay: { path: comparisonReplay.path, manifest: comparisonReplay.manifest } } : {}),
    ...(researchReview ? { researchReview } : {}),
    ...(researchTimeline ? { researchTimeline: { ...researchTimeline, entries: timelineEntries } } : {}),
    ...(authorityCounterfactual ? { authorityCounterfactual } : {}),
  });
  const artifacts = [
    ...[...replayByRun.values()].map((rendered) => projectArtifact("simulation-replay", rendered.id, rendered.path, true)),
    projectArtifact("studio-snapshot", result.id, result.path, false),
  ];
  return success("studio", {
    id: result.id, snapshotHash: result.snapshotHash, path: result.path, indexPath: result.indexPath, selectedRun: result.selectedRun, comparisonRun: result.comparisonRun,
    replay: { id: replay.id, path: replay.path, frameCount: replay.manifest.frameCount, cached: replay.cached },
    comparisonReplay: comparisonReplay ? { id: comparisonReplay.id, path: comparisonReplay.path, frameCount: comparisonReplay.manifest.frameCount, cached: comparisonReplay.cached } : null,
    researchReview: researchReview ? { experimentId: researchReview.review.lineage.experimentId, reviewHash: researchReview.reviewHash } : null,
    researchTimeline: researchTimeline ? { labId: researchTimeline.labId, selectedKey: researchTimeline.selectedKey, reviewCount: timelineEntries.length } : null,
    authorityCounterfactual: authorityCounterfactual ? { id: authorityCounterfactual.id, case: authorityCounterfactual.case.id } : null,
  }, project, artifacts);
}

export async function studioCaptureCommand(projectDir: string, captureId: string, episodeId: string) {
  const project = await loadProject(projectDir);
  const captureRoot = confined(project.rootDir, `hardware-captures/${captureId}`);
  const capture = await verifyHardwareCaptureIntegrity(captureRoot);
  const episode = (capture.episodes ?? []).find((item: any) => item.id === episodeId);
  if (!episode) throw new Error(`Hardware Capture '${captureId}' has no episode '${episodeId}'`);
  if (episode.completed !== true || typeof episode.path !== "string" || typeof episode.hash !== "string") {
    throw new Error(`Hardware Capture episode '${episodeId}' is not a completed immutable episode`);
  }
  const trajectoryPath = confined(captureRoot, episode.path);
  const trajectoryHash = sha256(await readFile(trajectoryPath));
  if (trajectoryHash !== episode.hash) throw new Error(`Hardware Capture episode '${episodeId}' bytes changed`);

  const bundleCandidates = [];
  const bundlesRoot = join(project.rootDir, "hardware-bundles");
  for (const entry of await readdir(bundlesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const manifestPath = join(bundlesRoot, entry.name, "manifest.json");
    if (!(await exists(manifestPath))) continue;
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (manifest.bundleHash === capture.bundleHash) bundleCandidates.push({ root: join(bundlesRoot, entry.name), manifest });
  }
  if (bundleCandidates.length !== 1) {
    throw new Error(`Hardware Capture '${captureId}' requires exactly one matching frozen Hardware Bundle; found ${bundleCandidates.length}`);
  }
  const bundle = bundleCandidates[0]!;
  await verifyHardwareBundleIntegrity(bundle.root, bundle.manifest);
  const compiledPath = join(bundle.root, "revision", "compiled", "compiled-assembly.json");
  const modelPath = join(bundle.root, "revision", "compiled", "model.xml");
  const compiled = JSON.parse(await readFile(compiledPath, "utf8"));
  const modelHash = sha256(await readFile(modelPath));
  if (
    compiled.assemblyHash !== bundle.manifest.assemblyHash
    || modelHash !== bundle.manifest.modelXmlHash
    || capture.assemblyHash !== bundle.manifest.assemblyHash
  ) throw new Error("Hardware Capture and frozen Bundle digital twin identities differ");
  let stateContractHash: string;
  let stateContractAuthority: "bundle-frozen" | "derived-from-frozen-model";
  if (typeof bundle.manifest.stateContractHash === "string") {
    const stateContract = JSON.parse(await readFile(join(bundle.root, "state-contract.json"), "utf8"));
    stateContractHash = hashJson(stateContract);
    if (stateContractHash !== bundle.manifest.stateContractHash) throw new Error("Hardware Bundle State ABI bytes changed");
    stateContractAuthority = "bundle-frozen";
  } else {
    const described = await invokeRuntime("describe-state", {
      assembly: compiled.id,
      assemblyHash: bundle.manifest.assemblyHash,
      modelHash,
      modelPath,
    });
    stateContractHash = described.stateContractHash;
    if (stateContractHash !== hashJson(described.stateContract)) throw new Error("Derived legacy Hardware State ABI identity is invalid");
    stateContractAuthority = "derived-from-frozen-model";
  }

  const settings = { width: 640, height: 480, stride: 1, camera: { azimuth: 135, elevation: -22, distance: 2.2 } };
  const replay = await invokeRuntime("render-replay", {
    runtimeVersion,
    runtimeSourceHash: await runtimeSourceHash(),
    source: {
      kind: "hardware-capture-episode",
      captureId: capture.id,
      captureHash: capture.captureHash,
      bundleId: bundle.manifest.id,
      bundleHash: bundle.manifest.bundleHash,
      episodeId: episode.id,
      episodeHash: episode.hash,
      environment: capture.environment,
      mode: capture.mode,
    },
    assemblyHash: bundle.manifest.assemblyHash,
    modelHash,
    modelPath,
    trajectoryPath,
    trajectoryHash,
    outputRoot: join(project.rootDir, ".mujica", "replays"),
    settings,
  });
  const result = await writeStudioSnapshot(project.rootDir, {
    hardwareCapture: {
      path: captureRoot,
      manifest: capture,
      episodeId,
      bundle: {
        id: bundle.manifest.id,
        bundleHash: bundle.manifest.bundleHash,
        sourceKind: bundle.manifest.sourceKind ?? "legacy-robot-revision",
        maximumCaptureMode: bundle.manifest.maximumCaptureMode ?? "actuate",
        assemblyHash: bundle.manifest.assemblyHash,
        modelHash,
        stateContractHash,
        stateContractAuthority,
      },
      replay: { path: replay.path, manifest: replay.manifest },
    },
  });
  return success("studio", {
    id: result.id,
    snapshotHash: result.snapshotHash,
    path: result.path,
    indexPath: result.indexPath,
    selectedRun: null,
    comparisonRun: null,
    hardwareCapture: {
      id: capture.id,
      captureHash: capture.captureHash,
      episodeId: episode.id,
      episodeHash: episode.hash,
      environment: capture.environment,
      mode: capture.mode,
    },
    replay: { id: replay.id, path: replay.path, frameCount: replay.manifest.frameCount, cached: replay.cached },
    comparisonReplay: null,
    researchReview: null,
  }, project, [
    projectArtifact("hardware-replay", replay.id, replay.path, true),
    projectArtifact("studio-snapshot", result.id, result.path, false),
  ]);
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
      if (source.kind === "capture") sourceHashes.push({ ...source, hash: sha256(await readFile(confined(project.rootDir, source.path))) });
      else if (source.kind === "simulation-run") sourceHashes.push({ ...source, hash: sha256(await readFile(confined(project.rootDir, `runs/${source.run}/manifest.json`))) });
      else {
        const root = confined(project.rootDir, `hardware-captures/${source.capture}`); const manifest = await verifyHardwareCaptureIntegrity(root); const episode = manifest.episodes?.find((item: any) => item.id === source.episode);
        if (!episode) throw new Error(`Hardware Capture '${source.capture}' has no episode '${source.episode}'`);
        sourceHashes.push({ ...source, manifestHash: sha256(await readFile(join(root, "manifest.json"))), hash: sha256(await readFile(confined(root, episode.path))) });
      }
    }
    calibrations.push({ definition, sourceHashes, hash: hashJson({ definition, sourceHashes }) });
  }
  return success("calibration.list", { calibrations }, project);
}

export async function calibrationInspectCommand(projectDir: string, id: string) {
  const project = await loadProject(projectDir); const definition = await loadCalibration(project.rootDir, id);
  const sourceHashes = [];
  for (const source of definition.sources) {
    if (source.kind === "capture") sourceHashes.push({ ...source, hash: sha256(await readFile(confined(project.rootDir, source.path))) });
    else if (source.kind === "simulation-run") sourceHashes.push({ ...source, hash: sha256(await readFile(confined(project.rootDir, `runs/${source.run}/manifest.json`))) });
    else {
      const root = confined(project.rootDir, `hardware-captures/${source.capture}`); const manifest = await verifyHardwareCaptureIntegrity(root); const episode = manifest.episodes?.find((item: any) => item.id === source.episode);
      if (!episode) throw new Error(`Hardware Capture '${source.capture}' has no episode '${source.episode}'`);
      sourceHashes.push({ ...source, manifestHash: sha256(await readFile(join(root, "manifest.json"))), hash: sha256(await readFile(confined(root, episode.path))) });
    }
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
    if (source.kind === "hardware-capture") {
      const root = confined(project.rootDir, `hardware-captures/${source.capture}`); const manifestPath = join(root, "manifest.json"); const manifest = await verifyHardwareCaptureIntegrity(root);
      if (manifest.id !== source.capture || manifest.completed !== true || manifest.status !== "COMPLETED" || manifest.calibrationEligible !== true) throw new Error(`Hardware Capture '${source.capture}' is not calibration-eligible`);
      if ((manifest.mode ?? "actuate") !== "actuate" || manifest.actuationAuthorized === false) throw new Error(`Hardware Capture '${source.capture}' did not execute authorized Actions`);
      if (manifest.executionHash !== assembly.executionHash || manifest.modelHash !== assembly.modelHash) throw new Error(`Hardware Capture '${source.capture}' executable Assembly differs from '${assembly.id}'`);
      const expectedEnvironment = definition.provenance.kind === "synthetic" ? "dry-run" : definition.provenance.kind;
      if (manifest.environment !== expectedEnvironment) throw new Error(`Hardware Capture '${source.capture}' environment '${manifest.environment}' cannot support '${definition.provenance.kind}' Calibration`);
      if (definition.provenance.device && stableJson(definition.provenance.device) !== stableJson(manifest.device)) throw new Error(`Hardware Capture '${source.capture}' device differs from Calibration provenance`);
      const episode = manifest.episodes?.find((item: any) => item.id === source.episode);
      if (!episode || episode.completed !== true) throw new Error(`Hardware Capture '${source.capture}' has no completed episode '${source.episode}'`);
      const path = confined(root, episode.path); const hash = sha256(await readFile(path));
      if (hash !== episode.hash) throw new Error(`Hardware Capture '${source.capture}' episode '${source.episode}' hash differs`);
      sources.push({ kind: "capture", id: `${source.capture}-${source.episode}`, capture: source.capture, episode: source.episode, path, hash, manifestHash: sha256(await readFile(manifestPath)), captureHash: manifest.captureHash, environment: manifest.environment, device: manifest.device });
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
  if (manifest.assemblyHash !== assembly.assemblyHash || manifest.modelHash !== assembly.modelHash || (manifest.plantHash !== undefined && manifest.plantHash !== assembly.plantHash)) throw new Error(`Calibration Run '${runId}' model differs from the current Calibration Assembly`);
  const baseScenario = await loadScenario(project.rootDir, calibration.scenario);
  if (manifest.calibrationHash !== hashJson(calibration) || manifest.baseScenarioHash !== hashJson(baseScenario)) throw new Error(`Calibration Run '${runId}' definition or base Scenario changed; rerun Calibration before promotion`);
  const currentSources = (await calibrationRuntimeSources(project, calibration, assembly)).map((source) => Object.fromEntries(Object.entries(source).filter(([key]) => !key.endsWith("Path") && key !== "path")));
  if (stableJson(currentSources) !== stableJson(manifest.sources)) throw new Error(`Calibration Run '${runId}' source evidence changed; rerun Calibration before promotion`);
  const profile = domainProfileSchema.parse(JSON.parse(await readFile(join(root, "profile-proposal.json"), "utf8")));
  if (hashJson(profile) !== manifest.profileProposalHash) throw new Error(`Calibration Run '${runId}' Profile proposal hash differs from its manifest`);
  assertDomainProfilePlantCompatible(profile, assembly);
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

export async function designRenderCommand(projectDir: string, id: string) {
  const project = await loadProject(projectDir);
  const assembly = await compileAssembly(project.rootDir, id);
  const preview = await invokeRuntime("render-design-preview", {
    runtimeVersion,
    runtimeSourceHash: await runtimeSourceHash(),
    assembly: assembly.id,
    assemblyHash: assembly.assemblyHash,
    modelHash: assembly.modelHash,
    modelPath: assembly.modelPath,
    baseBody: assembly.morphology.baseBody,
    outputRoot: join(project.rootDir, ".mujica", "design-previews"),
    settings: {
      width: 640,
      height: 480,
      cameraDistance: 2.2,
    },
  });
  const primaryImage = preview.manifest.images.find(
    (image: { id: string }) => image.id === "home-isometric",
  );
  return success("design.render", {
    id: preview.id,
    path: preview.path,
    cached: preview.cached,
    assembly: {
      id: assembly.id,
      assemblyHash: assembly.assemblyHash,
      base: assembly.baseId,
      components: assembly.components.map((component) => ({
        instance: component.instanceId,
        component: component.componentId,
        mount: component.mount,
      })),
      totalMassKg: assembly.totalMassKg,
      observationSize: assembly.observationContract.size,
      actionSize: assembly.actionContract.size,
    },
    modelFacts: preview.manifest.modelFacts,
    images: preview.manifest.images,
    primaryImagePath: primaryImage
      ? join(preview.path, primaryImage.file)
      : null,
    authorityBoundary: preview.manifest.authorityBoundary,
  }, project, [
    projectArtifact("design-preview", preview.id, preview.path, false),
  ]);
}

export async function designAnalyzeCommand(
  projectDir: string,
  id: string,
  options: { samples?: number } = {},
) {
  const project = await loadProject(projectDir);
  const assembly = await compileAssembly(project.rootDir, id);
  const samples = options.samples ?? 2_048;
  if (!Number.isInteger(samples) || samples < 128 || samples > 65_536) {
    throw new Error("Design Analysis samples must be an integer between 128 and 65536");
  }
  const result = await invokeRuntime("analyze-design", {
    runtimeVersion,
    runtimeSourceHash: await runtimeSourceHash(),
    assembly: assembly.id,
    assemblyHash: assembly.assemblyHash,
    modelHash: assembly.modelHash,
    modelPath: assembly.modelPath,
    baseBody: assembly.morphology.baseBody,
    contactPoints: assembly.morphology.contactPoints.map((contact) => ({
      id: contact.id,
      site: contact.site,
    })),
    outputRoot: join(project.rootDir, ".mujica", "design-analyses"),
    settings: {
      samples,
      contactToleranceM: 0.03,
      floorClearanceM: 0.002,
      minimumSupportContacts: Math.min(
        2,
        assembly.morphology.contactPoints.length,
      ),
      width: 640,
      height: 480,
      cameraDistance: 2.2,
    },
  }, 120_000);
  return success("design.analyze", {
    id: result.id,
    path: result.path,
    cached: result.cached,
    assembly: {
      id: assembly.id,
      assemblyHash: assembly.assemblyHash,
      base: assembly.baseId,
      contactPoints: assembly.morphology.contactPoints,
      actionSize: assembly.actionContract.size,
    },
    screeningOutcome: result.analysis.screeningOutcome,
    homeSupport: result.analysis.homeSupport,
    restingPoses: result.analysis.restingPoses,
    limitations: result.analysis.limitations,
    authorityBoundary: result.analysis.authorityBoundary,
    images: result.manifest.images.map((image: { file: string }) => ({
      ...image,
      path: join(result.path, image.file),
    })),
    htmlPath: join(result.path, "index.html"),
    reportPath: join(result.path, "report.md"),
    analysisPath: join(result.path, "analysis.json"),
  }, project, [
    projectArtifact("design-analysis", result.id, result.path, false),
  ]);
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function designStudyReport(study: DesignStudyDefinition, result: any): string {
  const rows = result.candidates.map((candidate: any) => {
    const contacts = candidate.restingPoses
      .map((pose: any) => `${pose.pose}:${pose.actual}/${pose.minimum}`)
      .join(", ");
    return `| \`${candidate.id}\` | \`${candidate.assembly}\` | \`${candidate.verdict}\` | ${candidate.homeSupport.actual}/${candidate.homeSupport.minimum} | ${contacts} |`;
  });
  return [
    `# Design Study ${study.id}`,
    "",
    study.question,
    "",
    `Outcome: **${result.outcome}**`,
    "",
    "| Candidate | Assembly | Screening verdict | Home | Resting poses |",
    "| --- | --- | --- | ---: | --- |",
    ...rows,
    "",
    "## Authority boundary",
    "",
    "This study compares deterministic sampled kinematic screens. A passing",
    "candidate is not dynamically validated, accepted, promoted, or supported by",
    "physical hardware evidence.",
    "",
  ].join("\n");
}

function designStudyHtml(study: DesignStudyDefinition, result: any): string {
  const candidateCards = result.candidates.map((candidate: any) => {
    const poseCards = candidate.restingPoses.map((pose: any) => (
      `<figure><img src="${escapeHtml(pose.imageRelativePath)}" alt="${escapeHtml(candidate.id)} ${escapeHtml(pose.pose)}">`
      + `<figcaption><span>${escapeHtml(pose.pose)}</span><strong class="${pose.passed ? "pass" : "fail"}">${pose.actual}/${pose.minimum} feet</strong></figcaption></figure>`
    )).join("");
    return `<article class="candidate"><header><div><div class="eyebrow">${escapeHtml(candidate.role)} · ${escapeHtml(candidate.assembly)}</div>`
      + `<h2>${escapeHtml(candidate.id)}</h2></div><div class="verdict ${candidate.verdict === "SUPPORTED_WITHIN_SCREEN" ? "pass" : "fail"}">${escapeHtml(candidate.verdict)}</div></header>`
      + `<p class="hypothesis">${escapeHtml(candidate.hypothesis)}</p>`
      + `<div class="home"><span>Authored home</span><strong class="${candidate.homeSupport.passed ? "pass" : "fail"}">${candidate.homeSupport.actual}/${candidate.homeSupport.minimum} feet</strong></div>`
      + `<div class="poses">${poseCards}</div><details><summary>Falsification rule and failed checks</summary>`
      + `<p>${escapeHtml(candidate.falsifiedIf)}</p><ul>${candidate.failedChecks.map((check: string) => `<li>${escapeHtml(check)}</li>`).join("") || "<li>None within this screen.</li>"}</ul></details></article>`;
  }).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(study.name)}</title><style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#090c11;color:#eef3f8}*{box-sizing:border-box}body{margin:0;padding:38px;background:radial-gradient(circle at 20% 0,#17243b 0,#090c11 36%);min-height:100vh}.wrap{max-width:1500px;margin:auto}.eyebrow{font:700 11px ui-monospace,monospace;letter-spacing:.13em;text-transform:uppercase;color:#8fa4c2}.hero{display:flex;justify-content:space-between;gap:30px;align-items:end;margin-bottom:28px}h1{font-size:clamp(32px,6vw,68px);line-height:.95;margin:10px 0}.question{max-width:800px;color:#bac6d4;font-size:18px;line-height:1.55}.verdict{font:800 12px ui-monospace,monospace;border:1px solid #34445b;border-radius:999px;padding:10px 13px}.pass{color:#67e3ac}.fail{color:#ff8989}.candidate{background:#111722;border:1px solid #263143;border-radius:18px;padding:20px;margin:18px 0}.candidate header{display:flex;justify-content:space-between;gap:16px;align-items:start}.candidate h2{font-size:27px;margin:7px 0}.hypothesis{color:#c5cfdb;line-height:1.55;max-width:1000px}.home{display:flex;justify-content:space-between;padding:13px 0;border-top:1px solid #293344}.poses{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}figure{margin:0;background:#090c11;border-radius:12px;overflow:hidden;border:1px solid #222d3c}figure img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover}figcaption{display:flex;justify-content:space-between;gap:8px;padding:10px;font:700 11px ui-monospace,monospace}details{margin-top:14px;color:#acb8c8;line-height:1.5}.boundary{margin-top:22px;padding:18px;border-left:3px solid #6d87ad;background:#111722;color:#b8c3d1}@media(max-width:900px){body{padding:20px}.hero{display:block}.poses{grid-template-columns:repeat(2,1fr)}}@media(max-width:520px){.poses{grid-template-columns:1fr}.candidate header{display:block}}
</style></head><body><main class="wrap"><header class="hero"><div><div class="eyebrow">Mujica · Design Study</div><h1>${escapeHtml(study.name)}</h1><p class="question">${escapeHtml(study.question)}</p></div><div class="verdict ${result.outcome === "NO_CANDIDATE_PASSED" ? "fail" : "pass"}">${escapeHtml(result.outcome)}</div></header>${candidateCards}<aside class="boundary"><strong>Authority boundary.</strong> This gallery compares sampled kinematic screens. It does not establish dynamic recovery, accept a design, promote a candidate, or provide physical evidence.</aside></main></body></html>`;
}

export function evaluateDesignStudyPose(measured: any, minimum: number) {
  const collisionFree = measured.bestCollisionFree ?? (
    measured.best.selfCollisionPairs.length === 0
      ? measured.best
      : null
  );
  const actual = collisionFree?.simultaneousFootContacts ?? 0;
  const passed = (
    measured.screeningOutcome === "CONTACT_OPPORTUNITY"
    && actual >= minimum
  );
  return {
    actual,
    passed,
    collisionFree: collisionFree !== null,
    rawContactCount: measured.bestRaw?.simultaneousFootContacts
      ?? measured.bestRawContactCount
      ?? measured.best.simultaneousFootContacts,
    secondFootContactGapM: collisionFree?.secondFootContactGapM ?? null,
    failedCheck: passed
      ? null
      : (
          collisionFree
            ? `collision-free contacts ${actual} < ${minimum}`
            : "has no collision-free sample in the declared budget"
        ),
  };
}

export async function designStudyCommand(projectDir: string, id: string) {
  const project = await loadProject(projectDir);
  const study = await loadDesignStudy(project.rootDir, id);
  if (study.id !== id) throw new Error(`Design Study id '${study.id}' must match filename '${id}'`);
  const candidates: any[] = [];
  for (const candidate of study.candidates) {
    const analysisEnvelope = await designAnalyzeCommand(project.rootDir, candidate.assembly, { samples: study.samples });
    const analysis: any = analysisEnvelope.data;
    const failedChecks: string[] = [];
    const homeMinimum = candidate.expectations.homeSupportMinimumContacts;
    if (analysis.homeSupport.simultaneousFootContacts < homeMinimum) {
      failedChecks.push(`home contacts ${analysis.homeSupport.simultaneousFootContacts} < ${homeMinimum}`);
    }
    const restingPoses = Object.entries(candidate.expectations.restingPoseMinimumContacts).map(([pose, minimum]) => {
      const measured = analysis.restingPoses.find((item: any) => item.id === pose);
      if (!measured) throw new Error(`Design Analysis for '${candidate.assembly}' omitted pose '${pose}'`);
      const evaluated = evaluateDesignStudyPose(measured, minimum);
      if (evaluated.failedCheck) {
        failedChecks.push(`${pose} ${evaluated.failedCheck}`);
      }
      return {
        pose,
        actual: evaluated.actual,
        minimum,
        passed: evaluated.passed,
        screeningOutcome: measured.screeningOutcome,
        collisionFree: evaluated.collisionFree,
        rawContactCount: evaluated.rawContactCount,
        secondFootContactGapM: evaluated.secondFootContactGapM,
        imageRelativePath: `../../design-analyses/${analysis.id}/${measured.image}`,
      };
    });
    candidates.push({
      ...candidate,
      analysisId: analysis.id,
      analysisHash: sha256(await readFile(analysis.analysisPath)),
      screeningOutcome: analysis.screeningOutcome,
      homeSupport: {
        actual: analysis.homeSupport.simultaneousFootContacts,
        minimum: homeMinimum,
        passed: analysis.homeSupport.simultaneousFootContacts >= homeMinimum,
      },
      restingPoses,
      failedChecks,
      verdict: failedChecks.length === 0 ? "SUPPORTED_WITHIN_SCREEN" : "FALSIFIED_WITHIN_SCREEN",
    });
  }
  const result = {
    version: 1,
    kind: "mujica-design-study-result",
    harnessSourceHash: await harnessSourceHash(),
    study: study.id,
    studyHash: hashJson(study),
    question: study.question,
    samples: study.samples,
    candidates,
    outcome: candidates.some((candidate) => candidate.verdict === "SUPPORTED_WITHIN_SCREEN")
      ? "CANDIDATE_PASSED_SCREEN"
      : "NO_CANDIDATE_PASSED",
    authorityBoundary: study.authorityBoundary,
  };
  const artifactId = `design-study-${hashJson(result).slice(0, 16)}`;
  const target = join(project.rootDir, ".mujica", "design-studies", artifactId);
  let cached = await exists(join(target, "manifest.json"));
  if (!cached) {
    await atomicDirectory(target, async (directory) => {
      await writeJson(join(directory, "result.json"), result);
      await writeFile(join(directory, "report.md"), designStudyReport(study, result));
      await writeFile(join(directory, "index.html"), designStudyHtml(study, result));
      await writeJson(join(directory, "manifest.json"), {
        version: 1,
        id: artifactId,
        kind: result.kind,
        study: study.id,
        studyHash: result.studyHash,
        resultHash: sha256(await readFile(join(directory, "result.json"))),
        reportHash: sha256(await readFile(join(directory, "report.md"))),
        htmlHash: sha256(await readFile(join(directory, "index.html"))),
        analysisIds: candidates.map((candidate) => candidate.analysisId),
        authorityBoundary: study.authorityBoundary,
        completed: true,
      });
    });
  } else {
    const manifest = JSON.parse(await readFile(join(target, "manifest.json"), "utf8"));
    for (const [file, key] of [["result.json", "resultHash"], ["report.md", "reportHash"], ["index.html", "htmlHash"]] as const) {
      if (sha256(await readFile(join(target, file))) !== manifest[key]) throw new Error(`Design Study '${artifactId}' failed artifact integrity verification`);
    }
    if (manifest.studyHash !== result.studyHash || stableJson(manifest.analysisIds) !== stableJson(candidates.map((candidate) => candidate.analysisId))) {
      throw new Error(`Design Study '${artifactId}' identity is inconsistent`);
    }
  }
  await writeJson(join(project.rootDir, ".mujica", "design-studies", "current.json"), {
    version: 1,
    id: artifactId,
    study: study.id,
  });
  return success("design.study", {
    id: artifactId,
    path: target,
    cached,
    study,
    outcome: result.outcome,
    candidates,
    resultPath: join(target, "result.json"),
    reportPath: join(target, "report.md"),
    htmlPath: join(target, "index.html"),
    authorityBoundary: result.authorityBoundary,
  }, project, [projectArtifact("design-study", artifactId, target, false)]);
}

function dynamicProbeSupportFeet(frame: any): number {
  const reported = Number(frame?.controllerTelemetry?.supportFeet);
  if (Number.isFinite(reported)) return reported;
  return Array.isArray(frame?.footContactForce)
    ? frame.footContactForce.filter((value: unknown) => Number(value) >= 1).length
    : 0;
}

function dynamicProbeWitness(frame: any) {
  return {
    timeSeconds: Number(frame.time),
    phase: String(frame.controllerPhase ?? frame.controllerTelemetry?.phase ?? "unreported"),
    bodyTiltRad: Number(frame.bodyTiltRad),
    baseHeightM: Number(frame.qpos?.[2] ?? 0),
    supportFeet: dynamicProbeSupportFeet(frame),
    jointLimitMarginRad: Number(frame.jointLimitMarginRad),
    footHeightsM: Array.isArray(frame.footPositionWorld)
      ? frame.footPositionWorld.map((position: unknown[]) => Number(position?.[2]))
      : [],
  };
}

export function diagnoseDynamicProbeTrajectory(
  frames: any[],
  passed: boolean,
  expectations: {
    maximumDisallowedCollisionSteps: number;
    minimumJointLimitMarginRad: number;
  },
  reorientationThresholdRad = 0.35,
) {
  if (frames.length === 0) throw new Error("Dynamic Design Probe trajectory is empty");
  const phases = new Map<string, any[]>();
  for (const frame of frames) {
    const phase = String(frame.controllerPhase ?? frame.controllerTelemetry?.phase ?? "unreported");
    phases.set(phase, [...(phases.get(phase) ?? []), frame]);
  }
  const bestTiltFrame = frames.reduce((best, frame) =>
    Number(frame.bodyTiltRad) < Number(best.bodyTiltRad) ? frame : best);
  const bestSupportFrame = frames.reduce((best, frame) =>
    dynamicProbeSupportFeet(frame) > dynamicProbeSupportFeet(best) ? frame : best);
  const finalFrame = frames.at(-1)!;
  const minimumTiltRad = Number(bestTiltFrame.bodyTiltRad);
  const maximumSupportFeet = dynamicProbeSupportFeet(bestSupportFrame);
  const finalSupportFeet = dynamicProbeSupportFeet(finalFrame);
  const minimumJointLimitMarginRad = Math.min(...frames.map((frame) =>
    Number(frame.jointLimitMarginRad)));
  const disallowedCollisionSteps = frames.filter((frame) =>
    Boolean(frame.disallowedSelfContact)).length;
  const failureModes: string[] = [];
  if (passed) {
    failureModes.push("RECOVERED");
  } else {
    if (disallowedCollisionSteps > expectations.maximumDisallowedCollisionSteps) {
      failureModes.push("DISALLOWED_CONTACT");
    }
    if (minimumJointLimitMarginRad < expectations.minimumJointLimitMarginRad) {
      failureModes.push("JOINT_LIMIT_BOUNDARY");
    }
    if (minimumTiltRad > reorientationThresholdRad) {
      failureModes.push("REORIENTATION_NOT_ACHIEVED");
    }
    if (maximumSupportFeet < 2) {
      failureModes.push("NO_FOOT_SUPPORT");
    } else if (maximumSupportFeet >= 4 && finalSupportFeet < 2) {
      failureModes.push("SUPPORT_LOST_AFTER_CONTACT");
    }
    if (
      minimumTiltRad <= reorientationThresholdRad
      && Number(finalFrame.bodyTiltRad) > reorientationThresholdRad
    ) {
      failureModes.push("REORIENTATION_NOT_RETAINED");
    }
    if (failureModes.length === 0) failureModes.push("UNSTABLE_FINAL_STATE");
  }
  const nextQuestion = failureModes.includes("SUPPORT_LOST_AFTER_CONTACT")
    ? "Can the plant-to-rise transition retain foot support instead of retracting into the failed basin?"
    : failureModes.includes("NO_FOOT_SUPPORT")
      ? "Can morphology or readable contact-seeking logic create at least two supporting feet before rise?"
      : failureModes.includes("REORIENTATION_NOT_RETAINED")
        ? "Can the candidate retain its reoriented pose while building a stable support polygon?"
        : failureModes.includes("DISALLOWED_CONTACT") || failureModes.includes("JOINT_LIMIT_BOUNDARY")
          ? "Can the same mechanism stay inside collision and joint-limit gates without relaxing them?"
          : passed
            ? "Does the demonstrated mechanism survive the complete locked Mission and regression set?"
            : "Which morphology or controller change can produce stable standing from the closest witness?";
  return {
    primaryFailureMode: failureModes[0],
    failureModes,
    mechanismSignals: {
      reorientationObserved: minimumTiltRad <= reorientationThresholdRad,
      fourFootSupportObserved: maximumSupportFeet >= 4,
      stableStandObserved: passed,
      collisionSafe: disallowedCollisionSteps <= expectations.maximumDisallowedCollisionSteps,
      jointLimitSafe: minimumJointLimitMarginRad >= expectations.minimumJointLimitMarginRad,
    },
    witnesses: {
      closestToUpright: dynamicProbeWitness(bestTiltFrame),
      maximumSupport: dynamicProbeWitness(bestSupportFrame),
      final: dynamicProbeWitness(finalFrame),
    },
    phases: [...phases.entries()].map(([phase, rows]) => ({
      phase,
      fromSeconds: Number(rows[0].time),
      toSeconds: Number(rows.at(-1).time),
      minimumBodyTiltRad: Math.min(...rows.map((row) => Number(row.bodyTiltRad))),
      maximumSupportFeet: Math.max(...rows.map(dynamicProbeSupportFeet)),
      minimumJointLimitMarginRad: Math.min(...rows.map((row) => Number(row.jointLimitMarginRad))),
      disallowedCollisionSteps: rows.filter((row) => Boolean(row.disallowedSelfContact)).length,
    })),
    nextQuestion,
  };
}

export function routeDynamicProbeDevelopment(scenarios: any[], gatePassed: boolean) {
  const scenariosWithReorientation = scenarios.filter((scenario) =>
    scenario.diagnosis.mechanismSignals.reorientationObserved).length;
  const scenariosWithFourFootSupport = scenarios.filter((scenario) =>
    scenario.diagnosis.mechanismSignals.fourFootSupportObserved).length;
  const scenariosWithStableStand = scenarios.filter((scenario) =>
    scenario.diagnosis.mechanismSignals.stableStandObserved).length;
  const unsafeScenarios = scenarios.filter((scenario) =>
    !scenario.diagnosis.mechanismSignals.collisionSafe
    || !scenario.diagnosis.mechanismSignals.jointLimitSafe).length;
  const mechanismCoverageComplete = scenariosWithFourFootSupport === scenarios.length;
  if (gatePassed) {
    return {
      nextDevelopmentEmphasis: "balanced",
      recommendedSurface: "complete-robot-validation",
      mechanismCoverageComplete,
      scenariosWithReorientation,
      scenariosWithFourFootSupport,
      scenariosWithStableStand,
      unsafeScenarios,
      rationale: "Every frozen scenario reached stable standing; preserve the readable mechanism while moving to complete locked Mission validation.",
    };
  }
  if (mechanismCoverageComplete) {
    return {
      nextDevelopmentEmphasis: "balanced",
      recommendedSurface: "embodiment-controller-co-design",
      mechanismCoverageComplete,
      scenariosWithReorientation,
      scenariosWithFourFootSupport,
      scenariosWithStableStand,
      unsafeScenarios,
      rationale: "Every frozen scenario produced four-foot support, but at least one failed to retain it safely through rise; refine the transition and geometry together before Training.",
    };
  }
  return {
    nextDevelopmentEmphasis: "design-reassessment",
    recommendedSurface: "embodiment",
    mechanismCoverageComplete,
    scenariosWithReorientation,
    scenariosWithFourFootSupport,
    scenariosWithStableStand,
    unsafeScenarios,
    rationale: "At least one frozen scenario never produced four-foot support, so the declared dynamic mechanism remains structurally incomplete.",
  };
}

function dynamicProbeReport(result: any): string {
  const rows = result.scenarios.map((scenario: any) => (
    `| \`${scenario.scenario}\` | \`${scenario.runId}\` | ${scenario.passed ? "PASS" : "FAIL"} | \`${scenario.diagnosis.primaryFailureMode}\` | ${scenario.metrics.selfRightingSuccess} | ${scenario.metrics.disallowedCollisionSteps} | ${scenario.metrics.minimumJointLimitMarginRad.toFixed(4)} | ${scenario.metrics.finalBodyTiltRad.toFixed(3)} | ${scenario.metrics.finalBaseHeightM.toFixed(3)} |`
  ));
  return [
    `# Dynamic Design Probe ${result.study}/${result.candidate}`,
    "",
    `Outcome: **${result.outcome}**`,
    "",
    `Static prerequisite: \`${result.staticStudy.id}\` / \`${result.staticStudy.verdict}\``,
    "",
    "| Scenario | Run | Gate | Diagnosis | Self-right | Collision steps | Joint margin rad | Final tilt rad | Final height m |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |",
    ...rows,
    "",
    "## Mechanism diagnosis",
    "",
    ...result.scenarios.flatMap((scenario: any) => [
      `### ${scenario.scenario} · ${scenario.diagnosis.primaryFailureMode}`,
      "",
      `Signals: reorientation=${scenario.diagnosis.mechanismSignals.reorientationObserved}, four-foot-support=${scenario.diagnosis.mechanismSignals.fourFootSupportObserved}, stable-stand=${scenario.diagnosis.mechanismSignals.stableStandObserved}, collision-safe=${scenario.diagnosis.mechanismSignals.collisionSafe}, joint-limit-safe=${scenario.diagnosis.mechanismSignals.jointLimitSafe}.`,
      "",
      `Closest upright witness: ${scenario.diagnosis.witnesses.closestToUpright.timeSeconds.toFixed(3)} s / ${scenario.diagnosis.witnesses.closestToUpright.phase}, tilt ${scenario.diagnosis.witnesses.closestToUpright.bodyTiltRad.toFixed(3)} rad, ${scenario.diagnosis.witnesses.closestToUpright.supportFeet} supporting feet.`,
      "",
      `Maximum-support witness: ${scenario.diagnosis.witnesses.maximumSupport.timeSeconds.toFixed(3)} s / ${scenario.diagnosis.witnesses.maximumSupport.phase}, ${scenario.diagnosis.witnesses.maximumSupport.supportFeet} supporting feet, tilt ${scenario.diagnosis.witnesses.maximumSupport.bodyTiltRad.toFixed(3)} rad.`,
      "",
      `Next question: ${scenario.diagnosis.nextQuestion}`,
      "",
    ]),
    "",
    `Successful scenarios: **${result.successfulScenarios}/${result.scenarios.length}** (required ${result.expectations.minimumSuccessfulScenarios})`,
    "",
    `Next development emphasis: **${result.nextDevelopmentEmphasis}**`,
    "",
    `Recommended surface: **${result.developmentDiagnosis.recommendedSurface}**`,
    "",
    `Mechanism coverage: reorientation ${result.developmentDiagnosis.scenariosWithReorientation}/${result.scenarios.length}, four-foot support ${result.developmentDiagnosis.scenariosWithFourFootSupport}/${result.scenarios.length}, stable stand ${result.developmentDiagnosis.scenariosWithStableStand}/${result.scenarios.length}, unsafe ${result.developmentDiagnosis.unsafeScenarios}/${result.scenarios.length}.`,
    "",
    result.developmentDiagnosis.rationale,
    "",
    result.switchBackReason,
    "",
    "## Authority boundary",
    "",
    "This probe establishes only bounded simulated mechanism evidence for the exact",
    "Assembly, readable Program Controller, scenarios, seed, Runtime, and Harness",
    "hashes recorded here. It does not accept the design, prove the full capability,",
    "promote a revision, or provide physical hardware evidence.",
    "",
  ].join("\n");
}

function dynamicProbeHtml(result: any): string {
  const scenarioCards = result.scenarios.map((scenario: any) => {
    const failed = scenario.checks.filter((check: any) => !check.passed)
      .map((check: any) => `<li>${escapeHtml(check.metric)}: ${escapeHtml(check.actual)} ${escapeHtml(check.comparator)} ${escapeHtml(check.threshold)}</li>`)
      .join("");
    return `<article><header><div><div class="eyebrow">${escapeHtml(scenario.runId)}</div><h2>${escapeHtml(scenario.scenario)}</h2></div><strong class="${scenario.passed ? "pass" : "fail"}">${scenario.passed ? "PASS" : "FAIL"}</strong></header>`
      + `<div class="metrics"><span><b>${escapeHtml(scenario.metrics.selfRightingSuccess)}</b>self-right</span><span><b>${escapeHtml(scenario.metrics.finalBodyTiltRad.toFixed(3))}</b>final tilt</span><span><b>${escapeHtml(scenario.diagnosis.witnesses.maximumSupport.supportFeet)}</b>max support</span><span><b>${escapeHtml(scenario.metrics.minimumJointLimitMarginRad.toFixed(4))}</b>joint margin</span></div>`
      + `<p><strong>${escapeHtml(scenario.diagnosis.primaryFailureMode)}</strong><br><span class="summary">${escapeHtml(scenario.diagnosis.failureModes.join(" · "))}</span></p>`
      + `<p class="summary">${escapeHtml(scenario.diagnosis.nextQuestion)}</p>`
      + `${failed ? `<details open><summary>Failed gates</summary><ul>${failed}</ul></details>` : "<p class=\"pass\">All declared dynamic gates passed.</p>"}`
      + `<a href="../../../runs/${escapeHtml(scenario.runId)}/report.md">Open immutable run report</a></article>`;
  }).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dynamic Design Probe ${escapeHtml(result.candidate)}</title><style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#080b10;color:#edf3f8}*{box-sizing:border-box}body{margin:0;padding:36px;background:radial-gradient(circle at 20% 0,#182840 0,#080b10 38%);min-height:100vh}.wrap{max-width:1250px;margin:auto}.hero{display:flex;justify-content:space-between;gap:24px;align-items:end}.eyebrow{font:700 11px ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:#8ea4c2}h1{font-size:clamp(34px,6vw,68px);line-height:.95;margin:10px 0}.summary{color:#b9c5d2;max-width:780px;line-height:1.55}.verdict{font:800 12px ui-monospace,monospace;border:1px solid #33445b;border-radius:999px;padding:10px 13px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:28px}article{background:#111722;border:1px solid #263143;border-radius:16px;padding:18px}article header{display:flex;justify-content:space-between;gap:12px}h2{margin:5px 0 14px}.pass{color:#68e0ad}.fail{color:#ff8989}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.metrics span{border:1px solid #273345;border-radius:9px;padding:9px;color:#8fa1b7;font-size:11px}.metrics b{display:block;color:#edf3f8;font-size:16px}details{margin:14px 0;color:#bac5d2}a{color:#7cc7ff}.decision,.boundary{margin-top:18px;padding:16px;background:#111722;border-left:3px solid #e7ba61;line-height:1.55}.boundary{border-left-color:#6e86a8;color:#b8c3d1}@media(max-width:800px){body{padding:20px}.hero{display:block}.grid{grid-template-columns:1fr}.metrics{grid-template-columns:repeat(2,1fr)}}
</style></head><body><main class="wrap"><header class="hero"><div><div class="eyebrow">Mujica · Static-gated dynamic evidence</div><h1>${escapeHtml(result.candidate)}</h1><p class="summary">Static screen <code>${escapeHtml(result.staticStudy.id)}</code> passed before these exact simulations ran. ${result.successfulScenarios}/${result.scenarios.length} frozen scenarios passed; the required gate is ${result.expectations.minimumSuccessfulScenarios}/${result.scenarios.length}.</p></div><div class="verdict ${result.gatePassed ? "pass" : "fail"}">${escapeHtml(result.outcome)}</div></header><section class="grid">${scenarioCards}</section><aside class="decision"><strong>Next emphasis · ${escapeHtml(result.nextDevelopmentEmphasis)} · ${escapeHtml(result.developmentDiagnosis.recommendedSurface)}</strong><br>${escapeHtml(result.developmentDiagnosis.rationale)}<br>${escapeHtml(result.switchBackReason)}</aside><aside class="boundary"><strong>Authority boundary.</strong> Bounded simulated mechanism evidence only. No design acceptance, capability claim, revision promotion, or physical evidence.</aside></main></body></html>`;
}

export async function designProbeCommand(projectDir: string, studyId: string, candidateId: string) {
  const project = await loadProject(projectDir);
  const study = await loadDesignStudy(project.rootDir, studyId);
  const candidate = study.candidates.find((item) => item.id === candidateId);
  if (!candidate) throw new Error(`Design Study '${studyId}' has no candidate '${candidateId}'`);
  if (!candidate.dynamicProbe) throw new Error(`Design Study '${studyId}' candidate '${candidateId}' has no dynamicProbe declaration`);
  const staticEnvelope = await designStudyCommand(project.rootDir, studyId);
  const staticCandidate = staticEnvelope.data.candidates.find((item: any) => item.id === candidateId);
  if (staticCandidate?.verdict !== "SUPPORTED_WITHIN_SCREEN") {
    throw new Error(`Dynamic Design Probe refused: candidate '${candidateId}' is '${staticCandidate?.verdict ?? "UNKNOWN"}' in static Study '${staticEnvelope.data.id}'`);
  }
  const probe = candidate.dynamicProbe;
  const probeTask: any = await loadTask(project.rootDir, probe.task);
  const reorientationThresholdRad = Number(
    probeTask.recoveryTarget?.maximumBodyTiltRad ?? 0.35,
  );
  const scenarios: any[] = [];
  for (const scenario of probe.scenarios) {
    const envelope = await simulateCommand(project.rootDir, {
      assembly: candidate.assembly,
      controller: probe.controller,
      task: probe.task,
      scenario,
      ...(probe.objective ? { objective: probe.objective } : {}),
      seed: probe.seed,
    });
    const run: any = envelope.data;
    const checks = [
      {
        metric: "selfRightingSuccess",
        actual: Number(run.metrics.selfRightingSuccess),
        comparator: ">=",
        threshold: probe.expectations.minimumSelfRightingSuccess,
        passed: Number(run.metrics.selfRightingSuccess) >= probe.expectations.minimumSelfRightingSuccess,
      },
      {
        metric: "disallowedCollisionSteps",
        actual: Number(run.metrics.disallowedCollisionSteps),
        comparator: "<=",
        threshold: probe.expectations.maximumDisallowedCollisionSteps,
        passed: Number(run.metrics.disallowedCollisionSteps) <= probe.expectations.maximumDisallowedCollisionSteps,
      },
      {
        metric: "minimumJointLimitMarginRad",
        actual: Number(run.metrics.minimumJointLimitMarginRad),
        comparator: ">=",
        threshold: probe.expectations.minimumJointLimitMarginRad,
        passed: Number(run.metrics.minimumJointLimitMarginRad) >= probe.expectations.minimumJointLimitMarginRad,
      },
    ];
    const trajectory = (await readFile(
      join(project.rootDir, "runs", run.runId, "trajectory.ndjson"),
      "utf8",
    )).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const passed = checks.every((check) => check.passed);
    scenarios.push({
      scenario,
      runId: run.runId,
      resultHash: run.resultHash,
      runPath: `runs/${run.runId}`,
      cached: run.cached,
      passed,
      checks,
      metrics: {
        selfRightingSuccess: Number(run.metrics.selfRightingSuccess),
        timeToStableStandSeconds: Number(run.metrics.timeToStableStandSeconds),
        stableStandingDwellSeconds: Number(run.metrics.stableStandingDwellSeconds),
        minimumBodyTiltRad: Number(run.metrics.minimumBodyTiltRad),
        finalBodyTiltRad: Number(run.metrics.finalBodyTiltRad),
        finalBaseHeightM: Number(run.metrics.finalBaseHeightM),
        disallowedCollisionSteps: Number(run.metrics.disallowedCollisionSteps),
        minimumJointLimitMarginRad: Number(run.metrics.minimumJointLimitMarginRad),
      },
      diagnosis: diagnoseDynamicProbeTrajectory(
        trajectory,
        passed,
        probe.expectations,
        reorientationThresholdRad,
      ),
    });
  }
  const successfulScenarios = scenarios.filter((scenario) => scenario.passed).length;
  const gatePassed = successfulScenarios >= probe.expectations.minimumSuccessfulScenarios;
  const outcome = gatePassed
    ? "DYNAMIC_PROBE_PASSED"
    : successfulScenarios > 0
      ? "PARTIAL_DYNAMIC_MECHANISM_OBSERVED"
      : "NO_DYNAMIC_MECHANISM_OBSERVED";
  const developmentDiagnosis = routeDynamicProbeDevelopment(
    scenarios,
    gatePassed,
  );
  const result = {
    version: 1,
    kind: "mujica-design-probe-result",
    harnessSourceHash: await harnessSourceHash(),
    runtimeSourceHash: await runtimeSourceHash(),
    study: study.id,
    studyHash: hashJson(study),
    candidate: candidate.id,
    assembly: candidate.assembly,
    controller: probe.controller,
    task: probe.task,
    objective: probe.objective ?? project.manifest.defaults.objective,
    seed: probe.seed,
    staticStudy: {
      id: staticEnvelope.data.id,
      verdict: staticCandidate.verdict,
      analysisId: staticCandidate.analysisId,
    },
    expectations: probe.expectations,
    scenarios,
    successfulScenarios,
    gatePassed,
    outcome,
    developmentDiagnosis,
    nextDevelopmentEmphasis: developmentDiagnosis.nextDevelopmentEmphasis,
    switchBackReason: gatePassed
      ? "The readable Controller demonstrates the declared mechanism across the frozen probe set; bounded Controller work may continue before any RL budget."
      : `${probe.switchBackIf} Observed ${successfulScenarios}/${scenarios.length} passing scenarios and ${developmentDiagnosis.scenariosWithFourFootSupport}/${scenarios.length} with four-foot support, so increasing RL budget is not authorized by this probe.`,
    authorityBoundary: {
      claim: "bounded-simulated-dynamic-mechanism",
      designAcceptance: "none",
      capabilityAcceptance: "none",
      physicalEvidence: false,
      promotion: "locked-judge-only",
      trainingAuthorization: false,
    },
  };
  const artifactId = `design-probe-${hashJson(result).slice(0, 16)}`;
  const target = join(project.rootDir, ".mujica", "design-probes", artifactId);
  let cached = await exists(join(target, "manifest.json"));
  if (!cached) {
    await atomicDirectory(target, async (directory) => {
      await writeJson(join(directory, "result.json"), result);
      await writeFile(join(directory, "report.md"), dynamicProbeReport(result));
      await writeFile(join(directory, "index.html"), dynamicProbeHtml(result));
      await writeJson(join(directory, "manifest.json"), {
        version: 1,
        id: artifactId,
        kind: result.kind,
        study: study.id,
        candidate: candidate.id,
        resultHash: sha256(await readFile(join(directory, "result.json"))),
        reportHash: sha256(await readFile(join(directory, "report.md"))),
        htmlHash: sha256(await readFile(join(directory, "index.html"))),
        staticStudyId: result.staticStudy.id,
        runIds: scenarios.map((scenario) => scenario.runId),
        runResultHashes: scenarios.map((scenario) => scenario.resultHash),
        outcome,
        gatePassed,
        completed: true,
        authorityBoundary: result.authorityBoundary,
      });
    });
  } else {
    const manifest = JSON.parse(await readFile(join(target, "manifest.json"), "utf8"));
    for (const [file, key] of [["result.json", "resultHash"], ["report.md", "reportHash"], ["index.html", "htmlHash"]] as const) {
      if (sha256(await readFile(join(target, file))) !== manifest[key]) throw new Error(`Dynamic Design Probe '${artifactId}' failed artifact integrity verification`);
    }
    if (stableJson(manifest.runResultHashes) !== stableJson(scenarios.map((scenario) => scenario.resultHash))) {
      throw new Error(`Dynamic Design Probe '${artifactId}' immutable Run identity is inconsistent`);
    }
  }
  await writeJson(join(project.rootDir, ".mujica", "design-probes", "current.json"), {
    version: 1,
    id: artifactId,
    study: study.id,
    candidate: candidate.id,
  });
  return success("design.probe", {
    id: artifactId,
    path: target,
    cached,
    study: study.id,
    candidate: candidate.id,
    outcome,
    gatePassed,
    successfulScenarios,
    scenarios,
    developmentDiagnosis,
    nextDevelopmentEmphasis: result.nextDevelopmentEmphasis,
    switchBackReason: result.switchBackReason,
    resultPath: join(target, "result.json"),
    reportPath: join(target, "report.md"),
    htmlPath: join(target, "index.html"),
    authorityBoundary: result.authorityBoundary,
  }, project, [
    ...scenarios.map((scenario) => projectArtifact("simulation-run", scenario.runId, join(project.rootDir, scenario.runPath), true)),
    projectArtifact("design-probe", artifactId, target, true),
  ]);
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
  const trainerHash = await hashDirectory(trainer.rootDir); const sourceHash = await runtimeSourceHash(); const harnessHash = await harnessSourceHash(); const harnessDependencyHash = await harnessDependencyLockHash();
  const task = training.version === 1
    ? await loadTask(project.rootDir, training.task)
    : training.version === 3
      ? await loadTask(project.rootDir, training.mission.task)
      : null;
  const scenarios = [];
  if (training.version === 1) for (const id of training.scenarios) scenarios.push(await loadScenario(project.rootDir, id));
  if (training.version === 3) for (const id of training.mission.scenarios) scenarios.push(await loadScenario(project.rootDir, id));
  const curriculum = training.version === 2 ? await Promise.all(training.curriculum.map(async (entry) => ({
    ...entry,
    task: await loadTask(project.rootDir, entry.task),
    scenarios: await Promise.all(entry.scenarios.map(async (id) => await loadScenario(project.rootDir, id))),
  }))) : null;
  const progression = training.version === 3 ? await Promise.all(training.progression.map(async (stage) => {
    const profile = stage.domainProfile ? await domainProfileIdentity(project.rootDir, stage.domainProfile) : null;
    if (profile) assertDomainProfilePlantCompatible(profile.definition, assembly);
    return {
      ...stage,
      domainProfile: profile?.definition ?? null,
      domainProfileHash: profile?.hash ?? null,
      domainProfileEvidenceHash: profile?.evidenceHash ?? null,
    };
  })) : null;
  let priorController: { definition: ControllerDefinition; rootDir: string; hash: string } | null = null;
  if (training.priorController) {
    const prior = await loadController(project.rootDir, training.priorController); if (prior.definition.kind !== "program") throw new Error(`Training prior '${training.priorController}' must be a program Controller`);
    assertProgramControllerCompatible(prior.definition, assembly); priorController = { definition: prior.definition, rootDir: prior.rootDir, hash: await hashDirectory(prior.rootDir) };
  }
  let warmStart: Record<string, any> | null = null;
  if (training.warmStart) {
    const parent = await loadFrozenPolicyArtifact(
      project.rootDir,
      training.warmStart.policy,
    );
    if (
      parent.manifest.executionHash !== assembly.executionHash
      || parent.manifest.observationContractHash
        !== hashJson(assembly.observationContract)
      || parent.manifest.actionContractHash !== hashJson(assembly.actionContract)
      || parent.manifest.priorControllerHash !== priorController?.hash
    ) {
      throw new Error(
        `Warm-start Policy '${training.warmStart.policy}' is incompatible with this Training execution closure`,
      );
    }
    if (
      parent.architecture.actionTransform?.kind
        === "program-controller-residual"
      && parent.architecture.actionTransform.controllerHash
        !== priorController?.hash
    ) {
      throw new Error(
        `Warm-start Policy '${training.warmStart.policy}' does not preserve the frozen Program prior`,
      );
    }
    warmStart = {
      policy: training.warmStart.policy,
      root: parent.root,
      policyHash: parent.policyHash,
      modelHash: parent.modelHash,
      architectureHash: parent.architectureHash,
      normalizerHash: parent.normalizerHash,
      architecture: parent.architecture,
      normalizer: parent.normalizer,
      normalizerMode: training.warmStart.normalizer,
      trustRegion: training.warmStart.trustRegion,
      createdByTrainingRun: parent.trainingRunId,
    };
  }
  let reflexDistillation: Record<string, any> | null = null;
  if (training.reflexDistillation) {
    const artifact = await loadReflexSearch(
      project.rootDir,
      training.reflexDistillation.search,
    );
    const evaluation = artifact.evaluation;
    const trainingCases = evaluation.dataPartition?.search?.cases;
    const judgeCases = evaluation.dataPartition?.judge?.cases;
    const trainingSeeds = new Set(
      Array.isArray(trainingCases) ? trainingCases.map((item: any) => item.seed) : [],
    );
    const judgeSeeds = new Set(
      Array.isArray(judgeCases) ? judgeCases.map((item: any) => item.seed) : [],
    );
    if (
      evaluation.assessment?.demonstrationEligible !== true
      || evaluation.assessment?.promotionVerdict !== null
      || evaluation.assessment?.judgeRequired !== true
      || evaluation.authorityBoundary?.trainingClaim !== "demonstration-source-only"
      || evaluation.authorityBoundary?.promotion
        !== "locked-continuous-mission-judge-required"
      || evaluation.dataPartition?.search?.authority !== "training-only"
      || evaluation.dataPartition?.judge?.authority !== "promotion-only"
      || evaluation.dataPartition?.seedOverlap !== false
      || !Array.isArray(trainingCases)
      || !Array.isArray(judgeCases)
      || [...trainingSeeds].some((seed) => judgeSeeds.has(seed))
    ) {
      throw new Error(
        `Reflex Search '${training.reflexDistillation.search}' does not preserve the Training/Judge authority boundary`,
      );
    }
    if (
      evaluation.subject?.assembly !== assembly.id
      || evaluation.subject?.executionHash !== assembly.executionHash
      || evaluation.subject?.frozenPolicy?.observationContractHash
        !== hashJson(assembly.observationContract)
      || evaluation.subject?.frozenPolicy?.actionContractHash
        !== hashJson(assembly.actionContract)
      || evaluation.subject?.frozenPolicy?.priorControllerHash
        !== priorController?.hash
    ) {
      throw new Error(
        `Reflex Search '${training.reflexDistillation.search}' is incompatible with this Training execution closure`,
      );
    }
    if (
      warmStart
      && (
        evaluation.subject?.frozenPolicy?.id !== warmStart.policy
        || evaluation.subject?.frozenPolicy?.policyHash
          !== warmStart.policyHash
        || evaluation.subject?.frozenPolicy?.modelHash
          !== warmStart.modelHash
        || evaluation.subject?.frozenPolicy?.normalizerHash
          !== warmStart.normalizerHash
        || evaluation.subject?.frozenPolicy?.architectureHash
          !== warmStart.architectureHash
      )
    ) {
      throw new Error(
        `Reflex Search '${training.reflexDistillation.search}' does not originate from warm-start Policy '${warmStart.policy}'`,
      );
    }
    const searchCaseIds = new Set(trainingCases.map((item: any) => item.id));
    if (
      artifact.demonstrations.length === 0
      || artifact.demonstrations.some(
        (item: any) => !searchCaseIds.has(item.case),
      )
    ) {
      throw new Error(
        `Reflex Search '${training.reflexDistillation.search}' has no valid Training demonstrations`,
      );
    }
    reflexDistillation = {
      search: training.reflexDistillation.search,
      coefficient: training.reflexDistillation.coefficient,
      minibatchSize: training.reflexDistillation.minibatchSize,
      untilStep: training.reflexDistillation.untilStep,
      evaluationHash: artifact.manifest.evaluationHash,
      demonstrationsHash: artifact.manifest.demonstrationsHash,
      demonstrations: artifact.demonstrations,
      target: evaluation.demonstrations.target,
      dataPartition: evaluation.dataPartition,
    };
  }
  const domainProfileIdentityValue = training.domainProfile ? await domainProfileIdentity(project.rootDir, training.domainProfile) : null;
  const domainProfile = domainProfileIdentityValue?.definition ?? null;
  const domainProfileEvidenceHash = domainProfileIdentityValue?.evidenceHash ?? null;
  const domainProfileHash = domainProfileIdentityValue?.hash ?? null;
  if (domainProfile) assertDomainProfilePlantCompatible(domainProfile, assembly);
  const timeoutMs = deadlineMs === undefined ? undefined : deadlineMs - Date.now();
  if (timeoutMs !== undefined && timeoutMs <= 0) throw new Error("Research Lab wall-clock budget exhausted before training");
  return await invokeRuntime("train", {
    runtimeVersion, runtimeSourceHash: sourceHash, harnessSourceHash: harnessHash, harnessDependencyLockHash: harnessDependencyHash, projectDir: project.rootDir, modelPath: assembly.modelPath, compiled: runtimeCompiled(assembly), training, trainer: trainer.definition, trainerRoot: trainer.rootDir, trainerHash,
    priorController: priorController?.definition ?? null, priorControllerRoot: priorController?.rootDir ?? null, priorControllerHash: priorController?.hash ?? null,
    warmStart,
    reflexDistillation,
    domainProfile, domainProfileHash, domainProfileEvidenceHash,
    task, scenarios, curriculum, progression, seed, dependencyLockHash: await dependencyLockHash(),
    sourceHashes: {
      runtime: sourceHash, harness: harnessHash, harnessDependencies: harnessDependencyHash, trainer: trainerHash,
      priorController: priorController?.hash ?? null, domainProfile: domainProfileHash,
      warmStart: warmStart
        ? {
          policy: warmStart.policy,
          policyHash: warmStart.policyHash,
          modelHash: warmStart.modelHash,
          architectureHash: warmStart.architectureHash,
          normalizerHash: warmStart.normalizerHash,
          normalizerMode: warmStart.normalizerMode,
          trustRegion: warmStart.trustRegion,
        }
        : null,
      reflexSearch: reflexDistillation
        ? {
          id: reflexDistillation.search,
          evaluationHash: reflexDistillation.evaluationHash,
          demonstrationsHash: reflexDistillation.demonstrationsHash,
        }
        : null,
      progressionDomainProfiles: progression?.map((stage) => ({ id: stage.id, hash: stage.domainProfileHash })) ?? null,
      assembly: assembly.assemblyHash, catalog: assembly.catalogHash, training: hashJson(training),
    },
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
  let oldModelHash: string;
  let oldModelProvenance: { kind: "local-compiled-cache"; assemblyHash: string } | { kind: "transitive-requalification"; policy: string; proofHash: string };
  if (await exists(oldModelPath)) {
    oldModelHash = sha256(await readFile(oldModelPath));
    oldModelProvenance = { kind: "local-compiled-cache", assemblyHash: manifest.assemblyHash };
  } else {
    const witnesses = [];
    for (const candidateId of await listManifestDirectories(join(project.rootDir, "policies"))) {
      const candidateRoot = confined(project.rootDir, `policies/${candidateId}`);
      const proofPath = join(candidateRoot, "requalification.json");
      if (!(await exists(proofPath))) continue;
      const candidateManifest = JSON.parse(await readFile(join(candidateRoot, "manifest.json"), "utf8"));
      const candidateProof = JSON.parse(await readFile(proofPath, "utf8"));
      if (
        candidateManifest.derivedFromPolicy === policyId
        && candidateManifest.derivedFromPolicyHash === sourcePolicyHash
        && candidateProof.kind === "execution-equivalent-metadata-migration"
        && candidateProof.sourcePolicyId === policyId
        && candidateProof.sourcePolicyHash === sourcePolicyHash
        && candidateProof.oldAssemblyHash === manifest.assemblyHash
        && candidateProof.oldModelHash === candidateProof.newModelHash
      ) witnesses.push({ policy: candidateId, proof: candidateProof, proofHash: hashJson(candidateProof) });
    }
    const witness = witnesses.sort((left, right) => left.policy.localeCompare(right.policy))[0];
    if (!witness) throw new Error(`Old compiled Assembly '${manifest.assemblyHash}' is unavailable and no bound transitive requalification proof exists; execution equivalence cannot be proven`);
    oldModelHash = witness.proof.oldModelHash;
    oldModelProvenance = { kind: "transitive-requalification", policy: witness.policy, proofHash: witness.proofHash };
  }
  if (oldModelHash !== assembly.modelHash) throw new Error("Old and new compiled MJCF differ; Policy must be retrained");
  const oldObservation = JSON.parse(await readFile(join(source, "observation-contract.json"), "utf8")); const oldAction = JSON.parse(await readFile(join(source, "action-contract.json"), "utf8"));
  const observationContractHash = hashJson(assembly.observationContract); const actionContractHash = hashJson(assembly.actionContract);
  if (hashJson(oldObservation) !== observationContractHash || hashJson(oldAction) !== actionContractHash) throw new Error("Old and new Controller contracts differ; Policy must be retrained");
  const proof = { version: 2, kind: "execution-equivalent-metadata-migration", sourcePolicyId: policyId, sourcePolicyHash, oldAssemblyHash: manifest.assemblyHash, newAssemblyHash: assembly.assemblyHash, oldModelHash, oldModelProvenance, newModelHash: assembly.modelHash, executionHash: assembly.executionHash, observationContractHash, actionContractHash };
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
    if (candidateCase && (candidateCase.metrics.selfRightingSuccess ?? 0) < objective.gates.minimumSelfRightingSuccess) gateReasons.push(`${candidateCase.case.id}: self-righting success ${(candidateCase.metrics.selfRightingSuccess ?? 0).toFixed(3)} below gate`);
    if (candidateCase && (candidateCase.metrics.timeToStableStandSeconds ?? 0) > objective.gates.maximumTimeToStableStandSeconds) gateReasons.push(`${candidateCase.case.id}: stable-stand time ${(candidateCase.metrics.timeToStableStandSeconds ?? 0).toFixed(3)} exceeds gate`);
    if (candidateCase && (candidateCase.metrics.stableStandingDwellSeconds ?? 0) < objective.gates.minimumStableStandingDwellSeconds) gateReasons.push(`${candidateCase.case.id}: stable-standing dwell ${(candidateCase.metrics.stableStandingDwellSeconds ?? 0).toFixed(3)} below gate`);
    if (candidateCase && (candidateCase.metrics.recoveryRelapseCount ?? 0) > (objective.gates.maximumRecoveryRelapses ?? 1_000_000)) gateReasons.push(`${candidateCase.case.id}: ${candidateCase.metrics.recoveryRelapseCount ?? 0} post-recovery relapses exceed gate`);
    if (candidateCase && (candidateCase.metrics.finalBodyTiltRad ?? 0) > objective.gates.maximumFinalBodyTiltRad) gateReasons.push(`${candidateCase.case.id}: final body tilt ${(candidateCase.metrics.finalBodyTiltRad ?? 0).toFixed(3)} exceeds gate`);
    if (candidateCase && (candidateCase.metrics.finalBaseHeightM ?? 1_000_000) < objective.gates.minimumFinalBaseHeightM) gateReasons.push(`${candidateCase.case.id}: final base height ${(candidateCase.metrics.finalBaseHeightM ?? 0).toFixed(3)} below gate`);
    if (candidateCase && (candidateCase.metrics.minimumJointLimitMarginRad ?? 1_000_000) < objective.gates.minimumJointLimitMarginRad) gateReasons.push(`${candidateCase.case.id}: joint-limit margin ${(candidateCase.metrics.minimumJointLimitMarginRad ?? 0).toFixed(3)} below gate`);
    if (candidateCase && candidateCase.metrics.peakActuator > objective.gates.maximumPeakActuator) gateReasons.push(`${candidateCase.case.id}: peak actuator ${candidateCase.metrics.peakActuator.toFixed(3)} exceeds gate`);
    if (candidateCase && (candidateCase.metrics.disallowedCollisionSteps ?? 0) > objective.gates.maximumDisallowedCollisionSteps) gateReasons.push(`${candidateCase.case.id}: ${candidateCase.metrics.disallowedCollisionSteps ?? 0} disallowed collision steps exceed gate`);
    if (candidateCase && Number(candidateCase.metrics.missionCompleted ?? true) < objective.gates.minimumMissionCompletion) gateReasons.push(`${candidateCase.case.id}: causal Mission did not complete`);
    if (candidateCase && (candidateCase.metrics.missionPhaseTimeoutCount ?? 0) > objective.gates.maximumMissionPhaseTimeouts) gateReasons.push(`${candidateCase.case.id}: ${candidateCase.metrics.missionPhaseTimeoutCount ?? 0} Mission phase timeouts exceed gate`);
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

export type EvaluationResult = Awaited<ReturnType<typeof evaluatePair>>;

export function candidateSelection(gateReasons: string[], scoreDelta: number, baselineViolationCount: number) {
  const feasible = gateReasons.length === 0;
  const verdict = feasible && (baselineViolationCount > 0 || scoreDelta > 0) ? "KEEP" as const : "REVERT" as const;
  const selectionReason = verdict === "KEEP" ? (baselineViolationCount > 0 ? "fewer-gate-violations" as const : "score-improvement-within-feasibility-tier" as const) : (gateReasons.length ? "candidate-gate-violation" as const : "no-feasibility-or-score-improvement" as const);
  return { verdict, selectionReason };
}

export type GateAssessment = {
  id: "survival" | "forward-progress" | "signed-forward-progress" | "backward-displacement" | "backward-pitch" | "pitch-angle" | "pitch-rate" | "body-tilt" | "lateral-drift" | "planar-velocity-tracking" | "yaw-rate-tracking" | "transition-terminal-planar" | "transition-terminal-yaw" | "planar-settling-time" | "planar-braking-settling-time" | "yaw-settling-time" | "planar-overshoot" | "yaw-overshoot" | "unsettled-planar" | "unsettled-yaw" | "joint-jerk" | "body-angular-jerk" | "action-slew" | "actuator-saturation" | "foot-slip" | "foot-impact" | "self-righting" | "stable-stand-time" | "stable-standing-dwell" | "recovery-relapse" | "final-body-tilt" | "final-base-height" | "joint-limit-margin" | "peak-actuator" | "disallowed-collision" | "mission-completion" | "mission-phase-timeouts" | "score-regression";
  metric: string; comparator: ">=" | "<="; threshold: number; value: number; margin: number; passed: boolean; enforced: boolean; severity: number;
};

export function upperViolationSeverity(value: number, threshold: number, normalization = Math.max(Math.abs(threshold), 1e-9)) {
  const margin = threshold - value;
  return margin < 0 ? -margin / Math.max(normalization, 1e-9) : 0;
}

export function diagnosticGates(objective: Awaited<ReturnType<typeof loadObjective>>, candidate: EvaluationResult["cases"][number], baseline: EvaluationResult["cases"][number] | undefined): GateAssessment[] {
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
  gates.push(lower("self-righting", "selfRightingSuccess", candidate.metrics.selfRightingSuccess ?? 0, objective.gates.minimumSelfRightingSuccess ?? 0));
  gates.push(upper("stable-stand-time", "timeToStableStandSeconds", candidate.metrics.timeToStableStandSeconds ?? 0, objective.gates.maximumTimeToStableStandSeconds ?? 1_000_000, 1));
  gates.push(lower("stable-standing-dwell", "stableStandingDwellSeconds", candidate.metrics.stableStandingDwellSeconds ?? 0, objective.gates.minimumStableStandingDwellSeconds ?? 0));
  gates.push(upper("recovery-relapse", "recoveryRelapseCount", candidate.metrics.recoveryRelapseCount ?? 0, objective.gates.maximumRecoveryRelapses ?? 1_000_000, 1));
  gates.push(upper("final-body-tilt", "finalBodyTiltRad", candidate.metrics.finalBodyTiltRad ?? 0, objective.gates.maximumFinalBodyTiltRad ?? Math.PI, 0.5));
  gates.push(lower("final-base-height", "finalBaseHeightM", candidate.metrics.finalBaseHeightM ?? 1_000_000, objective.gates.minimumFinalBaseHeightM ?? 0));
  gates.push(lower("joint-limit-margin", "minimumJointLimitMarginRad", candidate.metrics.minimumJointLimitMarginRad ?? 1_000_000, objective.gates.minimumJointLimitMarginRad ?? 0));
  gates.push(upper("peak-actuator", "peakActuator", candidate.metrics.peakActuator ?? 0, objective.gates.maximumPeakActuator ?? 1_000_000, 8));
  gates.push(upper(
    "disallowed-collision",
    "disallowedCollisionSteps",
    candidate.metrics.disallowedCollisionSteps ?? 0,
    objective.gates.maximumDisallowedCollisionSteps ?? 1_000_000,
    Math.max(candidate.metrics.steps ?? 1, 1),
  ));
  gates.push(lower("mission-completion", "missionCompleted", Number(candidate.metrics.missionCompleted ?? true), objective.gates.minimumMissionCompletion ?? 0));
  gates.push(upper("mission-phase-timeouts", "missionPhaseTimeoutCount", candidate.metrics.missionPhaseTimeoutCount ?? 0, objective.gates.maximumMissionPhaseTimeouts ?? 1_000_000, 1));
  if (baseline) gates.push(lower("score-regression", "scoreDelta", candidate.score.total - baseline.score.total, -objective.gates.maximumRegression));
  return gates;
}

export function diagnosticHypotheses(violations: GateAssessment[]) {
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
  if (violations.some((gate) => gate.id === "recovery-relapse")) {
    hypotheses.push({ kind: "hypothesis", surface: "controller", description: "Replay from the first self-right event through the next physical failure envelope entry; test a bounded recovery-to-locomotion handoff ramp and stability monitor.", rationale: "The robot stood up once but did not preserve that recovery while resuming the same continuous Mission." });
    hypotheses.push({ kind: "hypothesis", surface: "training", description: "Train and evaluate the complete post-recovery locomotion suffix with causal, bounded residual authority instead of terminating the episode at first self-right.", rationale: "A first-success recovery reward cannot teach durable handoff behavior when later relapse remains outside the optimized horizon." });
  }
  if (violations.some((gate) => gate.id === "self-righting" || gate.id === "stable-stand-time" || gate.id === "stable-standing-dwell" || gate.id === "final-body-tilt" || gate.id === "final-base-height")) {
    hypotheses.push({ kind: "hypothesis", surface: "controller", description: "Inspect the frozen resting pose, recovery-target entry/exit events, and contact sequence; test a bounded pose-conditioned recovery state machine before changing the scenario.", rationale: "The robot did not reach and hold the shared stable-standing target within the locked time envelope." });
    hypotheses.push({ kind: "hypothesis", surface: "assembly", description: "Compare rigid and articulated reachable recovery workspaces under the same controller authority and locked resting pose.", rationale: "A recovery failure may be a morphology reachability limit rather than a controller gain problem." });
  }
  if (violations.some((gate) => gate.id === "joint-limit-margin" || gate.id === "disallowed-collision")) hypotheses.push({ kind: "hypothesis", surface: "assembly", description: "Inspect joint-limit and self-contact frames, then change geometry, joint range, or recovery sequencing only inside an explicit complete-design lane.", rationale: "The attempted recovery used structurally unsafe configurations." });
  if (violations.some((gate) => gate.id === "peak-actuator")) hypotheses.push({ kind: "hypothesis", surface: "controller", description: "Reduce peak recovery authority or improve mechanical leverage without widening the locked actuator envelope.", rationale: "The attempted maneuver exceeded declared actuator authority." });
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
