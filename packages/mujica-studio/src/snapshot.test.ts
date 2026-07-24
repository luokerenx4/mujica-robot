import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { hashJson, sha256 } from "@mujica/core";
import { buildStudioSnapshot, writeStudioSnapshot } from "./snapshot";
import { writeWorkspaceStudioSnapshot } from "./workspace";

const project = resolve(import.meta.dir, "../../../examples/quadruped");

describe("read-only Studio snapshot", () => {
  test("packages multiple governed projects behind one Workspace home", async () => {
    const workspace = resolve(import.meta.dir, "../../../examples");
    const result = await writeWorkspaceStudioSnapshot(workspace);
    expect(result.snapshot.projects.map((item) => item.id)).toEqual(["hexapod", "quadruped"]);
    expect(result.snapshot.projects.find((item) => item.id === "hexapod")).toMatchObject({
      morphology: { class: "legged", limbCount: 6 },
      capabilityStages: [{ id: "nominal-foundation", status: "active" }],
      developmentReview: {
        status: "HUMAN_REVIEW_REQUIRED",
        designPassed: true,
        passedStages: 1,
        totalStages: 1,
      },
    });
    const html = await readFile(result.indexPath, "utf8");
    expect(html).toContain("Mujica Workspace");
    expect(html).toContain("New Project");
    expect(html).toContain("['project','create'");
    expect(html).toContain("Each robot owns its Charter, source, and evidence");
  }, 15_000);

  test("projects real robot evidence into a deterministic offline debugger", async () => {
    const first = await writeStudioSnapshot(project, { run: "run-e8bd80892b0f0123" });
    const second = await writeStudioSnapshot(project, { run: "run-e8bd80892b0f0123" });
    expect(second.id).toBe(first.id);
    expect(first.snapshot.renderer).toMatchObject({ id: "mujica-studio-offline-v1" });
    expect(first.snapshot.renderer.sourceHash).toHaveLength(64);
    expect(first.snapshot.selectedRun?.trajectory.total).toBe(250);
    expect((first.snapshot.selectedRun?.trajectory.rows.at(-1) as any).qpos[0]).toBeCloseTo(0.6681203053846321);
    expect(first.snapshot.assemblies.find((item) => item.id === "force-sensing-3dof")?.observationContract.size).toBe(45);
    expect(first.snapshot.benchmarks).toHaveLength(19);
    expect(first.snapshot.candidates).toHaveLength(16);
    expect(first.snapshot.hardwareBundles.length).toBeGreaterThanOrEqual(2);
    expect(first.snapshot.hardwareVerifications.length).toBeGreaterThanOrEqual(2);
    expect(first.snapshot.hardwareCaptures.length).toBeGreaterThanOrEqual(1);
    expect(first.snapshot.hardwareCaptures.find((item) => item.id === "capture-91a394ba19589331")).toMatchObject({
      status: "ABORTED",
      attentionEventIndex: 6,
      attentionEvent: { direction: "driver-to-host", message: { type: "lease-expired" } },
    });
    expect(first.snapshot.humanObservations).toEqual(second.snapshot.humanObservations);
    expect(first.snapshot.researchBriefs).toEqual(second.snapshot.researchBriefs);
    expect(first.snapshot.researchLabs.map((item) => item.id)).toContain("upright-residual-policy");
    expect(first.snapshot.researchLabs.map((item) => item.id)).toContain("transition-controller-review");
    expect(first.snapshot.researchLabs.map((item) => item.id)).toContain("integrated-resilience-policy");
    expect(first.snapshot.policies.find((item) => item.id === "integrated-resilience-curriculum-c811d76190c264d3")).toMatchObject({
      integrity: "VERIFIED",
      training: {
        id: "integrated-resilience-curriculum",
        runId: "training-d153cd89a44e2381",
        totalSteps: 8192,
        curriculumCoverage: {
          "recovery-handoff-skill": { role: "skill", episodesStarted: 1, episodesCompleted: 1, steps: 450 },
          "integrated-mission": { role: "mission", episodesStarted: 9, episodesCompleted: 8, steps: 7742 },
        },
      },
    });
    expect(first.snapshot.policies.find((item) => item.id === "resilient-mission-residual-8af2efac119bc98c")).toMatchObject({
      integrity: "VERIFIED",
      training: {
        id: "resilient-mission-residual",
        runId: "training-f37e65dc28f9b018",
        seed: 260725,
        budget: 8192,
        totalSteps: 8192,
        episodes: 11,
        domainProfileId: "quadruped-resilient-resume-curriculum-v1",
        variedDomainParameters: [],
        activePolicyFraction: {
          mean: 0.255126953125,
        },
      },
      authority: {
        kind: "program-controller-residual",
        residualGate: {
          allowedModes: ["locomotion"],
          requiredTelemetry: { recoveryCompleted: true },
          rampSeconds: 0.75,
        },
      },
    });
    expect(first.snapshot.developmentWorkOrder).toMatchObject({
      workOrder: {
        status: "PARTIALLY_ROUTED",
      },
    });
    expect(first.snapshot.developmentWorkOrder?.workOrder.blockers.some((item) => item.benchmark === "self-righting")).toBe(false);
    expect(first.snapshot.developmentWorkOrder?.workOrder.blockers.some((item) => item.benchmark === "integrated-resilience-mission")).toBe(true);
    expect(first.snapshot.developmentWorkOrder?.workOrder.blockers.some((item) => item.benchmark === "sim-to-real-audit")).toBe(true);
    expect(first.snapshot.developmentWorkOrder?.workOrder.lanes.map((item) => item.researchLab)).toEqual([
      "integrated-resilience-controller",
      "integrated-resilience-policy",
    ]);
    expect(first.snapshot.developmentWorkOrder?.workOrder.uncoveredSurfaces.some((item) => item.surface === "assembly")).toBe(true);
    const session = first.snapshot.researchSessions.find((item) => item.id === "session-2d54b3b2e5ee8251");
    expect(session?.experiments[0]).toMatchObject({ id: "001-7244577953a6", verdict: "REVERT" });
    const reviewedSession = first.snapshot.researchSessions.find((item) => item.id === "session-c773bff5c54a2cd7");
    expect(reviewedSession?.experiments[0]).toMatchObject({
      id: "001-0f8bcb31c045",
      verdict: "REVERT",
      visualReview: {
        judge: { verdict: "REVERT" },
        selectedCase: { id: "yaw-redirection", selectionPolicy: "first-primary-gate-regression" },
        accepted: { id: "run-6f9c6481f208e927" },
        candidate: { id: "run-b05629b197f18ee9" },
      },
    });
    const html = await readFile(first.indexPath, "utf8");
    expect(html).toContain("Continuous Mission · one Episode, no reset");
    expect(html).toContain("mujica-continuous-mission-context");
    expect(html).toContain("missionSuiteJudge:'promotion-only'");
    expect(html).toContain("read-only evidence debugger");
    expect(html).toContain("Authoritative MuJoCo replay comparison");
    expect(html).toContain("Top-down path");
    expect(html).toContain("Research Lab ledger");
    expect(html).toContain("Review-guided Development Work Order");
    expect(html).toContain("Copy run command");
    expect(html).toContain("mujica-development-work-order-context");
    expect(html).toContain("Attention queue");
    expect(html).toContain("Human observation → Agent hypothesis");
    expect(html).toContain("Human hypothesis → governed Research Brief");
    expect(html).toContain("Research Review provenance");
    expect(html).toContain("ML Policy evidence · training is not promotion");
    expect(html).toContain("mujica-policy-training-context");
    expect(html).toContain("active actor authority");
    expect(html).toContain("promotion:'locked-judge-only'");
    expect(html).toContain("mujica-human-observation-draft");
    expect(html).toContain("mujica-research-brief-selector");
    expect(html).toContain("mujica-research-review-selector");
    expect(html).toContain("'research','brief'");
    expect(html).toContain("'studio','.'");
    expect(html).toContain("humanInput:'hypothesis-only'");
    expect(html).toContain("promotion:'locked-judge-only'");
    expect(html).toContain("first-primary-gate-regression");
    expect(html).toContain("mujica observation record");
    expect(html).toContain("Hardware Captures");
    expect(html).toContain("gate-regression");
    expect(html).toContain("Content-Security-Policy");
  });

  test("projects the immutable requirement-to-north-star Review without upgrading human hypotheses", async () => {
    const hexapod = resolve(import.meta.dir, "../../../examples/hexapod");
    const result = await writeStudioSnapshot(hexapod, { run: "run-d7305300508ff5c0" });
    expect(result.snapshot.developmentReview).toMatchObject({
      manifest: {
        status: "HUMAN_REVIEW_REQUIRED",
        northStarSatisfied: false,
      },
      review: {
        summary: {
          status: "HUMAN_REVIEW_REQUIRED",
          designPassed: true,
          passedStages: 1,
          totalStages: 1,
          violationCount: 0,
          interventionSurfaces: [{ surface: "human-review" }],
        },
        northStar: {
          numericalSatisfied: true,
          satisfied: false,
          humanReviewStatus: "REQUIRED",
        },
      },
    });
    expect(result.snapshot.developmentReview?.manifest.id).toMatch(/^development-review-[a-f0-9]{16}$/);
    expect(result.snapshot.developmentReview?.manifest.reviewHash).toBe(hashJson(result.snapshot.developmentReview?.review));
    const html = await readFile(result.indexPath, "utf8");
    expect(html).toContain("Executable Development Review");
    expect(html).toContain("Compiled design envelope");
    expect(html).toContain("Observed capability stages");
    expect(html).toContain("mujica-development-review-context");
    expect(html).toContain("visualInput:'hypothesis-only'");
  });

  test("refuses to invent a missing run", async () => {
    await expect(buildStudioSnapshot(project, { run: "run-does-not-exist" })).rejects.toThrow("Unknown completed run");
  });

  test("projects two Runs onto one simulation-time comparison", async () => {
    const result = await writeStudioSnapshot(project, { run: "run-e8bd80892b0f0123", compareRun: "run-0307db1a1c3dc228" });
    expect(result.snapshot.selectedRun?.id).toBe("run-e8bd80892b0f0123");
    expect(result.snapshot.comparisonRun?.id).toBe("run-0307db1a1c3dc228");
    const html = await readFile(result.indexPath, "utf8");
    expect(html).toContain("shared simulation time");
    expect(html).toContain("Motion-quality deltas");
    expect(html).toContain("mujica-run-comparison-context");
    expect(html).toContain("headlessArgv");
    expect(html).toContain("'evidence','inspect'");
    expect(html).toContain("subject − baseline");
  });

  test("projects recovery identity, outcome direction, and frame safety evidence", async () => {
    const result = await writeStudioSnapshot(project, {
      run: "run-4131a68192c07c85",
      compareRun: "run-28a9756c780c43a2",
    });
    expect(result.snapshot.selectedRun).toMatchObject({
      subject: { assembly: "self-righting-rigid-3dof", base: "quadruped-3dof", controller: "rigid-self-right" },
      metrics: { selfRightingTask: true, selfRightingSuccess: 0 },
    });
    expect(result.snapshot.comparisonRun).toMatchObject({
      subject: { assembly: "self-righting-waist-3dof", base: "quadruped-waist-3dof", controller: "waist-self-right" },
      metrics: { selfRightingTask: true, selfRightingSuccess: 0 },
    });
    const html = await readFile(result.indexPath, "utf8");
    expect(html).toContain("Self-righting outcome deltas");
    expect(html).toContain("Recovery target");
    expect(html).toContain("Controller phase");
    expect(html).toContain("Controller mode");
    expect(html).toContain("Mission stage");
    expect(html).toContain("Fall detector");
    expect(html).toContain("Mode transition");
    expect(html).toContain("Locomotion strategy");
    expect(html).toContain("Startup ramp");
    expect(html).toContain("Residual policy authority");
    expect(html).toContain("Mission command");
    expect(html).toContain("Detected fallen pose");
    expect(html).toContain("Support feet");
    expect(html).toContain("controllerTelemetry");
    expect(html).toContain("Disallowed self-contact");
    expect(html).toContain("recovery:side.run.metrics");
    expect(html).toContain("Self-righting morphology comparison");
  });

  test("binds an exact Research Review to its immutable accepted and candidate Runs", async () => {
    const reviewPath = join(
      project,
      "research-runs",
      "transition-controller-review",
      "sessions",
      "session-c773bff5c54a2cd7",
      "experiments",
      "001-0f8bcb31c045",
      "review.json",
    );
    const review = JSON.parse(await readFile(reviewPath, "utf8"));
    const result = await writeStudioSnapshot(project, {
      run: "run-6f9c6481f208e927",
      compareRun: "run-b05629b197f18ee9",
      researchReview: { review, reviewHash: hashJson(review) },
    });
    expect(result.snapshot.selectedResearchReview).toMatchObject({
      reviewHash: hashJson(review),
      review: {
        judge: { verdict: "REVERT" },
        selectedCase: { id: "yaw-redirection" },
        accepted: { id: "run-6f9c6481f208e927" },
        candidate: { id: "run-b05629b197f18ee9" },
      },
    });
    expect(result.snapshot.selectedRun?.id).toBe(review.accepted.id);
    expect(result.snapshot.comparisonRun?.id).toBe(review.candidate.id);
    await expect(buildStudioSnapshot(project, {
      run: review.accepted.id,
      compareRun: review.candidate.id,
      researchReview: { review, reviewHash: "0".repeat(64) },
    })).rejects.toThrow("differs from its immutable Run pair");
  });

  test("copies a verified MuJoCo replay into the offline snapshot", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "mujica-studio-replay-"));
    try {
      const runId = "run-e8bd80892b0f0123";
      const runManifest = JSON.parse(await readFile(join(project, "runs", runId, "manifest.json"), "utf8"));
      const frameBytes = Buffer.from("\x89PNG\r\n\x1a\n");
      const manifest = {
        version: 1,
        id: "replay-test",
        kind: "mujica-simulation-replay",
        renderer: "mujica-runtime-mujoco-rgb-v1",
        mujocoVersion: "3.10.0",
        runId,
        resultHash: runManifest.resultHash,
        frameCount: 1,
        framePattern: "frames/%06d.png",
        frameHashes: [sha256(frameBytes)],
        frameTimes: [0.02],
        settings: { width: 160, height: 120 },
        completed: true,
      };
      await mkdir(join(temporary, "frames"));
      await writeFile(join(temporary, "frames", "000000.png"), frameBytes);
      await writeFile(join(temporary, "manifest.json"), JSON.stringify(manifest));
      const result = await writeStudioSnapshot(project, { run: runId, replay: { path: temporary, manifest } });
      expect(result.snapshot.selectedReplay).toMatchObject({ id: "replay-test", frameBase: "replay/frames" });
      expect(await readFile(join(result.path, "replay", "frames", "000000.png"))).toEqual(frameBytes);
      const html = await readFile(result.indexPath, "utf8");
      expect(html).toContain("Authoritative MuJoCo replay comparison");
      expect(html).toContain("Copy comparison context for Agent");
      expect(html).toContain("mujica-runtime-mujoco-rgb-v1");
      expect(html).toContain("img-src 'self' data:");
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
});
