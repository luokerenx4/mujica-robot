import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { confined, hashJson, loadProject, sha256 } from "@mujica/core";
import { success } from "./contract";
import { verifyHardwareBundleIntegrity, verifyHardwareCaptureIntegrity } from "./hardware";
import { harnessSourceHash, invokeRuntime, runtimeSourceHash, runtimeVersion } from "./runtime";
import { writeStudioSnapshot } from "@mujica/studio";

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

export async function resolveCaptureTwin(projectDir: string, captureId: string, episodeId: string) {
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

  const bundleCandidates: { root: string; manifest: any }[] = [];
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
  const targetPath = join(bundle.root, "target.json");
  const compiled = JSON.parse(await readFile(compiledPath, "utf8"));
  const target = JSON.parse(await readFile(targetPath, "utf8"));
  const modelHash = sha256(await readFile(modelPath));
  if (
    compiled.assemblyHash !== bundle.manifest.assemblyHash
    || modelHash !== bundle.manifest.modelXmlHash
    || capture.assemblyHash !== bundle.manifest.assemblyHash
  ) throw new Error("Hardware Capture and frozen Bundle digital twin identities differ");
  if (!Number.isFinite(target.controlHz) || target.controlHz <= 0) throw new Error("Frozen Hardware Bundle has an invalid controlHz");
  let stateContract: any;
  let stateContractHash: string;
  let stateContractAuthority: "bundle-frozen" | "derived-from-frozen-model";
  if (typeof bundle.manifest.stateContractHash === "string") {
    stateContract = JSON.parse(await readFile(join(bundle.root, "state-contract.json"), "utf8"));
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
    stateContract = described.stateContract;
    stateContractHash = described.stateContractHash;
    if (stateContractHash !== hashJson(stateContract)) throw new Error("Derived legacy Hardware State ABI identity is invalid");
    stateContractAuthority = "derived-from-frozen-model";
  }
  return { project, captureRoot, capture, episode, trajectoryPath, trajectoryHash, bundle, compiled, modelPath, modelHash, target, stateContract, stateContractHash, stateContractAuthority };
}

export async function verifyTwinAuditIntegrity(root: string): Promise<{ manifest: any; summary: any; transitions: any[] }> {
  const manifestPath = join(root, "manifest.json");
  if (!(await exists(manifestPath))) throw new Error(`Unknown Digital Twin Audit '${root.split("/").at(-1)}'`);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.kind !== "mujica-digital-twin-audit" || manifest.version !== 1 || manifest.completed !== true) {
    throw new Error(`Digital Twin Audit '${manifest.id ?? root}' is incomplete or unsupported`);
  }
  const files = {
    transitionsHash: "transitions.ndjson",
    predictionHash: "prediction.ndjson",
    summaryHash: "summary.json",
    requestHash: "request.json",
    reportHash: "report.md",
  } as const;
  for (const [field, name] of Object.entries(files)) {
    const path = join(root, name);
    if (!(await exists(path)) || sha256(await readFile(path)) !== manifest[field]) {
      throw new Error(`Digital Twin Audit '${manifest.id}' failed ${name} integrity verification`);
    }
  }
  const auditHash = hashJson({
    identity: manifest.identity,
    transitionsHash: manifest.transitionsHash,
    predictionHash: manifest.predictionHash,
    summaryHash: manifest.summaryHash,
  });
  if (manifest.auditHash !== auditHash || manifest.id !== `twin-audit-${auditHash.slice(0, 16)}`) {
    throw new Error(`Digital Twin Audit '${manifest.id}' failed identity verification`);
  }
  const summary = JSON.parse(await readFile(join(root, "summary.json"), "utf8"));
  const transitions = (await readFile(join(root, "transitions.ndjson"), "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  if (transitions.length !== manifest.transitionCount || summary.transitionCount !== manifest.transitionCount) {
    throw new Error(`Digital Twin Audit '${manifest.id}' transition count is inconsistent`);
  }
  return { manifest, summary, transitions };
}

export async function twinAuditCommand(projectDir: string, captureId: string, episodeId: string) {
  const source = await resolveCaptureTwin(projectDir, captureId, episodeId);
  const result = await invokeRuntime("audit-twin", {
    runtimeVersion,
    runtimeSourceHash: await runtimeSourceHash(),
    harnessSourceHash: await harnessSourceHash(),
    source: {
      kind: "hardware-capture-episode",
      captureId: source.capture.id,
      captureHash: source.capture.captureHash,
      episodeId: source.episode.id,
      episodeHash: source.episode.hash,
      bundleId: source.bundle.manifest.id,
      bundleHash: source.bundle.manifest.bundleHash,
      environment: source.capture.environment,
      mode: source.capture.mode,
      stateContractHash: source.stateContractHash,
      stateContractAuthority: source.stateContractAuthority,
    },
    assemblyHash: source.bundle.manifest.assemblyHash,
    modelHash: source.modelHash,
    modelPath: source.modelPath,
    trajectoryHash: source.trajectoryHash,
    trajectoryPath: source.trajectoryPath,
    controlHz: source.target.controlHz,
    stateContract: source.stateContract,
    stateContractHash: source.stateContractHash,
    outputRoot: join(source.project.rootDir, "twin-audits"),
  });
  const verified = await verifyTwinAuditIntegrity(result.path);
  return success("twin.audit", {
    id: result.id,
    auditHash: result.auditHash,
    path: result.path,
    cached: result.cached,
    source: verified.manifest.identity.source,
    transitionCount: verified.manifest.transitionCount,
    metrics: verified.summary.metrics,
    authority: verified.summary.authority,
  }, source.project, [
    { kind: "digital-twin-audit", id: result.id, path: result.path, immutable: true },
  ], [
    { id: "inspect-audit", description: "Inspect exact residual evidence", argv: ["twin", "inspect", source.project.rootDir, "--audit", result.id], effect: "read-only" },
    { id: "open-studio", description: "Compare device telemetry with the frozen twin", argv: ["studio", source.project.rootDir, "--twin-audit", result.id], effect: "creates-artifact" },
  ]);
}

export async function twinInspectCommand(projectDir: string, auditId: string, transitionIndex?: number) {
  const project = await loadProject(projectDir);
  const root = confined(project.rootDir, `twin-audits/${auditId}`);
  const verified = await verifyTwinAuditIntegrity(root);
  if (verified.manifest.id !== auditId) throw new Error(`Digital Twin Audit directory identity differs from '${auditId}'`);
  let transition = null;
  if (transitionIndex !== undefined) {
    if (!Number.isInteger(transitionIndex) || transitionIndex < 0 || transitionIndex >= verified.transitions.length) {
      throw new Error(`Digital Twin Audit transition must be between 0 and ${Math.max(0, verified.transitions.length - 1)}`);
    }
    transition = verified.transitions[transitionIndex];
  }
  return success("twin.inspect", {
    manifest: verified.manifest,
    summary: verified.summary,
    transition,
    path: root,
  }, project, [{ kind: "digital-twin-audit", id: auditId, path: root, immutable: true }]);
}

export async function twinStudioCommand(projectDir: string, auditId: string) {
  const project = await loadProject(projectDir);
  const auditRoot = confined(project.rootDir, `twin-audits/${auditId}`);
  const audit = await verifyTwinAuditIntegrity(auditRoot);
  if (audit.manifest.id !== auditId) throw new Error(`Digital Twin Audit directory identity differs from '${auditId}'`);
  const identitySource = audit.manifest.identity?.source;
  const source = await resolveCaptureTwin(project.rootDir, identitySource?.captureId, identitySource?.episodeId);
  if (
    identitySource?.captureHash !== source.capture.captureHash
    || identitySource?.episodeHash !== source.episode.hash
    || identitySource?.bundleId !== source.bundle.manifest.id
    || identitySource?.bundleHash !== source.bundle.manifest.bundleHash
    || audit.manifest.identity.assemblyHash !== source.bundle.manifest.assemblyHash
    || audit.manifest.identity.modelHash !== source.modelHash
    || audit.manifest.identity.stateContractHash !== source.stateContractHash
  ) throw new Error(`Digital Twin Audit '${auditId}' no longer matches its immutable Capture and Bundle`);

  const settings = { width: 640, height: 480, stride: 1, camera: { azimuth: 135, elevation: -22, distance: 2.2 } };
  const runtimeHash = await runtimeSourceHash();
  const measuredReplay = await invokeRuntime("render-replay", {
    runtimeVersion,
    runtimeSourceHash: runtimeHash,
    source: {
      kind: "hardware-capture-episode",
      captureId: source.capture.id,
      captureHash: source.capture.captureHash,
      bundleId: source.bundle.manifest.id,
      bundleHash: source.bundle.manifest.bundleHash,
      episodeId: source.episode.id,
      episodeHash: source.episode.hash,
      environment: source.capture.environment,
      mode: source.capture.mode,
    },
    assemblyHash: source.bundle.manifest.assemblyHash,
    modelHash: source.modelHash,
    modelPath: source.modelPath,
    trajectoryPath: source.trajectoryPath,
    trajectoryHash: source.trajectoryHash,
    outputRoot: join(source.project.rootDir, ".mujica", "replays"),
    settings,
  });
  const predictionPath = join(auditRoot, "prediction.ndjson");
  const predictedReplay = await invokeRuntime("render-replay", {
    runtimeVersion,
    runtimeSourceHash: runtimeHash,
    source: {
      kind: "digital-twin-audit-prediction",
      auditId: audit.manifest.id,
      auditHash: audit.manifest.auditHash,
      captureId: source.capture.id,
      captureHash: source.capture.captureHash,
      bundleId: source.bundle.manifest.id,
      bundleHash: source.bundle.manifest.bundleHash,
      episodeId: source.episode.id,
      episodeHash: source.episode.hash,
      predictionHash: audit.manifest.predictionHash,
    },
    assemblyHash: source.bundle.manifest.assemblyHash,
    modelHash: source.modelHash,
    modelPath: source.modelPath,
    trajectoryPath: predictionPath,
    trajectoryHash: audit.manifest.predictionHash,
    outputRoot: join(source.project.rootDir, ".mujica", "replays"),
    settings,
  });
  const hardwareCapture = {
    path: source.captureRoot,
    manifest: source.capture,
    episodeId: source.episode.id,
    bundle: {
      id: source.bundle.manifest.id,
      bundleHash: source.bundle.manifest.bundleHash,
      sourceKind: source.bundle.manifest.sourceKind ?? "legacy-robot-revision",
      maximumCaptureMode: source.bundle.manifest.maximumCaptureMode ?? "actuate",
      assemblyHash: source.bundle.manifest.assemblyHash,
      modelHash: source.modelHash,
      stateContractHash: source.stateContractHash,
      stateContractAuthority: source.stateContractAuthority,
    },
    replay: { path: measuredReplay.path, manifest: measuredReplay.manifest },
  };
  const studio = await writeStudioSnapshot(source.project.rootDir, {
    twinAudit: {
      path: auditRoot,
      manifest: audit.manifest,
      hardwareCapture,
      predictionReplay: { path: predictedReplay.path, manifest: predictedReplay.manifest },
    },
  });
  return success("studio", {
    id: studio.id,
    snapshotHash: studio.snapshotHash,
    path: studio.path,
    indexPath: studio.indexPath,
    selectedRun: null,
    comparisonRun: null,
    twinAudit: {
      id: audit.manifest.id,
      auditHash: audit.manifest.auditHash,
      captureId: source.capture.id,
      episodeId: source.episode.id,
      transitionCount: audit.manifest.transitionCount,
    },
    replay: { id: measuredReplay.id, path: measuredReplay.path, frameCount: measuredReplay.manifest.frameCount, cached: measuredReplay.cached },
    comparisonReplay: { id: predictedReplay.id, path: predictedReplay.path, frameCount: predictedReplay.manifest.frameCount, cached: predictedReplay.cached },
  }, source.project, [
    { kind: "hardware-replay", id: measuredReplay.id, path: measuredReplay.path, immutable: true },
    { kind: "simulation-replay", id: predictedReplay.id, path: predictedReplay.path, immutable: true },
    { kind: "studio-snapshot", id: studio.id, path: studio.path, immutable: false },
  ]);
}
