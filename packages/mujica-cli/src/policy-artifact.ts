import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { confined, hashDirectory, hashJson, sha256 } from "@mujica/core";

const REQUIRED_POLICY_FILES = [
  "manifest.json",
  "architecture.json",
  "normalizer.json",
  "observation-contract.json",
  "action-contract.json",
  "model.pt",
] as const;

export async function loadFrozenPolicyArtifact(projectDir: string, id: string) {
  const root = confined(projectDir, `policies/${id}`);
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`Policy '${id}' is not a real artifact directory`);
  }
  for (const name of REQUIRED_POLICY_FILES) {
    const fileStat = await lstat(join(root, name));
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
      throw new Error(`Policy '${id}' contains an unsafe '${name}'`);
    }
  }
  const [
    manifest,
    architecture,
    normalizerBytes,
    observationContract,
    actionContract,
    model,
    policyHash,
  ] = await Promise.all([
    readFile(join(root, "manifest.json"), "utf8").then(JSON.parse),
    readFile(join(root, "architecture.json"), "utf8").then(JSON.parse),
    readFile(join(root, "normalizer.json")),
    readFile(join(root, "observation-contract.json"), "utf8").then(JSON.parse),
    readFile(join(root, "action-contract.json"), "utf8").then(JSON.parse),
    readFile(join(root, "model.pt")),
    hashDirectory(root),
  ]);
  const modelHash = sha256(model);
  const normalizer = JSON.parse(normalizerBytes.toString("utf8"));
  const architectureHash = hashJson(architecture);
  const normalizerHash = sha256(normalizerBytes);
  if (
    manifest.version !== 1
    || manifest.id !== id
    || manifest.modelHash !== modelHash
    || manifest.observationContractHash !== hashJson(observationContract)
    || manifest.actionContractHash !== hashJson(actionContract)
    || architecture.observationSize !== observationContract.size
    || architecture.actionSize !== actionContract.size
    || !Number.isFinite(normalizer.count)
    || !Array.isArray(normalizer.mean)
    || !Array.isArray(normalizer.variance)
    || normalizer.mean.length !== observationContract.size
    || normalizer.variance.length !== observationContract.size
  ) {
    throw new Error(`Policy '${id}' failed immutable artifact verification`);
  }
  const trainingRunId = String(manifest.createdByTrainingRun ?? "");
  const trainingRunRoot = confined(projectDir, `training-runs/${trainingRunId}`);
  const [trainingRun, trainingResult] = await Promise.all([
    readFile(join(trainingRunRoot, "manifest.json"), "utf8").then(JSON.parse),
    readFile(join(trainingRunRoot, "result.json"), "utf8").then(JSON.parse),
  ]);
  const trainedPolicyId = String(manifest.derivedFromPolicy ?? manifest.id);
  if (
    trainingRun.id !== trainingRunId
    || trainingRun.policyId !== trainedPolicyId
    || trainingRun.completed !== true
    || trainingResult.policyId !== trainedPolicyId
    || trainingResult.modelHash !== manifest.modelHash
  ) {
    throw new Error(`Policy '${id}' failed immutable training lineage verification`);
  }
  return {
    root,
    manifest,
    architecture,
    normalizer,
    observationContract,
    actionContract,
    policyHash,
    modelHash,
    architectureHash,
    normalizerHash,
    trainingRunId,
  };
}
