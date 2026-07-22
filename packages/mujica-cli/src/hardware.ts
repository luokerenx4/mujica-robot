import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { atomicDirectory, compileAssembly, confined, hardwareEvidenceSchema, hardwareTargetSchema, hashDirectory, hashJson, loadHardwareTarget, loadProject, readJson, stableJson, writeJson } from "@mujica/core";
import { success, type Artifact } from "./contract";
import { harnessDependencyLockHash, harnessSourceHash } from "./runtime";

async function exists(path: string): Promise<boolean> { try { await stat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } }
const artifact = (kind: Artifact["kind"], id: string, path: string): Artifact => ({ kind, id, path, immutable: true });

async function verifyBundleIntegrity(root: string, bundle: any): Promise<void> {
  const payload = { version: bundle.version, harnessSourceHash: bundle.harnessSourceHash, harnessDependencyLockHash: bundle.harnessDependencyLockHash, target: bundle.target, revisionId: bundle.revisionId, revisionHash: bundle.revisionHash, assemblyHash: bundle.assemblyHash, controllerHash: bundle.controllerHash, observationContractHash: bundle.observationContractHash, actionContractHash: bundle.actionContractHash, protocol: bundle.protocol };
  if (hashJson(payload) !== bundle.bundleHash) throw new Error("Hardware Bundle manifest identity is invalid");
  if (await hashDirectory(join(root, "revision")) !== bundle.revisionHash) throw new Error("Hardware Bundle Revision snapshot was modified");
  if (await hashDirectory(join(root, "controller")) !== bundle.controllerHash) throw new Error("Hardware Bundle Controller snapshot was modified");
  const observation = JSON.parse(await readFile(join(root, "observation-contract.json"), "utf8")); const action = JSON.parse(await readFile(join(root, "action-contract.json"), "utf8"));
  if (hashJson(observation) !== bundle.observationContractHash || hashJson(action) !== bundle.actionContractHash) throw new Error("Hardware Bundle contract snapshot was modified");
  const target = JSON.parse(await readFile(join(root, "target.json"), "utf8")); if (stableJson(target) !== stableJson(bundle.target)) throw new Error("Hardware Bundle Target snapshot was modified");
}

export async function hardwareExportCommand(projectDir: string, targetId: string) {
  const project = await loadProject(projectDir); const target = await loadHardwareTarget(project.rootDir, targetId); const assembly = await compileAssembly(project.rootDir, target.assembly);
  const revisionRoot = confined(project.rootDir, `revisions/${target.revision}`); const revision = JSON.parse(await readFile(join(revisionRoot, "manifest.json"), "utf8"));
  if (revision.assembly !== target.assembly || revision.controller !== target.controller) throw new Error("Hardware Target does not match its Robot Revision");
  if (revision.assemblyHash !== assembly.assemblyHash) throw new Error("Robot Revision Assembly is stale against current project source; export from the immutable Revision snapshot instead");
  const controllerRoot = join(revisionRoot, "sources", "controllers", target.controller); if (!(await exists(join(controllerRoot, "controller.json")))) throw new Error("Robot Revision does not contain its Controller source snapshot");
  const controllerHash = await hashDirectory(controllerRoot); const [harnessHash, dependencyHash] = await Promise.all([harnessSourceHash(), harnessDependencyLockHash()]);
  const observationContractHash = hashJson(assembly.observationContract); const actionContractHash = hashJson(assembly.actionContract);
  const payload = { version: 1, harnessSourceHash: harnessHash, harnessDependencyLockHash: dependencyHash, target, revisionId: revision.id, revisionHash: await hashDirectory(revisionRoot), assemblyHash: assembly.assemblyHash, controllerHash, observationContractHash, actionContractHash, protocol: target.protocol };
  const bundleHash = hashJson(payload); const id = `hardware-${bundleHash.slice(0, 16)}`; const root = join(project.rootDir, "hardware-bundles", id);
  if (!(await exists(join(root, "manifest.json")))) await atomicDirectory(root, async (directory) => {
    await cp(revisionRoot, join(directory, "revision"), { recursive: true }); await cp(controllerRoot, join(directory, "controller"), { recursive: true });
    await writeJson(join(directory, "target.json"), target); await writeJson(join(directory, "observation-contract.json"), assembly.observationContract); await writeJson(join(directory, "action-contract.json"), assembly.actionContract);
    await writeJson(join(directory, "driver-protocol.json"), { version: 1, protocol: "stdio-jsonl-v1", handshake: { bundleHash, observationContractHash, actionContractHash }, messages: ["hello", "observation", "action", "emergency-stop", "completed"] });
    await writeJson(join(directory, "manifest.json"), { ...payload, id, bundleHash, completed: true });
  });
  return success("hardware.export", { id, bundleHash, path: root, target, observationContractHash, actionContractHash, verificationStatus: "UNVERIFIED" }, project, [artifact("hardware-bundle", id, root)]);
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
  if (evidence.maximumConsecutiveMissesObserved > target.safety.maximumConsecutiveMisses) reasons.push("consecutive deadline misses exceed safety limit");
  if (!evidence.passed) reasons.push("driver reported failure");
  const status = reasons.length ? "FAILED" : evidence.environment === "dry-run" ? "PROTOCOL-VERIFIED" : "HARDWARE-VERIFIED";
  const verificationHash = hashJson({ bundleHash: bundle.bundleHash, evidence }); const id = `verification-${verificationHash.slice(0, 16)}`; const root = join(project.rootDir, "hardware-verifications", id);
  if (!(await exists(join(root, "manifest.json")))) await atomicDirectory(root, async (directory) => {
    await writeFile(join(directory, "evidence.json"), await readFile(resolve(evidencePath))); await writeJson(join(directory, "bundle-manifest.json"), bundle);
    await writeFile(join(directory, "report.md"), `# Hardware verification\n\n- Status: ${status}\n- Environment: ${evidence.environment}\n- Device: ${evidence.device.vendor} ${evidence.device.model} (${evidence.device.serial})\n- Samples: ${evidence.samples}\n- Maximum latency: ${evidence.maximumObservedLatencyMs} ms\n- Missed deadlines: ${evidence.missedDeadlines}\n${reasons.map((reason) => `- Gate: ${reason}\n`).join("")}`);
    await writeJson(join(directory, "manifest.json"), { version: 1, id, verificationHash, bundleId, bundleHash: bundle.bundleHash, target: target.id, environment: evidence.environment, status, hardwareVerified: status === "HARDWARE-VERIFIED", protocolVerified: status !== "FAILED", reasons, completed: true });
  });
  return success("hardware.verify", { id, path: root, status, hardwareVerified: status === "HARDWARE-VERIFIED", protocolVerified: status !== "FAILED", reasons, evidence }, project, [artifact("hardware-verification", id, root)]);
}
