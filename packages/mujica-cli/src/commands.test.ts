import { describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { hashJson, loadController, loadResearch, loadResearchLab, loadTraining, loadTrainingResearch } from "@mujica/core";
import { assertDomainProfilePlantCompatible, candidateSelection, researchDecision, researchGateReasons, upperViolationSeverity, validateResearchProposal, validateTrainingProposal } from "./commands";
import { assertResearchLabEditableChanges, policyReferenceGateReasons, researchPathIsEditable, selectResearchReviewCase, trainingRunStableResultIdentity } from "./research-lab";
import { assertCaptureDecisionDeadline, assertCaptureModeAllowed, validateCaptureAuthorization } from "./hardware";

const root = resolve(import.meta.dir, "../../..");
const binary = resolve(root, "packages/mujica-cli/src/bin.ts");

function invoke(args: string[]) {
  const result = Bun.spawnSync(["bun", binary, ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

describe("agent CLI contract", () => {
  test("Training rejects a Domain Profile bound to another physical plant", () => {
    const assembly = { id: "history-assembly", plantHash: "a".repeat(64) };
    expect(() => assertDomainProfilePlantCompatible({ id: "legacy-profile" }, assembly)).not.toThrow();
    expect(() => assertDomainProfilePlantCompatible({ id: "matching-profile", plantHash: "a".repeat(64) }, assembly)).not.toThrow();
    expect(() => assertDomainProfilePlantCompatible({ id: "wrong-profile", plantHash: "b".repeat(64) }, assembly))
      .toThrow("plantHash does not match Assembly");
  });

  test("Policy Lab reference gates cannot be hidden by improving on a worse Policy", () => {
    const referenceDecision = {
      verdict: "REVERT" as const, gateReasons: [], previousViolationCount: 3, candidateViolationCount: 3,
      previousViolationSeverity: 1, candidateViolationSeverity: 1.1, feasibilityImproved: false,
      severityImproved: false, scoreImproved: true, selectionReason: "no-lexicographic-improvement" as const,
    };
    expect(policyReferenceGateReasons(referenceDecision, ["motion-quality: delayed drift"]))
      .toEqual(["reference-controller: no-lexicographic-improvement", "motion-quality: delayed drift"]);
    expect(policyReferenceGateReasons({ ...referenceDecision, verdict: "KEEP", selectionReason: "fewer-gate-violations" }, []))
      .toEqual([]);
  });

  test("help is machine discoverable", () => {
    const result = invoke(["help", "--json"]); const envelope = JSON.parse(result.stdout);
    expect(result.code).toBe(0);
    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "train")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "candidate")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "research")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "research.run")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "research.inspect")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "research.brief")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "research.brief.inspect")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "research.review.inspect")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "train-research")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "policy-revision.inspect")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "studio")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "evidence.inspect")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "observation.record")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "hardware.export")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "hardware.verify")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "capture.run")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "policy.requalify")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "controller.list")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "controller.inspect")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "diagnose")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "domain.inspect")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "driver.inspect")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "calibrate")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "calibration.promote")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "project.create")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "project.list")).toBe(true);
  });

  test("creates and discovers an independently chartered hexapod project atomically", async () => {
    const workspace = await mkdtemp(resolve(tmpdir(), "mujica-workspace-"));
    try {
      await mkdir(resolve(workspace, "projects"));
      await writeFile(resolve(workspace, "mujica-workspace.json"), JSON.stringify({
        version: 1, name: "Lifecycle test", projectsDirectory: "projects", defaultProject: null,
      }));
      const created = invoke(["project", "create", workspace, "--id", "field-hexapod", "--name", "Field Hexapod", "--template", "hexapod", "--json"]);
      expect(created.code).toBe(0);
      expect(JSON.parse(created.stdout).data).toMatchObject({
        project: { id: "field-hexapod", charter: "development-charter.json" },
        charter: { morphology: { class: "legged", limbCount: 6 } },
        template: "hexapod",
      });
      const listed = invoke(["project", "list", workspace, "--json"]);
      expect(JSON.parse(listed.stdout).data.projects).toMatchObject([{ id: "field-hexapod", morphology: { limbCount: 6 } }]);
      const inspected = invoke(["project", "inspect", workspace, "--project", "field-hexapod", "--json"]);
      const inspectedData = JSON.parse(inspected.stdout).data;
      expect(inspectedData.assemblies[0]).toMatchObject({ id: "hexapod", actionSize: 12 });
      expect(inspectedData.assemblies[0].morphology.contactPoints).toHaveLength(6);
      expect(inspectedData.assemblies[0].morphology.contactPoints[0].id).toBe("front-left");
      const duplicate = invoke(["project", "create", workspace, "--id", "field-hexapod", "--name", "Duplicate", "--template", "hexapod", "--json"]);
      expect(duplicate.code).toBe(1);
      expect(JSON.parse(duplicate.stderr).error.message).toContain("already exists");

      const projectRoot = resolve(workspace, "projects", "field-hexapod");
      const charterPath = resolve(projectRoot, "development-charter.json");
      const charter = JSON.parse(await readFile(charterPath, "utf8"));
      charter.capabilityStages[0].scenarios[0].scenario = "missing-scene";
      await writeFile(charterPath, JSON.stringify(charter));
      const invalid = invoke(["validate", projectRoot, "--json"]);
      expect(invalid.code).toBe(1);
      expect(JSON.parse(invalid.stderr).error.message).toContain("missing-scene");

      charter.capabilityStages[0].scenarios[0].scenario = "nominal";
      charter.northStar.stage = "missing-stage";
      await writeFile(charterPath, JSON.stringify(charter));
      const invalidNorthStar = invoke(["validate", projectRoot, "--json"]);
      expect(invalidNorthStar.code).toBe(1);
      expect(JSON.parse(invalidNorthStar.stderr).error.message).toContain("missing-stage");

      charter.northStar.stage = "nominal-foundation";
      charter.northStar.benchmark = "missing-benchmark";
      await writeFile(charterPath, JSON.stringify(charter));
      const invalidNorthStarBenchmark = invoke(["validate", projectRoot, "--json"]);
      expect(invalidNorthStarBenchmark.code).toBe(1);
      expect(JSON.parse(invalidNorthStarBenchmark.stderr).error.message).toContain("is not named by stage");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("reviews one robot requirement from compiled design through locked north-star evidence", () => {
    const first = invoke(["project", "review", "examples", "--project", "hexapod", "--json"]);
    expect(first.code).toBe(0);
    const data = JSON.parse(first.stdout).data;
    expect(data.review).toMatchObject({
      project: "hexapod",
      subject: { assembly: "hexapod", controller: "tripod-gait" },
      summary: {
        status: "HUMAN_REVIEW_REQUIRED",
        designPassed: true,
        passedStages: 1,
        totalStages: 1,
        violationCount: 0,
        interventionSurfaces: [{ surface: "human-review" }],
      },
      northStar: {
        benchmark: "starter-locomotion",
        numericalSatisfied: true,
        satisfied: false,
        humanReviewStatus: "REQUIRED",
      },
      stages: [{ id: "nominal-foundation", authoredStatus: "active", observedStatus: "PASS" }],
    });
    expect(data.review.design.constraints).toHaveLength(5);
    expect(data.review.design.constraints.every((constraint: { passed: boolean }) => constraint.passed)).toBe(true);
    expect(data.review.benchmarks[0].cases[0].gates.length).toBeGreaterThan(0);
    expect(data.reviewHash).toBe(hashJson(data.review));
    const repeated = invoke(["project", "review", "examples", "--project", "hexapod", "--json"]);
    expect(JSON.parse(repeated.stdout).data.id).toBe(data.id);
    const inspected = invoke(["project", "inspect", "examples", "--project", "hexapod", "--json"]);
    expect(JSON.parse(inspected.stdout).data.developmentReviews).toContain(data.id);
  }, 20_000);

  test("keeps numerically satisfied Review evidence below human acceptance", () => {
    const result = invoke(["project", "work", "examples/quadruped", "--json"]);
    expect(result.code).toBe(0);
    const data = JSON.parse(result.stdout).data;
    expect(data.workOrder).toMatchObject({
      kind: "mujica-development-work-order",
      project: "quadruped",
      status: "HUMAN_REVIEW_REQUIRED",
      subject: { assembly: "resilient-command-conditioned-history-3dof", controller: "behavior-supervisor" },
      authorityBoundary: {
        prioritization: "derived",
        experimentDecision: "locked-judge",
        sourcePromotion: "verdict-governed",
        northStarClaim: "new-development-review-required",
      },
    });
    expect(data.workOrder.blockers.find((item: any) => item.benchmark === "self-righting")).toBeUndefined();
    expect(data.workOrder.blockers.find((item: any) => item.benchmark === "resilient-mission")).toBeUndefined();
    expect(data.workOrder.blockers.find((item: any) => item.benchmark === "sim-to-real-audit" && item.case === "heavy-weak")).toBeDefined();
    expect(data.workOrder.lanes).toEqual([]);
    expect(data.workOrder.uncoveredSurfaces.some((item: any) => item.surface === "human-review")).toBe(true);
    expect(data.workOrderHash).toBe(hashJson(data.workOrder));
    expect(invoke(["project", "work", "examples/quadruped", "--review", data.workOrder.review.id, "--json"]).code).toBe(0);
  }, 20_000);

  test("keeps numerical success below the north star when the robot violates its design envelope", async () => {
    const workspace = await mkdtemp(resolve(tmpdir(), "mujica-design-envelope-"));
    try {
      await mkdir(resolve(workspace, "projects"));
      await writeFile(resolve(workspace, "mujica-workspace.json"), JSON.stringify({
        version: 1, name: "Design envelope test", projectsDirectory: "projects", defaultProject: null,
      }));
      expect(invoke(["project", "create", workspace, "--id", "heavy-hexapod", "--name", "Heavy Hexapod", "--template", "hexapod", "--json"]).code).toBe(0);
      const projectRoot = resolve(workspace, "projects", "heavy-hexapod");
      expect(invoke(["benchmark", "lock", projectRoot, "--benchmark", "starter-locomotion", "--json"]).code).toBe(0);
      const charterPath = resolve(projectRoot, "development-charter.json");
      const charter = JSON.parse(await readFile(charterPath, "utf8"));
      charter.designConstraints.maximumTotalMassKg = 1;
      charter.northStar.requireHumanReview = false;
      await writeFile(charterPath, JSON.stringify(charter));
      const reviewed = invoke(["project", "review", projectRoot, "--json"]);
      expect(reviewed.code).toBe(0);
      const review = JSON.parse(reviewed.stdout).data.review;
      expect(review.summary).toMatchObject({
        status: "DEVELOPMENT_REQUIRED",
        designPassed: false,
        violationCount: 0,
        interventionSurfaces: [{ surface: "design" }],
      });
      expect(review.northStar).toMatchObject({ numericalSatisfied: false, satisfied: false });
      expect(review.design.constraints.find((constraint: { id: string }) => constraint.id === "total-mass")).toMatchObject({
        comparator: "<=",
        value: 6.2,
        threshold: 1,
        passed: false,
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }, 20_000);

  test("human and Agent debugging share exact Run and Capture evidence contexts", async () => {
    const runId = "run-e8bd80892b0f0123";
    const comparisonRunId = "run-0307db1a1c3dc228";
    const runManifest = JSON.parse(await readFile(resolve(root, `examples/quadruped/runs/${runId}/manifest.json`), "utf8"));
    const comparisonManifest = JSON.parse(await readFile(resolve(root, `examples/quadruped/runs/${comparisonRunId}/manifest.json`), "utf8"));
    const contextResult = invoke(["evidence", "inspect", "examples/quadruped", "--run", runId, "--time", "0.04", "--compare-run", comparisonRunId, "--json"]);
    const context = JSON.parse(contextResult.stdout).data;
    expect(contextResult.code).toBe(0);
    expect(context).toMatchObject({
      kind: "mujica-run-frame-context",
      authority: "immutable-evidence",
      baseline: { runId, resultHash: runManifest.resultHash, simulationStep: 2 },
      subject: { runId: comparisonRunId, resultHash: comparisonManifest.resultHash },
    });
    expect(context.contextHash).toHaveLength(64);
    expect(context.baseline.artifactHashes.trajectory).toHaveLength(64);
    expect(context.baseline.controller).toEqual({ phase: null, telemetry: null });
    expect(context.motionQualityDeltaSubjectMinusBaseline).toHaveProperty("meanJointJerkRadPerSec3");

    const captureId = "capture-91a394ba19589331";
    const captureManifest = JSON.parse(await readFile(resolve(root, `examples/quadruped/hardware-captures/${captureId}/manifest.json`), "utf8"));
    const captureResult = invoke(["evidence", "inspect", "examples/quadruped", "--capture", captureId, "--event", "6", "--json"]);
    const captureContext = JSON.parse(captureResult.stdout).data;
    expect(captureResult.code).toBe(0);
    expect(captureContext).toMatchObject({
      kind: "mujica-hardware-capture-event-context",
      authority: "immutable-evidence",
      capture: { id: captureId, captureHash: captureManifest.captureHash, status: "ABORTED" },
      eventIndex: 6,
      event: { direction: "driver-to-host", message: { type: "lease-expired" } },
    });
    expect(captureContext.neighboringEvents.map((item: any) => item.eventIndex)).toEqual([4, 5, 6, 7, 8]);

    const temporary = await mkdtemp(resolve(tmpdir(), "mujica-human-observation-"));
    const draftPath = resolve(temporary, "draft.json");
    await writeFile(draftPath, JSON.stringify({
      version: 1,
      kind: "mujica-human-observation-draft",
      source: {
        kind: "run-frame",
        runId,
        resultHash: runManifest.resultHash,
        timeSeconds: 0.04,
        comparisonRunId,
        comparisonResultHash: comparisonManifest.resultHash,
      },
      assessment: {
        category: "motion",
        severity: "investigate",
        confidence: "high",
        summary: "The subject front feet appear to slap down sooner than the baseline.",
        details: "Inspect contact impact and Action slew around this shared frame.",
        suggestedNextAction: "Compare contact-impact peaks before changing the reward.",
      },
    }));
    let artifactPath: string | undefined;
    let briefPath: string | undefined;
    let researchSessionPath: string | undefined;
    try {
      const recorded = invoke(["observation", "record", "examples/quadruped", "--input", draftPath, "--observer", "Human reviewer", "--json"]);
      const envelope = JSON.parse(recorded.stdout);
      expect(recorded.code).toBe(0);
      artifactPath = envelope.data.path;
      expect(envelope.data.manifest).toMatchObject({
        kind: "mujica-human-observation",
        authority: "human",
        claimKind: "hypothesis",
        observer: "Human reviewer",
        contextHash: context.contextHash,
      });
      expect(envelope.artifacts).toEqual([{ kind: "human-observation", id: envelope.data.id, path: artifactPath, immutable: true }]);
      const inspected = invoke(["observation", "inspect", "examples/quadruped", "--observation", envelope.data.id, "--json"]);
      expect(inspected.code).toBe(0);
      expect(JSON.parse(inspected.stdout).data.context.contextHash).toBe(context.contextHash);
      const listed = invoke(["observation", "list", "examples/quadruped", "--json"]);
      expect(JSON.parse(listed.stdout).data.observations.map((item: any) => item.id)).toContain(envelope.data.id);
      const briefed = invoke([
        "research", "brief", "examples/quadruped",
        "--lab", "motion-quality-residual-policy",
        "--observation", envelope.data.id,
        "--json",
      ]);
      expect({ code: briefed.code, stderr: briefed.stderr }).toEqual({ code: 0, stderr: "" });
      const briefEnvelope = JSON.parse(briefed.stdout);
      briefPath = briefEnvelope.data.path;
      expect(briefEnvelope.data.brief).toMatchObject({
        kind: "mujica-research-brief",
        authority: "derived-handoff",
        claimKind: "research-prioritization",
        lab: { definition: { id: "motion-quality-residual-policy", execution: { kind: "policy" } } },
        authorityBoundary: {
          humanInput: "hypothesis-only",
          sourceContext: "immutable-evidence",
          sourceEdits: "lab-closure-only",
          promotion: "locked-judge-only",
        },
      });
      expect(briefEnvelope.data.brief.observations[0]).toMatchObject({
        id: envelope.data.id,
        observationHash: envelope.data.observationHash,
        contextHash: context.contextHash,
        context: { contextHash: context.contextHash },
      });
      expect(briefEnvelope.artifacts).toEqual([{ kind: "research-brief", id: briefEnvelope.data.id, path: briefPath, immutable: true }]);
      const briefInspect = invoke(["research", "brief", "inspect", "examples/quadruped", "--brief", briefEnvelope.data.id, "--json"]);
      expect(briefInspect.code).toBe(0);
      expect(JSON.parse(briefInspect.stdout).data.briefHash).toBe(briefEnvelope.data.briefHash);
      const sameBrief = invoke([
        "research", "brief", "examples/quadruped",
        "--lab", "motion-quality-residual-policy",
        "--observation", envelope.data.id,
        "--json",
      ]);
      expect(JSON.parse(sameBrief.stdout).data.id).toBe(briefEnvelope.data.id);
      const duplicated = invoke([
        "research", "brief", "examples/quadruped",
        "--lab", "motion-quality-residual-policy",
        "--observation", envelope.data.id,
        "--observation", envelope.data.id,
        "--json",
      ]);
      expect(duplicated.code).toBe(1);
      expect(JSON.parse(duplicated.stderr).error.message).toContain("must be unique");
      const verifyBriefAgent = "python3 -c 'import json,sys; r=json.load(sys.stdin); b=r[\"researchBrief\"]; assert r[\"version\"] == 3; assert r[\"researchBriefId\"].startswith(\"brief-\"); assert b[\"authorityBoundary\"][\"humanInput\"] == \"hypothesis-only\"; assert b[\"authorityBoundary\"][\"promotion\"] == \"locked-judge-only\"; print(json.dumps({\"strategy\":\"brief-transport-smoke\",\"hypothesis\":\"Verify exact Research Brief transport without editing source.\",\"expectedEffect\":\"The Harness should reject the no-change proposal after preserving Brief provenance.\"}))'";
      const briefedRun = invoke([
        "research", "run", "examples/quadruped",
        "--lab", "motion-quality-residual-policy",
        "--brief", briefEnvelope.data.id,
        "--iterations", "1",
        "--agent-command", verifyBriefAgent,
        "--json",
      ]);
      expect({ code: briefedRun.code, stderr: briefedRun.stderr }).toEqual({ code: 0, stderr: "" });
      const runEnvelope = JSON.parse(briefedRun.stdout);
      expect(runEnvelope.data).toMatchObject({
        researchBriefId: briefEnvelope.data.id,
        researchBriefHash: briefEnvelope.data.briefHash,
        iterationsCompleted: 1,
      });
      expect(runEnvelope.data.experiments[0]).toMatchObject({
        verdict: "CRASH",
        error: "Researcher produced no source changes",
      });
      const sessionArtifactPath = runEnvelope.artifacts.find((item: any) => item.kind === "research-session").path;
      researchSessionPath = sessionArtifactPath;
      expect(JSON.parse(await readFile(resolve(sessionArtifactPath, "brief.json"), "utf8"))).toEqual(briefEnvelope.data.brief);
      const experimentManifest = JSON.parse(await readFile(resolve(runEnvelope.data.experiments[0].artifactPath, "manifest.json"), "utf8"));
      expect(experimentManifest).toMatchObject({
        version: 4,
        researchBriefId: briefEnvelope.data.id,
        researchBriefHash: briefEnvelope.data.briefHash,
      });
      const wrongLab = invoke([
        "research", "run", "examples/quadruped",
        "--lab", "upright-residual-policy",
        "--brief", briefEnvelope.data.id,
        "--iterations", "1",
        "--agent-command", "false",
        "--json",
      ]);
      expect(wrongLab.code).toBe(1);
      expect(JSON.parse(wrongLab.stderr).error.message).toContain("stale or belongs to another");
      const briefManifestPath = resolve(briefEnvelope.data.path, "manifest.json");
      const briefManifest = JSON.parse(await readFile(briefManifestPath, "utf8"));
      await writeFile(briefManifestPath, JSON.stringify({ ...briefManifest, manifestHash: "0".repeat(64) }));
      const tamperedBrief = invoke(["research", "brief", "inspect", "examples/quadruped", "--brief", briefEnvelope.data.id, "--json"]);
      expect(tamperedBrief.code).toBe(1);
      expect(JSON.parse(tamperedBrief.stderr).error.message).toContain("invalid identity");
      const contextPath = resolve(envelope.data.path, "context.json");
      const storedContext = JSON.parse(await readFile(contextPath, "utf8"));
      await writeFile(contextPath, JSON.stringify({ ...storedContext, requestedTimeSeconds: 0.06 }));
      const tampered = invoke(["observation", "inspect", "examples/quadruped", "--observation", envelope.data.id, "--json"]);
      expect(tampered.code).toBe(1);
      expect(JSON.parse(tampered.stderr).error.message).toContain("context identity is invalid");

      const invalidDraftPath = resolve(temporary, "invalid.json");
      await writeFile(invalidDraftPath, JSON.stringify({
        ...JSON.parse(await readFile(draftPath, "utf8")),
        source: { ...JSON.parse(await readFile(draftPath, "utf8")).source, resultHash: "0".repeat(64) },
      }));
      const rejected = invoke(["observation", "record", "examples/quadruped", "--input", invalidDraftPath, "--observer", "Human reviewer", "--json"]);
      expect(rejected.code).toBe(1);
      expect(JSON.parse(rejected.stderr).error.message).toContain("source identity differs");
    } finally {
      if (researchSessionPath) rmSync(researchSessionPath, { recursive: true, force: true });
      if (briefPath) rmSync(briefPath, { recursive: true, force: true });
      if (artifactPath) rmSync(artifactPath, { recursive: true, force: true });
      rmSync(temporary, { recursive: true, force: true });
    }
  }, 60_000);

  test("device telemetry replay gives humans and Agents the same immutable Capture frame", async () => {
    const captureId = "capture-5c09b673d06e0385";
    const episodeId = "learned-policy-shadow";
    const captureRoot = resolve(root, "examples/quadruped/hardware-captures", captureId);
    const capture = JSON.parse(await readFile(resolve(captureRoot, "manifest.json"), "utf8"));
    const episode = capture.episodes.find((item: any) => item.id === episodeId);

    const inspected = invoke([
      "evidence", "inspect", "examples/quadruped",
      "--capture", captureId, "--episode", episodeId, "--time", "0.04", "--json",
    ]);
    expect({ code: inspected.code, stderr: inspected.stderr }).toEqual({ code: 0, stderr: "" });
    const context = JSON.parse(inspected.stdout).data;
    expect(context).toMatchObject({
      kind: "mujica-hardware-capture-frame-context",
      authority: "immutable-device-telemetry",
      capture: {
        id: captureId,
        captureHash: capture.captureHash,
        bundleHash: capture.bundleHash,
        mode: "shadow",
      },
      episode: { id: episodeId, hash: episode.hash },
      requestedTimeSeconds: 0.04,
      rowTimeSeconds: 0.04,
      deviceStep: 2,
      row: {
        episode: episodeId,
        step: 2,
        deviceHealth: { watchdogHealthy: true, estopEngaged: false },
      },
      projectionBoundary: {
        kinematics: "device-reported",
        geometry: "bundle-frozen-digital-twin",
        visualGroundTruth: false,
        hardwareVerification: "unchanged",
      },
    });
    expect(context.row.qpos).toHaveLength(19);
    expect(context.row.proposedAction).toHaveLength(12);
    expect(context.row.commandedAction).toEqual(Array(12).fill(0));
    expect(context.row.appliedAction).toEqual(Array(12).fill(0));

    const studio = invoke([
      "studio", "examples/quadruped",
      "--capture", captureId, "--episode", episodeId, "--json",
    ]);
    expect({ code: studio.code, stderr: studio.stderr }).toEqual({ code: 0, stderr: "" });
    const studioEnvelope = JSON.parse(studio.stdout);
    expect(studioEnvelope.data).toMatchObject({
      selectedRun: null,
      comparisonRun: null,
      hardwareCapture: {
        id: captureId,
        captureHash: capture.captureHash,
        episodeId,
        episodeHash: episode.hash,
        mode: "shadow",
      },
      replay: { frameCount: 11 },
    });
    expect(studioEnvelope.artifacts.map((item: any) => item.kind)).toEqual(["hardware-replay", "studio-snapshot"]);
    const snapshot = JSON.parse(await readFile(resolve(studioEnvelope.data.path, "snapshot.json"), "utf8"));
    expect(snapshot).toMatchObject({
      version: 9,
      selectedRun: null,
      comparisonRun: null,
      selectedHardwareCapture: {
        id: captureId,
        captureHash: capture.captureHash,
        episode: { id: episodeId, hash: episode.hash },
        authorityBoundary: {
          kinematics: "device-reported",
          geometry: "bundle-frozen-digital-twin",
          visualGroundTruth: false,
          hardwareVerification: "unchanged",
          actuationAuthority: "unchanged",
        },
      },
      selectedHardwareReplay: {
        kind: "mujica-hardware-capture-replay",
        frameBase: "hardware-replay/frames",
        frameCount: 11,
      },
    });
    const html = await readFile(resolve(studioEnvelope.data.path, "index.html"), "utf8");
    expect(html).toContain("Device telemetry → frozen MuJoCo digital twin");
    expect(html).toContain("mujica-hardware-capture-frame-selector");
    expect(html).toContain("not camera footage, motion capture, physical contact truth");

    const temporary = await mkdtemp(resolve(tmpdir(), "mujica-device-observation-"));
    const draftPath = resolve(temporary, "draft.json");
    await writeFile(draftPath, JSON.stringify({
      version: 1,
      kind: "mujica-human-observation-draft",
      source: {
        kind: "hardware-capture-frame",
        captureId,
        captureHash: capture.captureHash,
        bundleHash: capture.bundleHash,
        episodeId,
        episodeHash: episode.hash,
        timeSeconds: 0.04,
      },
      assessment: {
        category: "control",
        severity: "investigate",
        confidence: "medium",
        summary: "The proposed torque is visible while shadow mode correctly applies zero torque.",
      },
    }));
    let observationPath: string | undefined;
    try {
      const recorded = invoke(["observation", "record", "examples/quadruped", "--input", draftPath, "--observer", "Device replay reviewer", "--json"]);
      expect({ code: recorded.code, stderr: recorded.stderr }).toEqual({ code: 0, stderr: "" });
      const observation = JSON.parse(recorded.stdout).data;
      observationPath = observation.path;
      expect(observation.manifest.source).toMatchObject({
        kind: "hardware-capture-frame",
        captureId,
        episodeId,
        episodeHash: episode.hash,
        timeSeconds: 0.04,
      });
      const observationInspect = invoke(["observation", "inspect", "examples/quadruped", "--observation", observation.id, "--json"]);
      expect(observationInspect.code).toBe(0);
      expect(JSON.parse(observationInspect.stdout).data.context).toMatchObject({
        kind: "mujica-hardware-capture-frame-context",
        capture: { id: captureId },
        episode: { id: episodeId },
        deviceStep: 2,
      });
    } finally {
      if (observationPath) rmSync(observationPath, { recursive: true, force: true });
      rmSync(temporary, { recursive: true, force: true });
    }
  }, 30_000);

  test("Digital Twin Audit gives Studio and Agents the same one-step device residual", async () => {
    const captureId = "capture-5c09b673d06e0385";
    const episodeId = "learned-policy-shadow";
    const audited = invoke(["twin", "audit", "examples/quadruped", "--capture", captureId, "--episode", episodeId, "--json"]);
    expect({ code: audited.code, stderr: audited.stderr }).toEqual({ code: 0, stderr: "" });
    const envelope = JSON.parse(audited.stdout);
    expect(envelope.data.id).toMatch(/^twin-audit-/);
    expect(envelope.data).toMatchObject({
      transitionCount: 10,
      source: { captureId, episodeId, mode: "shadow" },
      authority: {
        measurement: "immutable-device-telemetry",
        prediction: "frozen-digital-twin",
        claim: "derived-model-fit-evidence",
        changesHardwareVerified: false,
        grantsActuation: false,
        promotesCalibration: false,
      },
    });
    expect(envelope.data.metrics.jointPositionRad.rmse).toBeGreaterThan(0);
    expect(envelope.data.metrics.jointVelocityRadPerSec.worstTransition).toBe(6);
    expect(envelope.artifacts).toEqual([{ kind: "digital-twin-audit", id: envelope.data.id, path: envelope.data.path, immutable: true }]);

    const inspected = invoke(["twin", "inspect", "examples/quadruped", "--audit", envelope.data.id, "--transition", "6", "--json"]);
    expect({ code: inspected.code, stderr: inspected.stderr }).toEqual({ code: 0, stderr: "" });
    const inspection = JSON.parse(inspected.stdout).data;
    expect(inspection.transition).toMatchObject({
      index: 6,
      fromStep: 6,
      toStep: 7,
      durationSeconds: 0.02,
    });
    expect(inspection.transition.appliedAction).toHaveLength(12);
    expect(inspection.transition.measured.qpos).toHaveLength(19);
    expect(inspection.transition.predicted.qpos).toHaveLength(19);
    expect(inspection.transition.residual.jointPositionRad).toHaveLength(12);
    expect(inspection.transition.residual.joints).toHaveLength(12);
    expect(inspection.transition.residual.joints[0]).toHaveProperty("name", "abd-fl");
    expect(inspection.summary.stateAbi).toMatchObject({
      authority: "derived-from-frozen-model",
      qposSize: 19,
      qvelSize: 18,
    });

    const studio = invoke(["studio", "examples/quadruped", "--twin-audit", envelope.data.id, "--json"]);
    expect({ code: studio.code, stderr: studio.stderr }).toEqual({ code: 0, stderr: "" });
    const studioEnvelope = JSON.parse(studio.stdout);
    expect(studioEnvelope.data).toMatchObject({
      selectedRun: null,
      comparisonRun: null,
      twinAudit: { id: envelope.data.id, captureId, episodeId, transitionCount: 10 },
      replay: { frameCount: 11 },
      comparisonReplay: { frameCount: 11 },
    });
    const snapshot = JSON.parse(await readFile(resolve(studioEnvelope.data.path, "snapshot.json"), "utf8"));
    expect(snapshot).toMatchObject({
      version: 9,
      selectedTwinAudit: {
        id: envelope.data.id,
        auditHash: envelope.data.auditHash,
        summary: { transitionCount: 10 },
        authorityBoundary: { claim: "derived-model-fit-evidence", grantsActuation: false },
      },
      selectedTwinReplay: {
        kind: "mujica-digital-twin-prediction-replay",
        frameBase: "twin-replay/frames",
        frameCount: 11,
      },
    });
    expect(snapshot.selectedTwinAudit.transitions[6].residual.jointVelocityNormRadPerSec).toBeGreaterThan(0);
    const html = await readFile(resolve(studioEnvelope.data.path, "index.html"), "utf8");
    expect(html).toContain("Device telemetry ↔ one-step frozen MuJoCo prediction");
    expect(html).toContain("mujica-digital-twin-residual-selector");
    expect(html).toContain("digital-twin-audit-transition");
    expect(html).toContain("Named by the frozen Hardware State ABI");

    const temporary = await mkdtemp(resolve(tmpdir(), "mujica-twin-observation-"));
    const draftPath = resolve(temporary, "draft.json");
    await writeFile(draftPath, JSON.stringify({
      version: 1,
      kind: "mujica-human-observation-draft",
      source: {
        kind: "digital-twin-audit-transition",
        auditId: envelope.data.id,
        auditHash: envelope.data.auditHash,
        captureId,
        captureHash: envelope.data.source.captureHash,
        bundleHash: envelope.data.source.bundleHash,
        episodeId,
        episodeHash: envelope.data.source.episodeHash,
        transitionIndex: 6,
      },
      assessment: {
        category: "control",
        severity: "investigate",
        confidence: "medium",
        summary: "The frozen twin diverges most visibly from device telemetry on transition six.",
      },
    }));
    let observationPath: string | undefined;
    try {
      const recorded = invoke(["observation", "record", "examples/quadruped", "--input", draftPath, "--observer", "Twin audit reviewer", "--json"]);
      expect({ code: recorded.code, stderr: recorded.stderr }).toEqual({ code: 0, stderr: "" });
      const observation = JSON.parse(recorded.stdout).data;
      observationPath = observation.path;
      const observationInspect = invoke(["observation", "inspect", "examples/quadruped", "--observation", observation.id, "--json"]);
      expect(JSON.parse(observationInspect.stdout).data.context).toMatchObject({
        kind: "mujica-digital-twin-transition-context",
        audit: { id: envelope.data.id, auditHash: envelope.data.auditHash },
        transition: { index: 6 },
        authorityBoundary: { changesHardwareVerified: false, grantsActuation: false },
      });
    } finally {
      if (observationPath) rmSync(observationPath, { recursive: true, force: true });
      rmSync(temporary, { recursive: true, force: true });
    }
  }, 30_000);

  test("Driver Package discovery exposes frozen deployment identity", () => {
    const result = invoke(["driver", "inspect", "examples/quadruped", "--driver", "mujoco-protocol-simulator", "--json"]); const envelope = JSON.parse(result.stdout);
    expect(result.code).toBe(0);
    expect(envelope.data.definition).toMatchObject({
      id: "mujoco-protocol-simulator",
      executable: "driver.py",
      environments: ["dry-run"],
      device: { vendor: "Mujica", model: "Protocol simulator" },
    });
    expect(envelope.data.definition.capabilities).toContain("device-health");
    expect(envelope.data.packageHash).toHaveLength(64);
    expect(envelope.data.executableHash).toHaveLength(64);
    const override = invoke([
      "capture", "run", "examples/quadruped", "--plan", "quadruped-dry-run-identification",
      "--driver", "examples/quadruped/hardware-drivers/mujoco-protocol-simulator/driver.py",
      "--operator", "Mujica test", "--json",
    ]);
    expect(override.code).toBe(1);
    expect(JSON.parse(override.stderr).error.message).toContain("Bundle-frozen Driver Package");
  });

  test("Hardware Bundle v2 freezes a named State ABI through Capture identity", async () => {
    const bundleRoot = resolve(root, "examples/quadruped/hardware-bundles/hardware-d474a4b669d2e3f6");
    const bundle = JSON.parse(await readFile(resolve(bundleRoot, "manifest.json"), "utf8"));
    const state = JSON.parse(await readFile(resolve(bundleRoot, "state-contract.json"), "utf8"));
    const protocol = JSON.parse(await readFile(resolve(bundleRoot, "driver-protocol.json"), "utf8"));
    expect(bundle.version).toBe(2);
    expect(bundle.stateContractHash).toBe(hashJson(state));
    expect(state).toMatchObject({
      kind: "mujica-hardware-state-abi",
      qpos: { size: 19 },
      qvel: { size: 18 },
      quaternionConvention: { order: "wxyz", handedness: "right-handed" },
      driverBoundary: { normalizationOwner: "driver" },
    });
    expect(state.qpos.coordinates[3]).toMatchObject({ name: "root.orientation.w", frame: "model-world-from-body" });
    expect(state.qvel.coordinates[3]).toMatchObject({ name: "root.angular-velocity.x", frame: "body-local" });
    expect(protocol.handshake.stateContractHash).toBe(bundle.stateContractHash);
    expect(protocol.capabilities).toContain("state-abi-v1");

    const inspected = invoke(["capture", "inspect", "examples/quadruped", "--capture", "capture-b6d4e6918972f58c", "--json"]);
    expect({ code: inspected.code, stderr: inspected.stderr }).toEqual({ code: 0, stderr: "" });
    const capture = JSON.parse(inspected.stdout).data.manifest;
    expect(capture).toMatchObject({
      bundleHash: bundle.bundleHash,
      stateContractHash: bundle.stateContractHash,
      status: "COMPLETED",
    });
    expect(capture.protocolCapabilities).toContain("state-abi-v1");
  });

  test("Domain Profile discovery exposes provenance and bounded dynamics", () => {
    const result = invoke(["domain", "inspect", "examples/quadruped", "--domain", "quadruped-pre-hil-v1", "--json"]); const envelope = JSON.parse(result.stdout);
    expect(result.code).toBe(0);
    expect(envelope.data.hash).toHaveLength(64);
    expect(envelope.data.evidenceHash).toBeNull();
    expect(envelope.data.definition.provenance.kind).toBe("synthetic");
    expect(envelope.data.definition.parameters).toMatchObject({
      bodyMassScale: { minimum: 0.94, maximum: 1.06 },
      actuatorStrengthScale: { minimum: 0.9, maximum: 1.1 },
      actuatorDelayJitterSteps: { minimum: 0, maximum: 2 },
    });
  });

  test("Calibration discovery exposes immutable sources and validation split", () => {
    const result = invoke(["calibration", "inspect", "examples/quadruped", "--calibration", "quadruped-synthetic-hidden-plant", "--json"]); const envelope = JSON.parse(result.stdout);
    expect(result.code).toBe(0);
    expect(envelope.data.hash).toHaveLength(64);
    expect(envelope.data.definition.provenance).toMatchObject({ kind: "synthetic", device: null });
    expect(envelope.data.definition.optimizer.validationSources).toBe(1);
    expect(envelope.data.sourceHashes).toHaveLength(3);
    expect(envelope.nextActions[0].argv.slice(0, 3)).toEqual(["calibrate", resolve(root, "examples/quadruped"), "--calibration"]);
  });

  test("Hardware Capture discovery and dry-run preserve calibration-ready protocol evidence", async () => {
    const inspected = invoke(["capture", "inspect", "examples/quadruped", "--plan", "quadruped-dry-run-identification", "--json"]); const plan = JSON.parse(inspected.stdout);
    expect(inspected.code).toBe(0); expect(plan.data.definition.episodes).toHaveLength(3); expect(plan.data.bundle.environment).toBe("dry-run");
    const captured = invoke([
      "capture", "run", "examples/quadruped", "--plan", "quadruped-dry-run-identification",
      "--driver-arg=--scenario", "--driver-arg=examples/quadruped/scenarios/hardware-capture-hidden-plant.scenario.json",
      "--driver-input=examples/quadruped/scenarios/hardware-capture-hidden-plant.scenario.json",
      "--operator", "Mujica test", "--json",
    ]);
    expect(captured.code).toBe(0);
    const envelope = JSON.parse(captured.stdout); const artifactPath = envelope.data.artifactPath;
    try {
      expect(envelope.data).toMatchObject({
        status: "COMPLETED", environment: "dry-run", mode: "actuate", actuationAuthorized: true,
        calibrationEligible: true, deadlineMisses: 0, emergencyStops: 0, emergencyStopAcknowledgements: 0,
      });
      expect(envelope.data.episodes.every((episode: any) => episode.completed)).toBe(true);
      const manifest = JSON.parse(await readFile(resolve(artifactPath, "manifest.json"), "utf8"));
      expect(manifest.device.serial).toBe("simulated");
      expect(manifest.driverPackageHash).toHaveLength(64);
      expect(manifest.driverHash).toHaveLength(64);
      const bundleManifest = JSON.parse(await readFile(resolve(root, `examples/quadruped/hardware-bundles/${plan.data.definition.bundle}/manifest.json`), "utf8"));
      expect(manifest.driverPackageHash).toBe(bundleManifest.driverPackageHash);
      expect(manifest.driverHash).toBe(bundleManifest.driverExecutableHash);
      expect(manifest.protocolCapabilities).toEqual(["applied-action", "command-lease", "decision-deadline", "device-health", "latched-stop-health", "shadow-action", "state-abi-v1", "state-age-ms", "stop-ack"]);
      expect(manifest.stateContractHash).toBe(bundleManifest.stateContractHash);
      expect(manifest.stateAge.samples).toBeGreaterThan(0);
      expect(manifest.deviceHealth).toMatchObject({
        maximumMotorTemperatureC: 40,
        maximumMotorCurrentA: 0,
        minimumBusVoltageV: 24,
        maximumBusVoltageV: 24,
        faultSamples: 0,
        estopEngagedSamples: 0,
        watchdogUnhealthySamples: 0,
      });
      expect(manifest.driverInputs[0].hash).toHaveLength(64);
      expect(manifest.episodes.map((episode: any) => episode.hash).every((hash: string) => hash.length === 64)).toBe(true);
      const firstRow = JSON.parse((await readFile(resolve(artifactPath, manifest.episodes[0].path), "utf8")).split("\n")[0]!);
      expect(firstRow.proposedAction).toHaveLength(12);
      expect(firstRow.commandedAction).toHaveLength(12);
      expect(firstRow.appliedAction).toHaveLength(12);
      expect(firstRow.deviceHealth.motorTemperatureC).toHaveLength(12);
      expect(firstRow.deviceHealth.actuatorStates).toEqual(Array(12).fill("ready"));
      const inputPath = resolve(artifactPath, "driver-inputs/00-hardware-capture-hidden-plant.scenario.json");
      expect(await readFile(inputPath, "utf8")).toContain("\"bodyMassScale\": 1.1");
      const inspectedCapture = invoke(["capture", "inspect", "examples/quadruped", "--capture", envelope.data.captureId, "--json"]);
      expect(inspectedCapture.code).toBe(0); expect(JSON.parse(inspectedCapture.stdout).data.manifest.captureHash).toBe(envelope.data.captureHash);
      await writeFile(inputPath, "tampered\n");
      const tampered = invoke(["capture", "inspect", "examples/quadruped", "--capture", envelope.data.captureId, "--json"]);
      expect(tampered.code).toBe(1); expect(JSON.parse(tampered.stderr).error.message).toContain("driver input");
    } finally {
      rmSync(artifactPath, { recursive: true, force: true });
    }
  }, 10_000);

  test("shadow commissioning never actuates and stale state fails closed with an acknowledged stop", async () => {
    const common = [
      "capture", "run", "examples/quadruped", "--plan", "quadruped-dry-run-shadow-commissioning",
      "--driver-arg=--scenario", "--driver-arg=examples/quadruped/scenarios/hardware-capture-hidden-plant.scenario.json",
      "--driver-arg=--state-age-ms", "--driver-input=examples/quadruped/scenarios/hardware-capture-hidden-plant.scenario.json",
      "--operator", "Mujica test",
    ];
    const fresh = invoke([...common, "--driver-arg=0", "--json"]);
    expect(fresh.code).toBe(0);
    const freshEnvelope = JSON.parse(fresh.stdout); const freshPath = freshEnvelope.data.artifactPath;
    try {
      expect(freshEnvelope.data).toMatchObject({
        status: "COMPLETED", mode: "shadow", actuationAuthorized: false,
        calibrationEligible: false, emergencyStops: 0,
      });
      const transcript = (await readFile(resolve(freshPath, "transcript.ndjson"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      const hostTypes = transcript.filter((row) => row.direction === "host-to-driver").map((row) => row.message.type);
      expect(hostTypes).toContain("shadow-action");
      expect(hostTypes).not.toContain("action");
      const manifest = JSON.parse(await readFile(resolve(freshPath, "manifest.json"), "utf8"));
      const rows = (await readFile(resolve(freshPath, manifest.episodes[0].path), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      expect(rows.some((row) => row.proposedAction.some((value: number) => Math.abs(value) > 0.001))).toBe(true);
      expect(rows.every((row) => row.commandedAction.every((value: number) => value === 0))).toBe(true);
      expect(rows.every((row) => row.appliedAction.every((value: number) => value === 0))).toBe(true);
      const inspected = invoke(["capture", "inspect", "examples/quadruped", "--capture", freshEnvelope.data.captureId, "--json"]);
      expect(inspected.code).toBe(0);
    } finally {
      rmSync(freshPath, { recursive: true, force: true });
    }

    const stale = invoke([...common, "--driver-arg=50", "--json"]);
    expect(stale.code).toBe(0);
    const staleEnvelope = JSON.parse(stale.stdout); const stalePath = staleEnvelope.data.artifactPath;
    try {
      expect(staleEnvelope.data).toMatchObject({
        status: "ABORTED", mode: "shadow", actuationAuthorized: false,
        calibrationEligible: false, emergencyStops: 1, emergencyStopAcknowledgements: 1,
        postStopHealthChecks: 3, postStopRecoveryCandidates: 0, recoveryEligible: false,
      });
      expect(staleEnvelope.data.reasons.join(" ")).toContain("state age 50.000000 ms exceeds maximum 20.000000 ms");
      const transcript = (await readFile(resolve(stalePath, "transcript.ndjson"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      const hostTypes = transcript.filter((row) => row.direction === "host-to-driver").map((row) => row.message.type);
      expect(hostTypes).toContain("emergency-stop");
      expect(hostTypes).not.toContain("action");
      expect(hostTypes).not.toContain("shadow-action");
    } finally {
      rmSync(stalePath, { recursive: true, force: true });
    }
  }, 10_000);

  test("a kept experimental Policy Revision can deploy only as a prewarmed shadow Bundle", async () => {
    const exported = invoke(["hardware", "export", "examples/quadruped", "--target", "history-policy-shadow-dry-run", "--json"]);
    expect(exported.code).toBe(0);
    const bundle = JSON.parse(exported.stdout);
    expect(bundle.data).toMatchObject({
      sourceKind: "policy-revision",
      maximumCaptureMode: "shadow",
      target: { revision: "quadruped-p-ed7ad2ff20dd", revisionKind: "policy" },
      driverPackage: { id: "mujoco-protocol-simulator", executable: "driver.py" },
    });
    expect(() => assertCaptureModeAllowed(
      { id: bundle.data.id, sourceKind: "policy-revision", maximumCaptureMode: "shadow" },
      { id: "forbidden-policy-actuation", mode: "actuate" } as any,
    )).toThrow("cannot actuate shadow-only Policy Revision Bundle");

    const captured = invoke([
      "capture", "run", "examples/quadruped", "--plan", "history-policy-shadow-dry-run",
      "--driver-arg=--scenario", "--driver-arg=examples/quadruped/scenarios/hardware-capture-hidden-plant.scenario.json",
      "--driver-arg=--state-age-ms", "--driver-arg=0",
      "--driver-input=examples/quadruped/scenarios/hardware-capture-hidden-plant.scenario.json",
      "--operator", "Mujica test", "--json",
    ]);
    expect(captured.code).toBe(0);
    const envelope = JSON.parse(captured.stdout); const artifactPath = envelope.data.artifactPath;
    try {
      expect(envelope.data).toMatchObject({
        status: "COMPLETED", mode: "shadow", actuationAuthorized: false,
        controllerWarmupPasses: 2, calibrationEligible: false,
      });
      expect(typeof envelope.data.realTimeQualified).toBe("boolean");
      const manifest = JSON.parse(await readFile(resolve(artifactPath, "manifest.json"), "utf8"));
      expect(manifest.controllerWarmupPasses).toBe(2);
      expect(manifest.deviceHealth.samples).toBe(11);
      const transcript = (await readFile(resolve(artifactPath, "transcript.ndjson"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      const hostTypes = transcript.filter((row) => row.direction === "host-to-driver").map((row) => row.message.type);
      expect(hostTypes).toContain("shadow-action");
      expect(hostTypes).not.toContain("action");
      const rows = (await readFile(resolve(artifactPath, manifest.episodes[0].path), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      expect(rows.some((row) => row.proposedAction.some((value: number) => Math.abs(value) > 0.001))).toBe(true);
      expect(rows.every((row) => row.appliedAction.every((value: number) => value === 0))).toBe(true);
      const inspected = invoke(["capture", "inspect", "examples/quadruped", "--capture", envelope.data.captureId, "--json"]);
      expect(inspected.code).toBe(0);
    } finally {
      rmSync(artifactPath, { recursive: true, force: true });
    }
  }, 15_000);

  test("device health faults stop a learned Policy before proposal dispatch", async () => {
    const captured = invoke([
      "capture", "run", "examples/quadruped", "--plan", "history-policy-shadow-dry-run",
      "--driver-arg=--scenario", "--driver-arg=examples/quadruped/scenarios/hardware-capture-hidden-plant.scenario.json",
      "--driver-arg=--motor-temperature-c", "--driver-arg=90",
      "--driver-input=examples/quadruped/scenarios/hardware-capture-hidden-plant.scenario.json",
      "--operator", "Mujica test", "--json",
    ]);
    expect(captured.code).toBe(0);
    const envelope = JSON.parse(captured.stdout); const artifactPath = envelope.data.artifactPath;
    try {
      expect(envelope.data).toMatchObject({
        status: "ABORTED", mode: "shadow", actuationAuthorized: false,
        deviceHealthSamples: 1, maximumMotorTemperatureC: 90,
        emergencyStops: 1, emergencyStopAcknowledgements: 1, calibrationEligible: false,
      });
      expect(envelope.data.episodes[0].steps).toBe(0);
      expect(envelope.data.reasons.join(" ")).toContain("motor temperature 90.000000 C exceeds maximum 80.000000 C");
      const manifest = JSON.parse(await readFile(resolve(artifactPath, "manifest.json"), "utf8"));
      expect(manifest.deviceHealth).toMatchObject({ samples: 1, maximumMotorTemperatureC: 90 });
      expect(manifest.stopRecovery).toMatchObject({
        samples: 3, healthySamples: 0, recoveryCandidates: 0, requiresNewSession: true,
      });
      expect(envelope.data).toMatchObject({
        postStopHealthChecks: 3, postStopRecoveryCandidates: 0,
        recoveryEligible: false, recoveryRequiresNewSession: true,
      });
      const transcript = (await readFile(resolve(artifactPath, "transcript.ndjson"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      const hostTypes = transcript.filter((row) => row.direction === "host-to-driver").map((row) => row.message.type);
      expect(hostTypes).toContain("emergency-stop");
      expect(hostTypes.filter((type) => type === "health-check")).toHaveLength(3);
      expect(hostTypes).not.toContain("action");
      expect(hostTypes).not.toContain("shadow-action");
    } finally {
      rmSync(artifactPath, { recursive: true, force: true });
    }
  }, 15_000);

  test("an isolated actuator trip can become only a new-session recovery candidate", async () => {
    const captured = invoke([
      "capture", "run", "examples/quadruped", "--plan", "history-policy-shadow-dry-run",
      "--driver-arg=--scenario", "--driver-arg=examples/quadruped/scenarios/hardware-capture-hidden-plant.scenario.json",
      "--driver-arg=--actuator-state", "--driver-arg=7:faulted",
      "--driver-arg=--post-stop-clear-health",
      "--driver-input=examples/quadruped/scenarios/hardware-capture-hidden-plant.scenario.json",
      "--operator", "Mujica test", "--json",
    ]);
    expect(captured.code).toBe(0);
    const envelope = JSON.parse(captured.stdout); const artifactPath = envelope.data.artifactPath;
    try {
      expect(envelope.data).toMatchObject({
        status: "ABORTED", mode: "shadow", actuationAuthorized: false,
        affectedActuatorIndices: [7], deviceHealthTrips: 1,
        postStopHealthChecks: 3, postStopRecoveryCandidates: 1,
        recoveryEligible: true, recoveryRequiresNewSession: true,
        emergencyStops: 1, emergencyStopAcknowledgements: 1,
        calibrationEligible: false,
      });
      expect(envelope.data.episodes[0].steps).toBe(0);
      expect(envelope.data.reasons.join(" ")).toContain("7:faulted");
      const manifest = JSON.parse(await readFile(resolve(artifactPath, "manifest.json"), "utf8"));
      expect(manifest.deviceHealth).toMatchObject({
        trips: 1, affectedActuatorIndices: [7],
        actuatorStateCounts: { faulted: 1, ready: 11 },
      });
      expect(manifest.stopRecovery.windows[0]).toMatchObject({
        healthySamples: 3, recoveryEligible: true, requiresNewSession: true,
        stateTransitions: ["armed", "tripped", "stop-acknowledged", "health-checking", "recovery-eligible"],
      });
      const transcript = (await readFile(resolve(artifactPath, "transcript.ndjson"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      const hostTypes = transcript.filter((row) => row.direction === "host-to-driver").map((row) => row.message.type);
      const driverMessages = transcript.filter((row) => row.direction === "driver-to-host").map((row) => row.message);
      expect(hostTypes.filter((type) => type === "health-check")).toHaveLength(3);
      expect(hostTypes).not.toContain("action");
      expect(hostTypes).not.toContain("shadow-action");
      expect(driverMessages.filter((message) => message.type === "health-state")).toHaveLength(3);
      expect(driverMessages.filter((message) => message.type === "health-state").every((message) => message.stopLatched === true)).toBe(true);
      expect(hostTypes.indexOf("emergency-stop")).toBeLessThan(hostTypes.indexOf("health-check"));
      const inspected = invoke(["capture", "inspect", "examples/quadruped", "--capture", envelope.data.captureId, "--json"]);
      expect(inspected.code).toBe(0);
    } finally {
      rmSync(artifactPath, { recursive: true, force: true });
    }
  }, 15_000);

  test("host and Driver reject expired decisions before applying them", async () => {
    const common = [
      "--driver-arg=--scenario", "--driver-arg=examples/quadruped/scenarios/hardware-capture-hidden-plant.scenario.json",
      "--driver-input=examples/quadruped/scenarios/hardware-capture-hidden-plant.scenario.json",
      "--operator", "Mujica test", "--json",
    ];
    const host = invoke(["capture", "run", "examples/quadruped", "--plan", "history-policy-host-deadline-trip", ...common]);
    expect(host.code).toBe(0);
    const hostEnvelope = JSON.parse(host.stdout); const hostPath = hostEnvelope.data.artifactPath;
    try {
      expect(hostEnvelope.data).toMatchObject({
        status: "ABORTED", hostPreDispatchDeadlineMisses: 1, driverDeadlineRejections: 0,
        deadlineMisses: 1, emergencyStops: 1, emergencyStopAcknowledgements: 1, realTimeQualified: false,
        postStopHealthChecks: 3, postStopRecoveryCandidates: 0, recoveryEligible: false,
      });
      const transcript = (await readFile(resolve(hostPath, "transcript.ndjson"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      const hostTypes = transcript.filter((row) => row.direction === "host-to-driver").map((row) => row.message.type);
      expect(hostTypes).toContain("emergency-stop");
      expect(hostTypes).not.toContain("action");
      expect(hostTypes).not.toContain("shadow-action");
    } finally {
      rmSync(hostPath, { recursive: true, force: true });
    }

    const driver = invoke([
      "capture", "run", "examples/quadruped", "--plan", "quadruped-driver-deadline-trip",
      ...common.slice(0, 2), "--driver-arg=--receive-delay-ms", "--driver-arg=20", ...common.slice(2),
    ]);
    expect(driver.code).toBe(0);
    const driverEnvelope = JSON.parse(driver.stdout); const driverPath = driverEnvelope.data.artifactPath;
    try {
      expect(driverEnvelope.data).toMatchObject({
        status: "ABORTED", hostPreDispatchDeadlineMisses: 0, driverDeadlineRejections: 1,
        deadlineMisses: 1, emergencyStops: 1, emergencyStopAcknowledgements: 1,
        calibrationEligible: false, realTimeQualified: false,
        postStopHealthChecks: 3, postStopRecoveryCandidates: 0, recoveryEligible: false,
      });
      expect(driverEnvelope.data.episodes[0].steps).toBe(0);
      const transcript = (await readFile(resolve(driverPath, "transcript.ndjson"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      const hostTypes = transcript.filter((row) => row.direction === "host-to-driver").map((row) => row.message.type);
      const driverTypes = transcript.filter((row) => row.direction === "driver-to-host").map((row) => row.message.type);
      expect(hostTypes).toContain("action");
      expect(driverTypes).toContain("deadline-rejected");
      expect(driverTypes.filter((type) => type === "state")).toHaveLength(1);
      expect(driverEnvelope.data.reasons.join(" ")).toContain("driver rejected expired Action");
    } finally {
      rmSync(driverPath, { recursive: true, force: true });
    }
  }, 15_000);

  test("the Driver autonomously latches stop when host commands disappear", async () => {
    const captured = invoke([
      "capture", "run", "examples/quadruped", "--plan", "quadruped-host-loss-trip",
      "--driver-arg=--scenario", "--driver-arg=examples/quadruped/scenarios/hardware-capture-hidden-plant.scenario.json",
      "--driver-input=examples/quadruped/scenarios/hardware-capture-hidden-plant.scenario.json",
      "--operator", "Mujica test", "--json",
    ]);
    expect(captured.code).toBe(0);
    const envelope = JSON.parse(captured.stdout); const artifactPath = envelope.data.artifactPath;
    try {
      expect(envelope.data).toMatchObject({
        status: "ABORTED",
        commandLeaseMs: 100,
        commandLeaseExpirations: 1,
        driverAutonomousStops: 1,
        emergencyStops: 0,
        emergencyStopAcknowledgements: 0,
        postStopHealthChecks: 3,
        postStopRecoveryCandidates: 0,
        recoveryEligible: false,
        realTimeQualified: false,
        calibrationEligible: false,
      });
      expect(envelope.data.maximumObservedCommandSilenceMs).toBeGreaterThanOrEqual(100);
      expect(envelope.data.maximumObservedCommandSilenceMs).toBeLessThanOrEqual(125);
      const transcript = (await readFile(resolve(artifactPath, "transcript.ndjson"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      const hostControlOrStop = transcript.filter((row) =>
        row.direction === "host-to-driver"
        && ["action", "shadow-action", "safe-stop", "emergency-stop"].includes(row.message.type)
      );
      expect(hostControlOrStop.map((row) => row.message.type)).toEqual(["action"]);
      const expiration = transcript.find((row) => row.direction === "driver-to-host" && row.message.type === "lease-expired");
      expect(expiration.message).toMatchObject({
        episode: "host-loss-trip",
        lastAcceptedStep: 0,
        commandLeaseMs: 100,
        stopLatched: true,
        appliedAction: Array(12).fill(0),
      });
      const manifest = JSON.parse(await readFile(resolve(artifactPath, "manifest.json"), "utf8"));
      expect(manifest.commandLease).toMatchObject({ durationMs: 100, maximumOverrunMs: 25, expirations: 1, autonomousStops: 1, automaticRearm: false });
      expect(manifest.stopRecovery.windows[0].stateTransitions).toEqual(["armed", "tripped", "driver-autonomous-stop", "health-checking", "recovery-blocked"]);
      const inspected = invoke(["capture", "inspect", "examples/quadruped", "--capture", envelope.data.captureId, "--json"]);
      expect(inspected.code).toBe(0);
    } finally {
      rmSync(artifactPath, { recursive: true, force: true });
    }
  }, 15_000);

  test("physical Capture requires matching, live, external operator authorization", () => {
    const target: any = { version: 1, id: "robot-target", name: "Robot", revision: "robot-r1", assembly: "robot", controller: "control", environment: "real", protocol: "stdio-jsonl-v1", controlHz: 50, safety: { maximumLatencyMs: 10, maximumConsecutiveMisses: 1, emergencyStopAction: [0] }, device: { vendor: "Vendor", model: "Robot", serialRequired: true } };
    const plan: any = { version: 1, id: "capture-plan", name: "Capture", target: target.id, bundle: "hardware-a", episodes: [{ id: "one", seed: 1, steps: 10 }], action: { scale: 0.5, maximumSlewPerSecond: 1 }, safety: { maximumJointVelocityRadPerSec: 1 }, notes: "" };
    const bundle = { bundleHash: "b".repeat(64) }; const planHash = "a".repeat(64); const now = Date.parse("2026-07-23T10:05:00.000Z");
    const authorization: any = { version: 1, plan: plan.id, planHash, target: target.id, bundleHash: bundle.bundleHash, environment: "real", device: { vendor: "Vendor", model: "Robot", serial: "robot-001" }, operator: "Operator", approvedAt: "2026-07-23T10:00:00.000Z", expiresAt: "2026-07-23T10:10:00.000Z", maximumEpisodes: 1, notes: "" };
    expect(() => validateCaptureAuthorization(target, plan, planHash, bundle, "Operator", null, now)).toThrow("requires --authorization");
    expect(() => validateCaptureAuthorization(target, plan, planHash, bundle, "Operator", authorization, now)).not.toThrow();
    expect(() => assertCaptureDecisionDeadline(target, { ...plan, safety: { ...plan.safety, maximumDecisionLatencyMs: 5 } })).not.toThrow();
    expect(() => assertCaptureDecisionDeadline(target, { ...plan, safety: { ...plan.safety, maximumDecisionLatencyMs: 11 } })).toThrow("cannot exceed");
    expect(() => validateCaptureAuthorization(target, plan, planHash, bundle, "Operator", { ...authorization, expiresAt: "2026-07-23T10:04:00.000Z" }, now)).toThrow("not currently valid");
    expect(() => validateCaptureAuthorization(target, plan, planHash, bundle, "Different", authorization, now)).toThrow("operator");
  });

  test("Controller discovery exposes legal Assembly combinations", () => {
    const result = invoke(["controller", "inspect", "examples/quadruped", "--controller", "latency-aware-spatial-gait", "--json"]); const envelope = JSON.parse(result.stdout);
    expect(result.code).toBe(0); expect(envelope.data.definition.interface.requiredObservations.at(-1)).toEqual({ name: "actuator-delay-steps", size: 1 });
    expect(envelope.data.compatibleAssemblies).toEqual(["command-conditioned-history-3dof", "force-sensing-history-3dof", "resilient-command-conditioned-history-3dof"]);
    expect(envelope.nextActions[0].argv.slice(0, 5)).toEqual(["simulate", resolve(root, "examples/quadruped"), "--assembly", "command-conditioned-history-3dof", "--controller"]);
    const ordinary = envelope.data.incompatibleAssemblies.find((item: any) => item.assembly === "force-sensing-3dof");
    expect(ordinary.issues).toEqual([{ code: "observation.missing", channel: "actuator-delay-steps", message: "Program Controller 'latency-aware-spatial-gait' requires Observation 'actuator-delay-steps' (size 1), but Assembly 'force-sensing-3dof' does not provide it" }]);
  });

  test("an incompatible Program Controller fails before Python Runtime invocation", () => {
    const result = invoke(["simulate", "examples/quadruped", "--assembly", "force-sensing-3dof", "--controller", "latency-aware-spatial-gait", "--task", "forward-walk", "--scenario", "nominal", "--json"]); const envelope = JSON.parse(result.stderr);
    expect(result.code).toBe(1); expect(envelope.error.message).toContain("requires Observation 'actuator-delay-steps'"); expect(envelope.error.message).not.toContain("Python Runtime"); expect(envelope.error.message).not.toContain("KeyError");
  });

  test("Studio is a read-only synchronized projection of completed quadruped Runs", async () => {
    const simulated = invoke(["simulate", "examples/quadruped", "--assembly", "force-sensing-3dof", "--controller", "spatial-forward-gait", "--task", "forward-walk", "--scenario", "nominal", "--objective", "forward-locomotion", "--seed", "709913", "--json"]);
    expect(simulated.code).toBe(0);
    const run = JSON.parse(simulated.stdout).data;
    try {
      const manifest = JSON.parse(await readFile(resolve(run.artifactPath, "manifest.json"), "utf8"));
      const initialState = JSON.parse(await readFile(resolve(run.artifactPath, "inputs/initial-state.json"), "utf8"));
      const firstRow = JSON.parse((await readFile(resolve(run.artifactPath, "trajectory.ndjson"), "utf8")).split("\n")[0]!);
      expect(manifest.version).toBe(3);
      expect(initialState.qpos).toHaveLength(19);
      expect(firstRow.commandedAction).toHaveLength(12);
      expect(firstRow.appliedAction).toHaveLength(12);
      const result = invoke(["studio", "examples/quadruped", "--run", run.runId, "--compare-run", run.runId, "--json"]); const envelope = JSON.parse(result.stdout);
      expect(result.code).toBe(0);
      expect(envelope.data.selectedRun).toBe(run.runId);
      expect(envelope.data.comparisonRun).toBe(run.runId);
      expect(envelope.data.snapshotHash).toHaveLength(64);
      expect(envelope.data.replay.frameCount).toBe(250);
      expect(envelope.data.comparisonReplay).toMatchObject({ id: envelope.data.replay.id, frameCount: 250 });
      expect(envelope.artifacts).toEqual([
        { kind: "simulation-replay", id: envelope.data.replay.id, path: envelope.data.replay.path, immutable: true },
        { kind: "studio-snapshot", id: envelope.data.id, path: envelope.data.path, immutable: false },
      ]);
      const cached = invoke(["studio", "examples/quadruped", "--run", run.runId, "--compare-run", run.runId, "--json"]);
      expect(cached.code).toBe(0);
      expect(JSON.parse(cached.stdout).data.replay).toMatchObject({ id: envelope.data.replay.id, cached: true });
    } finally {
      rmSync(run.artifactPath, { recursive: true, force: true });
    }
  }, 15_000);

  test("Research Review inspection and Studio preserve the locked Judge lineage", () => {
    const inspected = invoke([
      "research", "review", "inspect", "examples/quadruped",
      "--lab", "transition-controller-review",
      "--session", "session-c773bff5c54a2cd7",
      "--experiment", "001-0f8bcb31c045",
      "--json",
    ]);
    expect({ code: inspected.code, stderr: inspected.stderr }).toEqual({ code: 0, stderr: "" });
    const inspection = JSON.parse(inspected.stdout);
    expect(inspection.data.review).toMatchObject({
      kind: "mujica-research-review",
      authority: "derived-human-review",
      claimKind: "visual-witness",
      lineage: {
        researchId: "transition-controller-review",
        sessionId: "session-c773bff5c54a2cd7",
        experimentId: "001-0f8bcb31c045",
      },
      judge: { verdict: "REVERT", decision: { selectionReason: "gate-regression" } },
      selectedCase: { id: "yaw-redirection", selectionPolicy: "first-primary-gate-regression" },
      accepted: { id: "run-6f9c6481f208e927" },
      candidate: { id: "run-b05629b197f18ee9" },
      authorityBoundary: {
        visualInterpretation: "hypothesis-only",
        experimentDecision: "locked-judge",
      },
    });
    expect(inspection.data.reviewHash).toHaveLength(64);
    expect(inspection.nextActions[0]).toMatchObject({
      id: "open-visual-review",
      argv: [
        "studio",
        resolve(root, "examples/quadruped"),
        "--research-lab", "transition-controller-review",
        "--session", "session-c773bff5c54a2cd7",
        "--experiment", "001-0f8bcb31c045",
      ],
    });

    const studio = invoke([
      "studio", "examples/quadruped",
      "--research-lab", "transition-controller-review",
      "--json",
    ]);
    expect({ code: studio.code, stderr: studio.stderr }).toEqual({ code: 0, stderr: "" });
    expect(JSON.parse(studio.stdout).data).toMatchObject({
      selectedRun: "run-6f9c6481f208e927",
      comparisonRun: "run-b05629b197f18ee9",
      researchReview: {
        experimentId: "001-0f8bcb31c045",
        reviewHash: inspection.data.reviewHash,
      },
      researchTimeline: {
        labId: "transition-controller-review",
        selectedKey: "session-c773bff5c54a2cd7/001-0f8bcb31c045",
        reviewCount: 1,
      },
    });
    const timelineHtml = readFileSync(resolve(JSON.parse(studio.stdout).data.indexPath), "utf8");
    expect(timelineHtml).toContain("Training Cockpit · Research Timeline");
    expect(timelineHtml).toContain("data-timeline-key");
    expect(timelineHtml).toContain("Metrics only");
  }, 15_000);

  test("validation crosses the Python MuJoCo boundary", async () => {
    const result = invoke(["validate", "examples/quadruped", "--json"]); const envelope = JSON.parse(result.stdout);
    expect(result.code).toBe(0);
    expect(envelope.data.runtimeModels.map((item: { nu: number }) => item.nu)).toEqual([8, 12, 8, 8, 8, 12, 12, 12, 8, 12, 12, 14]);
    expect(envelope.data.runtimeModels.map((item: { nsensor: number }) => item.nsensor)).toEqual([2, 6, 2, 2, 6, 6, 6, 6, 2, 6, 6, 6]);
    const baseline = envelope.data.runtimeModels.find((item: { assembly: string }) => item.assembly === "baseline"); const payload = envelope.data.runtimeModels.find((item: { assembly: string }) => item.assembly === "payload-equipped");
    expect(payload.ngeom).toBe(baseline.ngeom + 1); expect(payload.modelMassKg - baseline.modelMassKg).toBeCloseTo(0.2);
    expect(envelope.data.definitions.research).toBe(9);
    expect(envelope.data.definitions.trainingResearch).toBe(4);
    expect(envelope.data.definitions.researchLabs).toBe(12);
    expect(envelope.data.definitions.hardwareTargets).toBe(2);
    expect(envelope.data.definitions.domainProfiles).toBe(7);
    expect(envelope.data.definitions.calibrations).toBe(2);
    expect(envelope.data.definitions.capturePlans).toBe(7);
    expect(envelope.data.definitions.driverPackages).toBe(1);
    const lock = JSON.parse(await readFile(resolve(root, "examples/quadruped/benchmarks/sensor-development.lock.json"), "utf8"));
    expect(lock.harnessSourceHash).toHaveLength(64);
    expect(lock.evaluatorDependencyLockHash).toHaveLength(64);
  }, 20_000);

  test("hardware dry-run evidence cannot masquerade as physical verification", async () => {
    const exported = invoke(["hardware", "export", "examples/quadruped", "--target", "spatial-dry-run", "--json"]); const bundle = JSON.parse(exported.stdout); expect(exported.code).toBe(0);
    const verified = invoke(["hardware", "verify", "examples/quadruped", "--bundle", bundle.data.id, "--evidence", "examples/quadruped/hardware-evidence/spatial-dry-run.json", "--json"]); const result = JSON.parse(verified.stdout);
    expect(verified.code).toBe(0); expect(result.data.status).toBe("PROTOCOL-VERIFIED"); expect(result.data.protocolVerified).toBe(true); expect(result.data.hardwareVerified).toBe(false);
    expect(result.data.evidence.samples).toBe(250); expect(result.data.evidence.deviceHealthSamples).toBe(250); expect(result.data.evidence.deviceHealthTrips).toBe(1);
    expect(result.data.evidence.commandLeaseExpirations).toBe(1); expect(result.data.evidence.driverAutonomousStops).toBe(1);
    expect(result.data.evidence.actuatorIsolationTrips).toBe(1); expect(result.data.evidence.postStopHealthChecks).toBe(3); expect(result.data.evidence.postStopRecoveryCandidates).toBe(1); expect(result.data.reasons).toEqual([]);
    const policyVerified = invoke([
      "hardware", "verify", "examples/quadruped",
      "--bundle", "hardware-3813b60c7568c41d",
      "--evidence", "examples/quadruped/hardware-evidence/history-policy-shadow-dry-run.json",
      "--json",
    ]);
    expect(policyVerified.code).toBe(0);
    expect(JSON.parse(policyVerified.stdout).data).toMatchObject({
      status: "SHADOW-VERIFIED",
      hardwareVerified: false,
      protocolVerified: true,
      actuationQualified: false,
    });
    const temporaryRoot = await mkdtemp(resolve(tmpdir(), "mujica-stale-evidence-"));
    try {
      const evidence = JSON.parse(await readFile(resolve(root, "examples/quadruped/hardware-evidence/spatial-dry-run.json"), "utf8"));
      evidence.maximumObservedStateAgeMs = 21;
      evidence.emergencyStopAcknowledgements = 0;
      evidence.driverPackageHash = "a".repeat(64);
      evidence.driverHash = "b".repeat(64);
      evidence.deviceHealthTrips = 0;
      evidence.actuatorIsolationTrips = 0;
      evidence.postStopHealthChecks = 0;
      evidence.postStopRecoveryCandidates = 0;
      evidence.commandLeaseExpirations = 0;
      evidence.driverAutonomousStops = 0;
      evidence.maximumObservedCommandSilenceMs = 0;
      const evidencePath = resolve(temporaryRoot, "stale.json");
      await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
      const rejected = invoke(["hardware", "verify", "examples/quadruped", "--bundle", bundle.data.id, "--evidence", evidencePath, "--json"]);
      expect(rejected.code).toBe(0);
      const rejectedEnvelope = JSON.parse(rejected.stdout);
      expect(rejectedEnvelope.data.status).toBe("FAILED");
      expect(rejectedEnvelope.data.reasons).toEqual([
        "evidence Driver Package hash does not match bundle",
        "evidence Driver executable hash does not match bundle",
        "observed state age exceeds safety limit",
        "evidence does not prove Driver command-lease expiration",
        "evidence does not prove a Driver-autonomous stop",
        "evidence command silence did not reach the Target lease",
        "evidence does not prove a device health safety trip",
        "evidence does not prove per-actuator fault isolation",
        "evidence does not prove the required stop-latched health window",
        "evidence does not prove a stop-latched recovery candidate",
        "not every emergency stop was acknowledged",
      ]);
      rmSync(rejectedEnvelope.data.path, { recursive: true, force: true });
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
    const legacy = invoke(["hardware", "verify", "examples/quadruped", "--bundle", "hardware-f0b608d6d693dead", "--evidence", "examples/quadruped/hardware-verifications/verification-fe6210762029bd3f/evidence.json", "--json"]);
    expect(legacy.code).toBe(0); expect(JSON.parse(legacy.stdout).data.status).toBe("PROTOCOL-VERIFIED");
  }, 20_000);

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
  }, 45_000);

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

  test("Research Review selects a Judge-named gate case before score magnitude", () => {
    const benchmark = {
      id: "review-benchmark",
      cases: [
        { id: "large-score", task: "walk", scenario: "nominal", seed: 1, weight: 2, gating: true },
        { id: "gate-case", task: "brake", scenario: "delay", seed: 2, weight: 1, gating: true },
      ],
    };
    const evaluation = (scores: number[]) => ({
      aggregateScore: scores.reduce((sum, value) => sum + value, 0) / scores.length,
      cases: benchmark.cases.map((item, index) => ({ case: item, metrics: {}, score: { total: scores[index] }, resultHash: String(index + 1).repeat(64) })),
    });
    const decision = {
      verdict: "REVERT", gateReasons: ["gate-case: lateral-drift regressed from passing to failing"],
      previousViolationCount: 0, candidateViolationCount: 1, previousViolationSeverity: 0, candidateViolationSeverity: 1,
      feasibilityImproved: false, severityImproved: false, scoreImproved: true, selectionReason: "gate-regression",
    };
    const gateSelected = selectResearchReviewCase(benchmark as any, evaluation([10, 10]) as any, evaluation([20, 11]) as any, decision as any);
    expect(gateSelected).toMatchObject({
      definition: { id: "gate-case" },
      selectionPolicy: "first-primary-gate-regression",
      candidateScoreDelta: 1,
    });
    const scoreSelected = selectResearchReviewCase(benchmark as any, evaluation([10, 10]) as any, evaluation([20, 11]) as any, { ...decision, gateReasons: [], selectionReason: "score-improvement-within-feasibility-tier", verdict: "KEEP" } as any);
    expect(scoreSelected).toMatchObject({
      definition: { id: "large-score" },
      selectionPolicy: "largest-absolute-weighted-score-delta",
      weightedScoreDelta: 20,
    });
  });

  test("training proposals are confined and preserve integer parameters", async () => {
    const project = resolve(root, "examples/quadruped"); const research = await loadTrainingResearch(project, "residual-policy"); const training = await loadTraining(project, research.training);
    expect(() => validateTrainingProposal(research, training, { strategy: "escape", hypothesis: "change task", expectedEffect: "unsafe", values: { "/gamma": 0.8 } })).toThrow("not editable");
    expect(() => validateTrainingProposal(research, training, { strategy: "fractional-steps", hypothesis: "fractional budget", expectedEffect: "invalid", values: { "/totalSteps": 3072.5 } })).toThrow("integer");
  });

  test("Research Lab V2 exposes one source-governed policy lane", async () => {
    const project = resolve(root, "examples/quadruped"); const lab = await loadResearchLab(project, "upright-residual-policy");
    expect(lab.execution).toEqual({ kind: "policy", training: "upright-residual-locomotion", controller: "upright-residual-gait", seed: 42 });
    expect(lab.regressions).toEqual(["extreme-traction", "spatial-generalization", "command-tracking", "command-transitions"]);
    expect(researchPathIsEditable("trainers/upright-residual-ppo/model.py", lab.editable.paths)).toBe(true);
    expect(researchPathIsEditable("benchmarks/upright-locomotion.benchmark.json", lab.editable.paths)).toBe(false);
    expect(() => assertResearchLabEditableChanges(lab, ["training/upright-residual-locomotion.training.json"])).not.toThrow();
    expect(() => assertResearchLabEditableChanges(lab, ["training/upright-residual-locomotion.training.json", "objectives/upright-locomotion.objective.json"])).toThrow("outside the declared source closure");
    expect(() => assertResearchLabEditableChanges(lab, [])).toThrow("no source changes");
    const inspect = invoke(["research", "inspect", "examples/quadruped", "--lab", lab.id, "--json"]); const envelope = JSON.parse(inspect.stdout);
    expect(inspect.code).toBe(0); expect(envelope.data.lab.version).toBe(2); expect(envelope.data.benchmarkLockHash).toHaveLength(64);
  });

  test("Research Lab reuses deterministic Training evidence without treating volatile paths as identity", () => {
    const stable = { trainingRunId: "training-fixed", policyId: "policy-fixed", modelHash: "a".repeat(64), trainingMetrics: { totalSteps: 4096, episodes: 16 } };
    expect(trainingRunStableResultIdentity({ ...stable, policyPath: "/tmp/workspace-a/policies/policy-fixed", elapsedSeconds: 1.2 }))
      .toEqual(trainingRunStableResultIdentity({ ...stable, policyPath: "/tmp/workspace-b/policies/policy-fixed", elapsedSeconds: 9.8 }));
    expect(trainingRunStableResultIdentity({ ...stable, modelHash: "b".repeat(64) }))
      .not.toEqual(trainingRunStableResultIdentity(stable));
  });

  test("a frozen program-prior residual Policy runs without mutable Controller source", () => {
    const result = invoke(["simulate", "examples/quadruped", "--assembly", "command-conditioned-history-3dof", "--controller", "upright-residual-gait", "--task", "forward-walk", "--scenario", "nominal", "--objective", "upright-locomotion", "--seed", "1802", "--json"]);
    const envelope = JSON.parse(result.stdout); expect(result.code).toBe(0);
    expect(envelope.data.metrics.survivalRate).toBe(1); expect(envelope.data.metrics.maximumAbsolutePitchRad).toBeLessThan(0.2);
    expect(envelope.data.metrics.forwardProgress).toBeGreaterThan(0.3);
  }, 10_000);

  test("promoted policies and Policy Revisions expose runtime provenance", async () => {
    const revisionsResult = invoke(["policy-revisions", "examples/quadruped", "--json"]); const revisionsEnvelope = JSON.parse(revisionsResult.stdout); expect(revisionsResult.code).toBe(0); expect(revisionsEnvelope.data.revisions.length).toBeGreaterThan(0);
    const revisions = revisionsEnvelope.data.revisions.sort((a: { appliedAt: string }, b: { appliedAt: string }) => a.appliedAt.localeCompare(b.appliedAt));
    const head = revisions.filter((item: { kind: string }) => item.kind === "policy-optimization").at(-1); expect(head.kind).toBe("policy-optimization");
    const motionRevision = revisions.find((item: { researchId?: string }) => item.researchId === "motion-quality-residual-policy"); expect(motionRevision.policyId).toBe("motion-quality-residual-locomotion-478335c4ce7fee99");
    const historyRevision = revisions.find((item: { researchId?: string }) => item.researchId === "capture-calibrated-history-policy"); expect(historyRevision).toMatchObject({ policyId: "capture-calibrated-history-residual-locomotion-30d743e004fc844d", selectionReason: "fewer-gate-violations" });
    const inspectResult = invoke(["policy", "inspect", "examples/quadruped", "--policy", head.policyId, "--json"]); const policy = JSON.parse(inspectResult.stdout); expect(inspectResult.code).toBe(0); expect(policy.data.manifest.runtimeVersion).toBe("0.2.0"); expect(policy.data.manifest.runtimeSourceHash).toHaveLength(64);
    expect(policy.data.architecture.actionTransform.residualScale).toBe(0.5);
    const revisionResult = invoke(["policy-revision", "inspect", "examples/quadruped", "--revision", head.id, "--json"]); const revision = JSON.parse(revisionResult.stdout); expect(revisionResult.code).toBe(0); expect(revision.data.evaluation.candidate.cases[0].score.terms.trainingSteps).toBe(-0.04096);
  });
});
