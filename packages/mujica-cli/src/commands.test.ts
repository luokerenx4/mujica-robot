import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadController, loadResearch, loadTraining, loadTrainingResearch } from "@mujica/core";
import { candidateSelection, researchDecision, researchGateReasons, upperViolationSeverity, validateResearchProposal, validateTrainingProposal } from "./commands";

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
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "studio")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "hardware.export")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "hardware.verify")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "policy.requalify")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "controller.list")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "controller.inspect")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "diagnose")).toBe(true);
  });

  test("Controller discovery exposes legal Assembly combinations", () => {
    const result = invoke(["controller", "inspect", "examples/quadruped", "--controller", "latency-aware-spatial-gait", "--json"]); const envelope = JSON.parse(result.stdout);
    expect(result.code).toBe(0); expect(envelope.data.definition.interface.requiredObservations.at(-1)).toEqual({ name: "actuator-delay-steps", size: 1 });
    expect(envelope.data.compatibleAssemblies).toEqual(["command-conditioned-history-3dof", "force-sensing-history-3dof"]);
    expect(envelope.nextActions[0].argv.slice(0, 5)).toEqual(["simulate", resolve(root, "examples/quadruped"), "--assembly", "command-conditioned-history-3dof", "--controller"]);
    const ordinary = envelope.data.incompatibleAssemblies.find((item: any) => item.assembly === "force-sensing-3dof");
    expect(ordinary.issues).toEqual([{ code: "observation.missing", channel: "actuator-delay-steps", message: "Program Controller 'latency-aware-spatial-gait' requires Observation 'actuator-delay-steps' (size 1), but Assembly 'force-sensing-3dof' does not provide it" }]);
  });

  test("an incompatible Program Controller fails before Python Runtime invocation", () => {
    const result = invoke(["simulate", "examples/quadruped", "--assembly", "force-sensing-3dof", "--controller", "latency-aware-spatial-gait", "--task", "forward-walk", "--scenario", "nominal", "--json"]); const envelope = JSON.parse(result.stderr);
    expect(result.code).toBe(1); expect(envelope.error.message).toContain("requires Observation 'actuator-delay-steps'"); expect(envelope.error.message).not.toContain("Python Runtime"); expect(envelope.error.message).not.toContain("KeyError");
  });

  test("Studio is a read-only projection of a completed quadruped run", () => {
    const result = invoke(["studio", "examples/quadruped", "--run", "run-e8bd80892b0f0123", "--json"]); const envelope = JSON.parse(result.stdout);
    expect(result.code).toBe(0);
    expect(envelope.data.selectedRun).toBe("run-e8bd80892b0f0123");
    expect(envelope.data.snapshotHash).toHaveLength(64);
    expect(envelope.artifacts).toEqual([{ kind: "studio-snapshot", id: envelope.data.id, path: envelope.data.path, immutable: false }]);
  });

  test("validation crosses the Python MuJoCo boundary", async () => {
    const result = invoke(["validate", "examples/quadruped", "--json"]); const envelope = JSON.parse(result.stdout);
    expect(result.code).toBe(0);
    expect(envelope.data.runtimeModels.map((item: { nu: number }) => item.nu)).toEqual([8, 12, 8, 8, 8, 12, 12, 12, 8]);
    expect(envelope.data.runtimeModels.map((item: { nsensor: number }) => item.nsensor)).toEqual([2, 6, 2, 2, 6, 6, 6, 6, 2]);
    const baseline = envelope.data.runtimeModels.find((item: { assembly: string }) => item.assembly === "baseline"); const payload = envelope.data.runtimeModels.find((item: { assembly: string }) => item.assembly === "payload-equipped");
    expect(payload.ngeom).toBe(baseline.ngeom + 1); expect(payload.modelMassKg - baseline.modelMassKg).toBeCloseTo(0.2);
    expect(envelope.data.definitions.research).toBe(9);
    expect(envelope.data.definitions.trainingResearch).toBe(4);
    expect(envelope.data.definitions.hardwareTargets).toBe(1);
    const lock = JSON.parse(await readFile(resolve(root, "examples/quadruped/benchmarks/sensor-development.lock.json"), "utf8"));
    expect(lock.harnessSourceHash).toHaveLength(64);
    expect(lock.evaluatorDependencyLockHash).toHaveLength(64);
  }, 10_000);

  test("hardware dry-run evidence cannot masquerade as physical verification", () => {
    const exported = invoke(["hardware", "export", "examples/quadruped", "--target", "spatial-dry-run", "--json"]); const bundle = JSON.parse(exported.stdout); expect(exported.code).toBe(0);
    const verified = invoke(["hardware", "verify", "examples/quadruped", "--bundle", bundle.data.id, "--evidence", "examples/quadruped/hardware-evidence/spatial-dry-run.json", "--json"]); const result = JSON.parse(verified.stdout);
    expect(verified.code).toBe(0); expect(result.data.status).toBe("PROTOCOL-VERIFIED"); expect(result.data.protocolVerified).toBe(true); expect(result.data.hardwareVerified).toBe(false);
    expect(result.data.evidence.samples).toBe(250); expect(result.data.reasons).toEqual([]);
    const legacy = invoke(["hardware", "verify", "examples/quadruped", "--bundle", "hardware-f0b608d6d693dead", "--evidence", "examples/quadruped/hardware-verifications/verification-fe6210762029bd3f/evidence.json", "--json"]);
    expect(legacy.code).toBe(0); expect(JSON.parse(legacy.stdout).data.status).toBe("PROTOCOL-VERIFIED");
  });

  test("a locked candidate preview is read-only and keeps its score evidence", () => {
    const result = invoke(["candidate", "examples/quadruped", "--candidate", "foot-force-recovery", "--json"]); const envelope = JSON.parse(result.stdout);
    expect(result.code).toBe(0);
    expect(envelope.data.verdict).toBe("KEEP");
    expect(envelope.data.scoreDelta).toBeGreaterThan(2);
    expect(envelope.data.allowedChangeHashes["controllers/force-aware-gait/controller.py"]).toHaveLength(64);
    expect(envelope.data.verifiedChanges.observations.added).toEqual(["foot-contact-force"]);
    expect(envelope.data.proposedRevisionHash).toHaveLength(64);
    expect(envelope.data.proposedRevisionId).toMatch(/^quadruped-r-/);
  }, 15_000);

  test("trained component development is judged from frozen policies, not training completion", () => {
    const result = invoke(["candidate", "examples/quadruped", "--candidate", "trained-foot-force-recovery", "--json"]); const envelope = JSON.parse(result.stdout);
    expect(result.code).toBe(0);
    expect(envelope.data.candidate.changes.policy.from).toBe("baseline-locomotion-q-f3f505f0da5e8b5b");
    expect(envelope.data.candidate.changes.policy.to).toBe("force-aware-locomotion-q-890a561ecf989a0e");
    expect(envelope.data.verdict).toBe("REVERT");
    expect(envelope.data.scoreDelta).toBeLessThan(0);
    expect(envelope.data.gateReasons).toHaveLength(3);
  }, 15_000);

  test("forward locomotion promotion requires net progress in every gating case", () => {
    const result = invoke(["candidate", "examples/quadruped", "--candidate", "forward-locomotion", "--json"]); const envelope = JSON.parse(result.stdout);
    expect(result.code).toBe(0);
    expect(envelope.data.verdict).toBe("KEEP");
    expect(envelope.data.scoreDelta).toBeGreaterThan(20);
    expect(envelope.data.gateReasons).toEqual([]);
    const required = envelope.data.proposed.cases.filter((item: any) => item.case.gating);
    expect(required.every((item: any) => item.metrics.forwardProgress >= 0.25 && item.metrics.survivalRate >= 0.8 && item.metrics.lateralDrift <= 0.2)).toBe(true);
    const delay = envelope.data.proposed.cases.find((item: any) => item.case.id === "actuator-delay");
    expect(delay.case.gating).toBe(false);
    expect(delay.metrics.forwardProgress).toBe(0);
  }, 20_000);

  test("research revisions form one inspectable parent chain", () => {
    const result = invoke(["revisions", "examples/quadruped", "--json"]); const envelope = JSON.parse(result.stdout);
    expect(result.code).toBe(0);
    const revisions = envelope.data.revisions.sort((a: { appliedAt: string }, b: { appliedAt: string }) => a.appliedAt.localeCompare(b.appliedAt));
    expect(revisions.length).toBeGreaterThan(1);
    for (let index = 1; index < revisions.length; index++) expect(revisions[index].parent).toBe(revisions[index - 1].id);
    const spatial = revisions.find((item: any) => item.candidateId === "spatial-quadruped"); expect(spatial.aggregateScore).toBeCloseTo(62.616999752834296);
    expect(revisions.find((item: any) => item.id === "quadruped-r-45f394da4a24")).toMatchObject({ candidateId: "command-conditioned-locomotion", controller: "command-tracking-gait" });
  });

  test("command-conditioned locomotion passes command and legacy spatial gates", () => {
    const candidateResult = invoke(["candidate", "examples/quadruped", "--candidate", "command-conditioned-locomotion", "--json"]); const candidate = JSON.parse(candidateResult.stdout);
    expect(candidateResult.code).toBe(0); expect(candidate.data.verdict).toBe("KEEP"); expect(candidate.data.gateReasons).toEqual([]); expect(candidate.data.scoreDelta).toBeGreaterThan(5);
    expect(candidate.data.proposed.cases.every((item: any) => item.metrics.survivalRate >= 0.8 && item.metrics.lateralDrift <= 0.25 && item.metrics.planarVelocityTrackingError <= 0.22 && item.metrics.yawRateTrackingError <= 0.35 && (item.metrics.targetDistance === 0 || item.metrics.forwardProgress >= 0.2))).toBe(true);
    const spatialResult = invoke(["diagnose", "examples/quadruped", "--assembly", "command-conditioned-history-3dof", "--controller", "command-tracking-gait", "--benchmark", "spatial-generalization", "--json"]); const spatial = JSON.parse(spatialResult.stdout);
    expect(spatialResult.code).toBe(0); expect(spatial.data.status).toBe("PASS"); expect(spatial.data.violationCount).toBe(0);
  }, 30_000);

  test("Policy requalification requires byte-identical MJCF and contracts", () => {
    const result = invoke(["policy", "requalify", "examples/quadruped", "--policy", "spatial-residual-locomotion-81df145800cc15c7", "--assembly", "force-sensing-3dof", "--json"]); const envelope = JSON.parse(result.stdout);
    expect(result.code).toBe(0); expect(envelope.data.id).toBe("spatial-residual-locomotion-q-d3136275b7233448");
    expect(envelope.data.proof.oldModelHash).toBe(envelope.data.proof.newModelHash); expect(envelope.data.proof.executionHash).toHaveLength(64);
  });

  test("the promoted spatial policy exposes the corrected low-friction failure", () => {
    const result = invoke(["evaluate", "examples/quadruped", "--assembly", "force-sensing-3dof", "--controller", "spatial-residual-gait", "--benchmark", "spatial-robustness", "--json"]); const envelope = JSON.parse(result.stdout);
    expect(result.code).toBe(0);
    expect(envelope.data.evaluation.aggregateScore).toBeCloseTo(60.413012468635095);
    const ordinary = envelope.data.evaluation.cases.filter((item: any) => item.case.id !== "low-friction");
    expect(ordinary.every((item: any) => item.metrics.survivalRate >= 0.8 && item.metrics.forwardProgress >= 0.25 && item.metrics.lateralDrift <= 0.2)).toBe(true);
    const lowFriction = envelope.data.evaluation.cases.find((item: any) => item.case.id === "low-friction");
    expect(lowFriction.metrics.survivalRate).toBe(1); expect(lowFriction.metrics.forwardProgress).toBe(0);
    const delay = envelope.data.evaluation.cases.find((item: any) => item.case.id === "actuator-delay");
    expect(delay.metrics.survivalRate).toBe(1);
    expect(delay.metrics.forwardProgress).toBeGreaterThan(0.69);
  }, 15_000);

  test("diagnosis ranks measured gate failures separately from hypotheses", () => {
    const result = invoke(["diagnose", "examples/quadruped", "--assembly", "force-sensing-3dof", "--controller", "spatial-forward-gait", "--benchmark", "spatial-generalization", "--json"]); const envelope = JSON.parse(result.stdout);
    expect(result.code).toBe(0); expect(envelope.data.status).toBe("FAIL"); expect(envelope.data.violationCount).toBe(5); expect(envelope.data.worstCase).toBe("delay-plus-reset");
    expect(envelope.data.violations.map((item: any) => [item.case, item.id])).toContainEqual(["delay-plus-reset", "lateral-drift"]);
    const worst = envelope.data.cases[0]; const drift = worst.findings.find((item: any) => item.code === "gate.lateral-drift"); expect(drift).toMatchObject({ kind: "evidence", code: "gate.lateral-drift", comparator: "<=", threshold: 0.2 }); expect(drift.margin).toBeLessThan(-0.59);
    expect(worst.hypotheses[0]).toMatchObject({ kind: "hypothesis", surface: "controller" }); expect(worst.reproduceArgv).toContain("delayed-reset-perturbation");
    expect(envelope.nextActions[0]).toMatchObject({ id: "reproduce-worst-case", effect: "creates-artifact", argv: worst.reproduceArgv });
  }, 20_000);

  test("zero-threshold count gates use one event as the severity unit", () => {
    expect(upperViolationSeverity(0, 0, 1)).toBe(0);
    expect(upperViolationSeverity(1, 0, 1)).toBe(1);
    expect(upperViolationSeverity(2, 0, 1)).toBe(2);
  });

  test("candidate selection prioritizes reaching the feasible gate tier", () => {
    expect(candidateSelection([], -1.2, 6)).toEqual({ verdict: "KEEP", selectionReason: "fewer-gate-violations" });
    expect(candidateSelection([], 0.1, 0)).toEqual({ verdict: "KEEP", selectionReason: "score-improvement-within-feasibility-tier" });
    expect(candidateSelection([], -0.1, 0).verdict).toBe("REVERT");
    expect(candidateSelection(["braking failed"], 10, 6).verdict).toBe("REVERT");
  });

  test("agent research proposals cannot escape declared values or bounds", async () => {
    const project = resolve(root, "examples/quadruped"); const research = await loadResearch(project, "support-controller"); const controller = await loadController(project, research.controller);
    expect(() => validateResearchProposal(research, controller.definition, { strategy: "escape", hypothesis: "edit hidden gain", expectedEffect: "unsafe", values: { "/config/frequencyHz": 2 } })).toThrow("not editable");
    expect(() => validateResearchProposal(research, controller.definition, { strategy: "out-of-bounds", hypothesis: "too stiff", expectedEffect: "unsafe", values: { "/config/kp": 100 } })).toThrow("outside");
  });

  test("research preserves passing gates and orders infeasible candidates by severity", () => {
    const result = (drift: number, score: number) => ({ aggregateScore: score, cases: [{ case: { id: "compound", gating: true }, metrics: { survivalRate: 1, targetDistance: 1, forwardProgress: 0.4, lateralDrift: drift, planarVelocityTrackingError: 0, yawRateTrackingError: 0 }, score: { total: score } }] });
    const objective = { gates: { minimumSurvivalRate: 0.8, minimumForwardProgress: 0.25, minimumSignedForwardProgress: -1_000_000, maximumBackwardDisplacement: 1_000_000, maximumBackwardPitchRad: 1_000_000, maximumAbsolutePitchRad: 1_000_000, maximumAbsolutePitchRateRadPerSec: 1_000_000, maximumBodyTiltRad: 1_000_000, maximumLateralDrift: 0.2, maximumPlanarVelocityTrackingError: 1, maximumYawRateTrackingError: 1, maximumTransitionTerminalPlanarTrackingError: 1_000_000, maximumTransitionTerminalYawRateTrackingError: 1_000_000, maximumPlanarSettlingTimeSeconds: 1_000_000, maximumPlanarBrakingSettlingTimeSeconds: 1_000_000, maximumYawRateSettlingTimeSeconds: 1_000_000, maximumPlanarOvershootMps: 1_000_000, maximumYawRateOvershootRadPerSec: 1_000_000, maximumUnsettledPlanarTransitions: 1_000_000, maximumUnsettledYawRateTransitions: 1_000_000, maximumRegression: 20 } };
    expect(researchGateReasons(objective as any, result(0.4, 50) as any, result(0.8, 55) as any, result(0.7, 56) as any)).toEqual([]);
    expect(researchDecision(objective as any, result(0.4, 50) as any, result(0.8, 55) as any, result(0.7, 54) as any, 0.01)).toMatchObject({ verdict: "KEEP", severityImproved: true, selectionReason: "lower-gate-violation-severity" });
    expect(researchGateReasons(objective as any, result(0.4, 50) as any, result(0.1, 55) as any, result(0.3, 56) as any)).toEqual(["compound: lateral-drift regressed from passing to failing"]);
    const feasibility = researchDecision(objective as any, result(0.4, 50) as any, result(0.4, 60) as any, result(0.1, 57) as any, 0.01);
    expect(feasibility).toMatchObject({ verdict: "KEEP", previousViolationCount: 1, candidateViolationCount: 0, feasibilityImproved: true, scoreImproved: false, selectionReason: "fewer-gate-violations" });
    expect(researchDecision(objective as any, result(0.4, 50) as any, result(0.1, 60) as any, result(0.1, 57) as any, 0.01).verdict).toBe("REVERT");
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
    expect(policy.data.architecture.actionTransform.residualScale).toBe(0.5);
    const revisionResult = invoke(["policy-revision", "inspect", "examples/quadruped", "--revision", head.id, "--json"]); const revision = JSON.parse(revisionResult.stdout); expect(revisionResult.code).toBe(0); expect(revision.data.evaluation.candidate.cases[0].score.terms.trainingSteps).toBe(-0.04096);
  });
});
