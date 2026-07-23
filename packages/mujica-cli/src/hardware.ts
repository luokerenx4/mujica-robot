import { access, cp, lstat, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, join, resolve } from "node:path";
import { atomicDirectory, confined, hardwareCaptureAuthorizationSchema, hardwareEvidenceSchema, hardwareTargetSchema, hashDirectory, hashJson, listHardwareCapturePlanIds, loadHardwareCapturePlan, loadHardwareTarget, loadProject, readJson, sha256, stableJson, writeJson, type HardwareCaptureAuthorization, type HardwareCapturePlanDefinition, type HardwareTargetDefinition } from "@mujica/core";
import { success, type Artifact } from "./contract";
import { harnessDependencyLockHash, harnessSourceHash, invokeRuntime, runtimeSourceHash, runtimeVersion } from "./runtime";

async function exists(path: string): Promise<boolean> { try { await stat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } }
const artifact = (kind: Artifact["kind"], id: string, path: string): Artifact => ({ kind, id, path, immutable: true });

async function verifyBundleIntegrity(root: string, bundle: any): Promise<void> {
  const payload = {
    version: bundle.version, harnessSourceHash: bundle.harnessSourceHash, harnessDependencyLockHash: bundle.harnessDependencyLockHash,
    ...(typeof bundle.sourceKind === "string" ? { sourceKind: bundle.sourceKind } : {}),
    ...(typeof bundle.maximumCaptureMode === "string" ? { maximumCaptureMode: bundle.maximumCaptureMode } : {}),
    target: bundle.target, revisionId: bundle.revisionId, revisionHash: bundle.revisionHash, assemblyHash: bundle.assemblyHash,
    ...(typeof bundle.modelXmlHash === "string" ? { modelXmlHash: bundle.modelXmlHash } : {}),
    controllerHash: bundle.controllerHash, ...(typeof bundle.policyHash === "string" ? { policyHash: bundle.policyHash } : {}),
    observationContractHash: bundle.observationContractHash, actionContractHash: bundle.actionContractHash, protocol: bundle.protocol,
  };
  if (hashJson(payload) !== bundle.bundleHash) throw new Error("Hardware Bundle manifest identity is invalid");
  if (await hashDirectory(join(root, "revision")) !== bundle.revisionHash) throw new Error("Hardware Bundle Revision snapshot was modified");
  if (await hashDirectory(join(root, "controller")) !== bundle.controllerHash) throw new Error("Hardware Bundle Controller snapshot was modified");
  if (typeof bundle.policyHash === "string") {
    const controller = JSON.parse(await readFile(join(root, "controller", "controller.json"), "utf8"));
    if (controller.kind !== "policy" || await hashDirectory(join(root, "policies", controller.policy)) !== bundle.policyHash) throw new Error("Hardware Bundle Policy snapshot was modified");
  }
  const observation = JSON.parse(await readFile(join(root, "observation-contract.json"), "utf8")); const action = JSON.parse(await readFile(join(root, "action-contract.json"), "utf8"));
  if (hashJson(observation) !== bundle.observationContractHash || hashJson(action) !== bundle.actionContractHash) throw new Error("Hardware Bundle contract snapshot was modified");
  const target = JSON.parse(await readFile(join(root, "target.json"), "utf8")); if (stableJson(target) !== stableJson(bundle.target)) throw new Error("Hardware Bundle Target snapshot was modified");
}

export function validateCaptureAuthorization(target: HardwareTargetDefinition, plan: HardwareCapturePlanDefinition, planHash: string, bundle: any, operator: string, authorization: HardwareCaptureAuthorization | null, now = Date.now()): void {
  if (target.environment === "dry-run") {
    if (authorization !== null) throw new Error("Dry-run Capture must not consume physical-device authorization");
    return;
  }
  if (authorization === null) throw new Error(`${target.environment.toUpperCase()} Capture requires --authorization`);
  if (authorization.plan !== plan.id || authorization.planHash !== planHash || authorization.target !== target.id || authorization.bundleHash !== bundle.bundleHash || authorization.environment !== target.environment) throw new Error("Capture authorization does not match Plan, Bundle, Target, or environment");
  if (authorization.operator !== operator) throw new Error("Capture operator does not match authorization");
  if (authorization.maximumEpisodes < plan.episodes.length) throw new Error("Capture authorization episode ceiling is below the Plan");
  if (Date.parse(authorization.approvedAt) > now || Date.parse(authorization.expiresAt) <= now || Date.parse(authorization.expiresAt) <= Date.parse(authorization.approvedAt)) throw new Error("Capture authorization is not currently valid");
}

export function assertCaptureModeAllowed(bundle: any, plan: HardwareCapturePlanDefinition): void {
  if (bundle.maximumCaptureMode === "shadow" && plan.mode !== "shadow") {
    throw new Error(`Capture Plan '${plan.id}' cannot actuate shadow-only ${bundle.sourceKind === "policy-revision" ? "Policy Revision" : "Hardware"} Bundle '${bundle.id}'`);
  }
}

export function assertCaptureDecisionDeadline(target: HardwareTargetDefinition, plan: HardwareCapturePlanDefinition): void {
  if (plan.safety.maximumDecisionLatencyMs !== undefined && plan.safety.maximumDecisionLatencyMs > target.safety.maximumLatencyMs) {
    throw new Error(`Capture Plan '${plan.id}' decision deadline cannot exceed Hardware Target maximumLatencyMs`);
  }
}

export async function verifyHardwareCaptureIntegrity(root: string): Promise<any> {
  const manifestPath = join(root, "manifest.json"); const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.completed !== true || typeof manifest.id !== "string" || typeof manifest.captureHash !== "string") throw new Error("Hardware Capture is incomplete");
  const transcriptBytes = await readFile(join(root, "transcript.ndjson"));
  for (const line of transcriptBytes.toString().split("\n").filter(Boolean)) JSON.parse(line);
  if (sha256(transcriptBytes) !== manifest.transcriptHash) throw new Error("Hardware Capture transcript identity is invalid");
  const episodeHashes: Record<string, string> = {};
  for (const episode of manifest.episodes ?? []) {
    if (!episode.completed) continue;
    const path = confined(root, episode.path); const bytes = await readFile(path);
    if (sha256(bytes) !== episode.hash) throw new Error(`Hardware Capture episode '${episode.id}' bytes changed`);
    for (const line of bytes.toString().split("\n").filter(Boolean)) JSON.parse(line);
    episodeHashes[episode.id] = sha256(bytes);
  }
  if (stableJson(episodeHashes) !== stableJson(manifest.episodeHashes)) throw new Error("Hardware Capture episode identity is invalid");
  for (let index = 0; index < (manifest.driverInputs ?? []).length; index++) {
    const input = manifest.driverInputs[index]; const path = join(root, "driver-inputs", `${String(index).padStart(2, "0")}-${input.name}`);
    if (sha256(await readFile(path)) !== input.hash) throw new Error(`Hardware Capture driver input '${input.name}' changed`);
  }
  if (manifest.authorizationHash !== null) {
    if (sha256(await readFile(join(root, "authorization.json"))) !== manifest.authorizationHash) throw new Error("Hardware Capture authorization bytes changed");
  }
  const commissioningIdentity = typeof manifest.mode === "string" ? {
    mode: manifest.mode,
    actuationAuthorized: manifest.actuationAuthorized,
    protocolCapabilities: manifest.protocolCapabilities,
    stateAgeIdentity: manifest.stateAgeIdentity,
    ...(manifest.decisionDeadlineIdentity && typeof manifest.decisionDeadlineIdentity === "object" ? { decisionDeadlineIdentity: manifest.decisionDeadlineIdentity } : {}),
    emergencyStopAcknowledgements: manifest.emergencyStopAcknowledgements,
    ...(typeof manifest.controllerWarmupPasses === "number" ? { controllerWarmupPasses: manifest.controllerWarmupPasses } : {}),
    ...(typeof manifest.realTimeQualified === "boolean" ? { realTimeQualified: manifest.realTimeQualified } : {}),
  } : {};
  const identity = {
    version: manifest.version,
    planHash: manifest.planHash,
    bundleHash: manifest.bundleHash,
    driverHash: manifest.driverHash,
    driverArgs: manifest.driverArgs,
    driverInputs: manifest.driverInputs,
    device: manifest.device,
    operator: manifest.operator,
    authorizationHash: manifest.authorizationHash,
    startedAt: manifest.startedAt,
    endedAt: manifest.endedAt,
    status: manifest.status,
    transcriptHash: manifest.transcriptHash,
    episodeHashes: manifest.episodeHashes,
    runtimeSourceHash: manifest.runtimeSourceHash,
    harnessSourceHash: manifest.harnessSourceHash,
    ...commissioningIdentity,
  };
  if (hashJson(identity) !== manifest.captureHash || manifest.id !== `capture-${manifest.captureHash.slice(0, 16)}`) throw new Error("Hardware Capture manifest identity is invalid");
  return manifest;
}

function frozenRuntimeCompiled(compiled: any, modelHash: string) {
  const actionLow = compiled.actionContract.channels.flatMap((channel: any) => Array(channel.size).fill(channel.low ?? -1));
  const actionHigh = compiled.actionContract.channels.flatMap((channel: any) => Array(channel.size).fill(channel.high ?? 1));
  const executionHash = hashJson({ modelHash, observationContract: compiled.observationContract, actionContract: compiled.actionContract });
  return { ...compiled, modelHash, executionHash, actionLow, actionHigh, observationContractHash: hashJson(compiled.observationContract), actionContractHash: hashJson(compiled.actionContract) };
}

export async function hardwareExportCommand(projectDir: string, targetId: string) {
  const project = await loadProject(projectDir); const target = await loadHardwareTarget(project.rootDir, targetId);
  const sourceKind = (target.revisionKind ?? "robot") === "policy" ? "policy-revision" : "robot-revision";
  const maximumCaptureMode = sourceKind === "policy-revision" ? "shadow" : "actuate";
  const revisionRoot = confined(project.rootDir, `${sourceKind === "policy-revision" ? "policy-revisions" : "revisions"}/${target.revision}`); const revision = JSON.parse(await readFile(join(revisionRoot, "manifest.json"), "utf8"));
  if (revision.assembly !== target.assembly || revision.controller !== target.controller) throw new Error(`Hardware Target does not match its ${sourceKind === "policy-revision" ? "Policy" : "Robot"} Revision`);
  if (sourceKind === "policy-revision") {
    if (revision.kind !== "research-lab-policy") throw new Error("Hardware Target source is not a Policy Revision");
    const evaluation = JSON.parse(await readFile(join(revisionRoot, "evaluation.json"), "utf8"));
    if (evaluation.decision?.verdict !== "KEEP") throw new Error("Policy Revision was not kept by its locked Judge");
  }
  const compiledRoot = join(revisionRoot, "compiled"); const compiled = JSON.parse(await readFile(join(compiledRoot, "compiled-assembly.json"), "utf8"));
  const observationContract = JSON.parse(await readFile(join(compiledRoot, "observation-contract.json"), "utf8")); const actionContract = JSON.parse(await readFile(join(compiledRoot, "action-contract.json"), "utf8"));
  const observationContractHash = hashJson(observationContract); const actionContractHash = hashJson(actionContract);
  if (revision.assemblyHash !== compiled.assemblyHash) throw new Error("Hardware source Revision compiled snapshot identity is invalid");
  const controllerRoot = join(revisionRoot, "sources", "controllers", target.controller); if (!(await exists(join(controllerRoot, "controller.json")))) throw new Error("Hardware source Revision does not contain its Controller source snapshot");
  const controllerDefinition = JSON.parse(await readFile(join(controllerRoot, "controller.json"), "utf8"));
  let policyRoot: string | null = null; let policyHash: string | null = null;
  if (controllerDefinition.kind === "policy") {
    policyRoot = join(revisionRoot, "policy");
    if (!(await exists(join(policyRoot, "manifest.json")))) throw new Error("Policy Hardware Target Revision lacks its frozen Policy snapshot");
    const policyManifest = JSON.parse(await readFile(join(policyRoot, "manifest.json"), "utf8"));
    if (policyManifest.id !== controllerDefinition.policy) throw new Error("Hardware Target Controller and Revision Policy differ");
    policyHash = await hashDirectory(policyRoot);
    if (typeof revision.policyHash === "string" && revision.policyHash !== policyHash) throw new Error("Policy Revision frozen Policy identity is invalid");
    if (policyManifest.assemblyHash !== revision.assemblyHash || policyManifest.observationContractHash !== observationContractHash || policyManifest.actionContractHash !== actionContractHash) throw new Error("Policy Revision frozen Policy contracts do not match its compiled Assembly");
  } else if (sourceKind === "policy-revision") {
    throw new Error("Policy Revision Hardware Target requires a Policy Controller");
  }
  const controllerHash = await hashDirectory(controllerRoot); const [harnessHash, dependencyHash] = await Promise.all([harnessSourceHash(), harnessDependencyLockHash()]);
  const modelXmlHash = sha256(await readFile(join(compiledRoot, "model.xml")));
  const payload = { version: 1, harnessSourceHash: harnessHash, harnessDependencyLockHash: dependencyHash, sourceKind, maximumCaptureMode, target, revisionId: revision.id, revisionHash: await hashDirectory(revisionRoot), assemblyHash: revision.assemblyHash, modelXmlHash, controllerHash, ...(policyHash ? { policyHash } : {}), observationContractHash, actionContractHash, protocol: target.protocol };
  const bundleHash = hashJson(payload); const id = `hardware-${bundleHash.slice(0, 16)}`; const root = join(project.rootDir, "hardware-bundles", id);
  if (!(await exists(join(root, "manifest.json")))) await atomicDirectory(root, async (directory) => {
    await cp(revisionRoot, join(directory, "revision"), { recursive: true }); await cp(controllerRoot, join(directory, "controller"), { recursive: true });
    if (policyRoot) await cp(policyRoot, join(directory, "policies", controllerDefinition.policy), { recursive: true });
    await writeJson(join(directory, "target.json"), target); await writeJson(join(directory, "observation-contract.json"), observationContract); await writeJson(join(directory, "action-contract.json"), actionContract);
    await writeJson(join(directory, "driver-protocol.json"), {
      version: 1,
      protocol: "stdio-jsonl-v1",
      handshake: { bundleHash, observationContractHash, actionContractHash },
      capabilities: ["applied-action", "decision-deadline", "shadow-action", "state-age-ms", "stop-ack"],
      messages: ["hello", "start-episode", "state", "action", "shadow-action", "deadline-rejected", "safe-stop", "emergency-stop", "stopped", "close", "completed"],
      state: { required: ["episode", "step", "qpos", "qvel", "observation", "appliedAction", "stateAgeMs"] },
    });
    await writeJson(join(directory, "manifest.json"), { ...payload, id, bundleHash, completed: true });
  });
  return success("hardware.export", { id, bundleHash, path: root, sourceKind, maximumCaptureMode, target, observationContractHash, actionContractHash, verificationStatus: "UNVERIFIED" }, project, [artifact("hardware-bundle", id, root)]);
}

export async function hardwareVerifyCommand(projectDir: string, bundleId: string, evidencePath: string) {
  const project = await loadProject(projectDir); const bundleRoot = confined(project.rootDir, `hardware-bundles/${bundleId}`); const bundle = JSON.parse(await readFile(join(bundleRoot, "manifest.json"), "utf8"));
  await verifyBundleIntegrity(bundleRoot, bundle); const target = hardwareTargetSchema.parse(bundle.target); const evidence = await readJson(resolve(evidencePath), hardwareEvidenceSchema);
  const reasons: string[] = [];
  if (evidence.target !== target.id) reasons.push("evidence target does not match bundle"); if (evidence.bundleHash !== bundle.bundleHash) reasons.push("evidence bundle hash does not match");
  if (evidence.environment !== target.environment) reasons.push("evidence environment does not match target");
  if (evidence.observationContractHash !== bundle.observationContractHash || evidence.actionContractHash !== bundle.actionContractHash) reasons.push("evidence contract hashes do not match bundle");
  if (evidence.device.vendor !== target.device.vendor || evidence.device.model !== target.device.model) reasons.push("device identity does not match target");
  if (target.device.serialRequired && /^(unknown|simulated|none)$/i.test(evidence.device.serial)) reasons.push("target requires a physical device serial");
  if (Date.parse(evidence.endedAt) <= Date.parse(evidence.startedAt)) reasons.push("evidence time interval is invalid");
  if (evidence.maximumObservedLatencyMs > target.safety.maximumLatencyMs) reasons.push("observed latency exceeds safety limit");
  if (target.safety.maximumStateAgeMs !== undefined && evidence.maximumObservedStateAgeMs === undefined) reasons.push("evidence does not report state age");
  if (target.safety.maximumStateAgeMs !== undefined && evidence.maximumObservedStateAgeMs !== undefined && evidence.maximumObservedStateAgeMs > target.safety.maximumStateAgeMs) reasons.push("observed state age exceeds safety limit");
  if (evidence.maximumConsecutiveMissesObserved > target.safety.maximumConsecutiveMisses) reasons.push("consecutive deadline misses exceed safety limit");
  if (target.safety.requireDecisionDeadline && (evidence.decisionDeadlineRejections ?? 0) < 1) reasons.push("evidence does not prove driver-side decision deadline rejection");
  if (target.safety.maximumStateAgeMs !== undefined && evidence.emergencyStopAcknowledgements === undefined) reasons.push("evidence does not report emergency-stop acknowledgements");
  else if (evidence.emergencyStopAcknowledgements !== undefined && evidence.emergencyStopAcknowledgements < evidence.emergencyStops) reasons.push("not every emergency stop was acknowledged");
  if (!evidence.passed) reasons.push("driver reported failure");
  const status = reasons.length ? "FAILED" : bundle.maximumCaptureMode === "shadow" ? "SHADOW-VERIFIED" : evidence.environment === "dry-run" ? "PROTOCOL-VERIFIED" : "HARDWARE-VERIFIED";
  const verificationHash = hashJson({ bundleHash: bundle.bundleHash, evidence }); const id = `verification-${verificationHash.slice(0, 16)}`; const root = join(project.rootDir, "hardware-verifications", id);
  if (!(await exists(join(root, "manifest.json")))) await atomicDirectory(root, async (directory) => {
    await writeFile(join(directory, "evidence.json"), await readFile(resolve(evidencePath))); await writeJson(join(directory, "bundle-manifest.json"), bundle);
    await writeFile(join(directory, "report.md"), `# Hardware verification\n\n- Status: ${status}\n- Source: ${bundle.sourceKind ?? "legacy-robot-revision"}\n- Maximum capture mode: ${bundle.maximumCaptureMode ?? "actuate"}\n- Environment: ${evidence.environment}\n- Device: ${evidence.device.vendor} ${evidence.device.model} (${evidence.device.serial})\n- Samples: ${evidence.samples}\n- Maximum latency: ${evidence.maximumObservedLatencyMs} ms\n- Maximum state age: ${evidence.maximumObservedStateAgeMs ?? "not reported"} ms\n- Missed deadlines: ${evidence.missedDeadlines}\n- Driver decision-deadline rejections: ${evidence.decisionDeadlineRejections ?? "not reported"}\n- Emergency-stop acknowledgements: ${evidence.emergencyStopAcknowledgements ?? "not reported"} / ${evidence.emergencyStops}\n${reasons.map((reason) => `- Gate: ${reason}\n`).join("")}`);
    await writeJson(join(directory, "manifest.json"), { version: 1, id, verificationHash, bundleId, bundleHash: bundle.bundleHash, sourceKind: bundle.sourceKind ?? "legacy-robot-revision", maximumCaptureMode: bundle.maximumCaptureMode ?? "actuate", target: target.id, environment: evidence.environment, status, hardwareVerified: status === "HARDWARE-VERIFIED", protocolVerified: status !== "FAILED", actuationQualified: status === "HARDWARE-VERIFIED" && bundle.maximumCaptureMode !== "shadow", reasons, completed: true });
  });
  return success("hardware.verify", { id, path: root, status, hardwareVerified: status === "HARDWARE-VERIFIED", protocolVerified: status !== "FAILED", actuationQualified: status === "HARDWARE-VERIFIED" && bundle.maximumCaptureMode !== "shadow", reasons, evidence }, project, [artifact("hardware-verification", id, root)]);
}

export async function hardwareCapturePlanListCommand(projectDir: string) {
  const project = await loadProject(projectDir); const plans = [];
  for (const id of await listHardwareCapturePlanIds(project.rootDir)) {
    const definition = await loadHardwareCapturePlan(project.rootDir, id);
    plans.push({ definition, hash: hashJson(definition) });
  }
  const captures = [];
  const capturesRoot = join(project.rootDir, "hardware-captures");
  try {
    for (const entry of (await readdir(capturesRoot, { withFileTypes: true })).filter((item) => item.isDirectory() && !item.name.startsWith(".")).sort((a, b) => a.name.localeCompare(b.name))) {
      const manifest = await verifyHardwareCaptureIntegrity(join(capturesRoot, entry.name));
      captures.push({ id: manifest.id, status: manifest.status, environment: manifest.environment, plan: manifest.plan, calibrationEligible: manifest.calibrationEligible, startedAt: manifest.startedAt });
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return success("capture.list", { plans, captures }, project);
}

export async function hardwareCapturePlanInspectCommand(projectDir: string, id: string) {
  const project = await loadProject(projectDir); const definition = await loadHardwareCapturePlan(project.rootDir, id);
  const bundleRoot = confined(project.rootDir, `hardware-bundles/${definition.bundle}`);
  const bundle = JSON.parse(await readFile(join(bundleRoot, "manifest.json"), "utf8")); await verifyBundleIntegrity(bundleRoot, bundle); assertCaptureModeAllowed(bundle, definition);
  assertCaptureDecisionDeadline(hardwareTargetSchema.parse(bundle.target), definition);
  return success("capture.inspect", { definition, hash: hashJson(definition), bundle: { id: bundle.id, hash: bundle.bundleHash, sourceKind: bundle.sourceKind ?? "legacy-robot-revision", maximumCaptureMode: bundle.maximumCaptureMode ?? "actuate", environment: bundle.target.environment }, path: confined(project.rootDir, `capture-plans/${id}.capture.json`) }, project);
}

export async function hardwareCaptureInspectCommand(projectDir: string, id: string) {
  const project = await loadProject(projectDir); const root = confined(project.rootDir, `hardware-captures/${id}`); const manifest = await verifyHardwareCaptureIntegrity(root);
  return success("capture.inspect", { manifest, path: root }, project);
}

export async function hardwareCaptureCommand(projectDir: string, planId: string, driver: string, driverArgs: string[], driverInputs: string[], operator: string, authorizationPath?: string) {
  const project = await loadProject(projectDir); const plan = await loadHardwareCapturePlan(project.rootDir, planId); const planHash = hashJson(plan);
  const bundleRoot = confined(project.rootDir, `hardware-bundles/${plan.bundle}`); const bundle = JSON.parse(await readFile(join(bundleRoot, "manifest.json"), "utf8"));
  await verifyBundleIntegrity(bundleRoot, bundle); assertCaptureModeAllowed(bundle, plan);
  if (bundle.target.id !== plan.target) throw new Error(`Capture Plan '${plan.id}' target differs from Hardware Bundle '${bundle.id}'`);
  const executable = resolve(driver); const driverStat = await lstat(executable);
  if (!driverStat.isFile() || driverStat.isSymbolicLink()) throw new Error("Capture driver must be a regular non-symlink executable file");
  await access(executable, constants.X_OK);
  const driverHash = sha256(await readFile(executable));
  const frozenDriverInputs = [];
  for (const input of driverInputs) {
    const path = resolve(input); const inputStat = await lstat(path);
    if (!inputStat.isFile() || inputStat.isSymbolicLink()) throw new Error("Capture driver inputs must be regular non-symlink files");
    frozenDriverInputs.push({ path, name: basename(path), hash: sha256(await readFile(path)) });
  }
  const target = hardwareTargetSchema.parse(bundle.target);
  assertCaptureDecisionDeadline(target, plan);
  let authorization: any = null; let authorizationHash: string | null = null;
  if (target.environment !== "dry-run") {
    if (!authorizationPath) throw new Error(`${target.environment.toUpperCase()} Capture requires --authorization`);
    const authorizationFile = resolve(authorizationPath); authorization = await readJson(authorizationFile, hardwareCaptureAuthorizationSchema); authorizationHash = sha256(await readFile(authorizationFile));
  }
  validateCaptureAuthorization(target, plan, planHash, bundle, operator, authorization);
  const compiled = JSON.parse(await readFile(join(bundleRoot, "revision", "compiled", "compiled-assembly.json"), "utf8"));
  if (compiled.assemblyHash !== bundle.assemblyHash || sha256(await readFile(join(bundleRoot, "revision", "compiled", "model.xml"))) !== bundle.modelXmlHash) throw new Error("Hardware Bundle frozen Assembly or model identity is invalid");
  const controller = JSON.parse(await readFile(join(bundleRoot, "controller", "controller.json"), "utf8"));
  if (controller?.kind !== "program" && controller?.kind !== "policy") throw new Error("Hardware Bundle Controller kind is invalid");
  const totalSeconds = plan.episodes.reduce((sum, episode) => sum + episode.steps / target.controlHz, 0);
  const result = await invokeRuntime("hardware-capture", {
    runtimeVersion,
    runtimeSourceHash: await runtimeSourceHash(),
    harnessSourceHash: await harnessSourceHash(),
    projectDir: project.rootDir,
    bundleRoot,
    bundle,
    compiled: frozenRuntimeCompiled(compiled, bundle.modelXmlHash),
    controller,
    capturePlan: plan,
    planHash,
    driverPath: executable,
    driverArgs,
    driverHash,
    driverInputs: frozenDriverInputs,
    operator,
    authorization,
    authorizationHash,
    authorizationText: authorizationPath ? await readFile(resolve(authorizationPath), "utf8") : null,
  }, Math.ceil((totalSeconds * 4 + 30) * 1000));
  return success("capture.run", result, project, [artifact("hardware-capture", result.captureId, result.artifactPath)], [
    { id: "inspect-capture-plan", description: "Inspect the frozen capture authority and Bundle", argv: ["capture", "inspect", project.rootDir, "--plan", plan.id], effect: "read-only" },
  ]);
}
