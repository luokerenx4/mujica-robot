import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { confined, hashJson } from "@mujica/core";

export async function loadReflexSearch(
  projectDir: string,
  id: string,
): Promise<{ root: string; manifest: any; evaluation: any; demonstrations: any[] }> {
  const root = confined(projectDir, `reflex-searches/${id}`);
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`Reflex Search '${id}' is not a real artifact directory`);
  }
  for (const name of ["manifest.json", "evaluation.json", "demonstrations.json"]) {
    const fileStat = await lstat(join(root, name));
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
      throw new Error(`Reflex Search '${id}' contains an unsafe '${name}'`);
    }
  }
  const [manifest, evaluation, demonstrations] = await Promise.all([
    readFile(join(root, "manifest.json"), "utf8").then(JSON.parse),
    readFile(join(root, "evaluation.json"), "utf8").then(JSON.parse),
    readFile(join(root, "demonstrations.json"), "utf8").then(JSON.parse),
  ]);
  const evaluationHash = hashJson(evaluation);
  const demonstrationsHash = hashJson(demonstrations);
  if (
    manifest.version !== 1
    || manifest.kind !== "mujica-impact-reflex-search"
    || manifest.id !== id
    || manifest.completed !== true
    || manifest.evaluationHash !== evaluationHash
    || manifest.demonstrationsHash !== demonstrationsHash
    || evaluation.demonstrations?.hash !== demonstrationsHash
    || evaluation.demonstrations?.count !== demonstrations.length
    || id !== `reflex-search-${evaluationHash.slice(0, 16)}`
  ) {
    throw new Error(`Reflex Search '${id}' failed integrity verification`);
  }
  return { root, manifest, evaluation, demonstrations };
}
