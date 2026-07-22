import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadController, loadResearch, loadTraining, loadTrainingResearch } from "@mujica/core";
import { validateResearchProposal, validateTrainingProposal } from "./commands";

const root = resolve(import.meta.dir, "../../..");
const binary = resolve(root, "packages/mujica-cli/src/bin.ts");

function invoke(args: string[]) {
  const result = Bun.spawnSync(["bun", binary, ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

describe("agent CLI contract", () => {
  test("help is machine discoverable", () => {
    const result = invoke(["help", "--json"]); const envelope = JSON.parse(result.stdout);
    expect(result.code).toBe(0);
    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "train")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "candidate")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "research")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "train-research")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "policy-revision.inspect")).toBe(true);
  });

  test("validation crosses the Python MuJoCo boundary", async () => {
    const result = invoke(["validate", "examples/quadruped", "--json"]); const envelope = JSON.parse(result.stdout);
    expect(result.code).toBe(0);
    expect(envelope.data.runtimeModels.map((item: { nu: number }) => item.nu)).toEqual([8, 8]);
    expect(envelope.data.runtimeModels.map((item: { nsensor: number }) => item.nsensor)).toEqual([2, 6]);
    expect(envelope.data.definitions.research).toBe(1);
    expect(envelope.data.definitions.trainingResearch).toBe(1);
    const lock = JSON.parse(await readFile(resolve(root, "examples/quadruped/benchmarks/sensor-development.lock.json"), "utf8"));
    expect(lock.harnessSourceHash).toHaveLength(64);
    expect(lock.evaluatorDependencyLockHash).toHaveLength(64);
  });

  test("a locked candidate preview is read-only and keeps its score evidence", () => {
    const result = invoke(["candidate", "examples/quadruped", "--candidate", "foot-force-recovery", "--json"]); const envelope = JSON.parse(result.stdout);
    expect(result.code).toBe(0);
    expect(envelope.data.verdict).toBe("KEEP");
    expect(envelope.data.scoreDelta).toBeGreaterThan(2);
    expect(envelope.data.allowedChangeHashes["controllers/force-aware-gait/controller.py"]).toHaveLength(64);
  });

  test("research revisions form one inspectable parent chain", () => {
    const result = invoke(["revisions", "examples/quadruped", "--json"]); const envelope = JSON.parse(result.stdout);
    expect(result.code).toBe(0);
    const revisions = envelope.data.revisions.sort((a: { appliedAt: string }, b: { appliedAt: string }) => a.appliedAt.localeCompare(b.appliedAt));
    expect(revisions.length).toBeGreaterThan(1);
    for (let index = 1; index < revisions.length; index++) expect(revisions[index].parent).toBe(revisions[index - 1].id);
    expect(revisions.at(-1).kind).toBe("research-optimization");
  });

  test("agent research proposals cannot escape declared values or bounds", async () => {
    const project = resolve(root, "examples/quadruped"); const research = await loadResearch(project, "support-controller"); const controller = await loadController(project, research.controller);
    expect(() => validateResearchProposal(research, controller.definition, { strategy: "escape", hypothesis: "edit hidden gain", expectedEffect: "unsafe", values: { "/config/frequencyHz": 2 } })).toThrow("not editable");
    expect(() => validateResearchProposal(research, controller.definition, { strategy: "out-of-bounds", hypothesis: "too stiff", expectedEffect: "unsafe", values: { "/config/kp": 100 } })).toThrow("outside");
  });

  test("training proposals are confined and preserve integer parameters", async () => {
    const project = resolve(root, "examples/quadruped"); const research = await loadTrainingResearch(project, "residual-policy"); const training = await loadTraining(project, research.training);
    expect(() => validateTrainingProposal(research, training, { strategy: "escape", hypothesis: "change task", expectedEffect: "unsafe", values: { "/gamma": 0.8 } })).toThrow("not editable");
    expect(() => validateTrainingProposal(research, training, { strategy: "fractional-steps", hypothesis: "fractional budget", expectedEffect: "invalid", values: { "/totalSteps": 3072.5 } })).toThrow("integer");
  });

  test("promoted policies and Policy Revisions expose runtime provenance", async () => {
    const revisionsResult = invoke(["policy-revisions", "examples/quadruped", "--json"]); const revisionsEnvelope = JSON.parse(revisionsResult.stdout); expect(revisionsResult.code).toBe(0); expect(revisionsEnvelope.data.revisions.length).toBeGreaterThan(0);
    const head = revisionsEnvelope.data.revisions.sort((a: { appliedAt: string }, b: { appliedAt: string }) => a.appliedAt.localeCompare(b.appliedAt)).at(-1); expect(head.kind).toBe("policy-optimization");
    const inspectResult = invoke(["policy", "inspect", "examples/quadruped", "--policy", head.policyId, "--json"]); const policy = JSON.parse(inspectResult.stdout); expect(inspectResult.code).toBe(0); expect(policy.data.manifest.runtimeVersion).toBe("0.2.0"); expect(policy.data.manifest.runtimeSourceHash).toHaveLength(64);
    const revisionResult = invoke(["policy-revision", "inspect", "examples/quadruped", "--revision", head.id, "--json"]); const revision = JSON.parse(revisionResult.stdout); expect(revisionResult.code).toBe(0); expect(revision.data.evaluation.candidate.cases[0].score.terms.trainingSteps).toBe(-0.02048);
  });
});
