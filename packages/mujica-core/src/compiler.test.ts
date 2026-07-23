import { describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { calibrationSchema, canonicalPlantXml, compareAssemblies, compileAssembly, domainProfileSchema, driverPackageSchema, hardwareCaptureAuthorizationSchema, hardwareCapturePlanSchema, hardwareTargetSchema, humanObservationDraftSchema, loadBenchmark, loadCalibration, loadCandidate, loadComponent, loadController, loadDomainProfile, loadDriverPackage, loadHardwareCapturePlan, loadHardwareTarget, loadResearch, loadResearchLab, loadTraining, loadTrainingResearch, programControllerInterfaceIssues, researchBriefSchema, researchProposalSchema, researchReviewSchema, sha256, taskSchema, validateProject, verifyCandidateChanges } from "./index";

const project = resolve(import.meta.dir, "../../../examples/quadruped");

describe("Robot Assembly compiler", () => {
  test("component addition evolves the observation ABI without changing actions", async () => {
    const comparison = await compareAssemblies(project, "baseline", "force-sensing");
    expect(comparison.components.added.map((item) => item.componentId)).toEqual(["foot-force-sensor"]);
    expect(comparison.observations.added.map((item) => item.name)).toEqual(["foot-contact-force"]);
    expect(comparison.actions.added).toEqual([]);
    expect(comparison.from.observationContract.size).toBe(33);
    expect(comparison.to.observationContract.size).toBe(37);
    expect(comparison.to.actionContract.size).toBe(8);
    expect(comparison.massDeltaKg).toBeCloseTo(0.08);
    expect(comparison.to.components.find((item) => item.componentId === "foot-force-sensor")?.sensors.map((item) => item.name)).toEqual(["foot-force-fl", "foot-force-fr", "foot-force-rl", "foot-force-rr"]);
  });

  test("compiled morphology carries contact evidence without assuming four legs", async () => {
    const hexapod = resolve(import.meta.dir, "../../../examples/hexapod");
    const assembly = await compileAssembly(hexapod, "hexapod");
    expect(assembly.morphology).toMatchObject({ class: "legged", limbCount: 6, baseBody: "torso" });
    expect(assembly.morphology.contactPoints.map((point) => point.id)).toEqual([
      "front-left", "front-right", "middle-left", "middle-right", "rear-left", "rear-right",
    ]);
    expect(assembly.observationContract.channels.find((channel) => channel.name === "foot-contact-force")?.size).toBe(6);
    expect(assembly.actionContract.size).toBe(12);
  });

  test("components expose physical and kinematic inventory without changing executable MJCF", async () => {
    const component = await loadComponent(project, "body-imu");
    expect(component.manifest.physical.inertiaDiagonalKgM2).toEqual([0.00001, 0.00001, 0.00001]);
    expect(component.manifest.geometry).toEqual([]); expect(component.manifest.joints).toEqual([]); expect(component.manifest.actuators).toEqual([]);
    expect(component.manifest.sensors.map((item) => item.name)).toEqual(["body-gyro", "body-accelerometer"]);
    const assembly = await compileAssembly(project, "force-sensing-3dof");
    expect(assembly.modelHash).toBe("9690d57de5ea56e19d3c970b2acdda352a69e42a95bbe19797f963b8131ff0ea"); expect(assembly.executionHash).toHaveLength(64);
  });

  test("plant identity ignores comments and inter-tag layout but preserves MJCF semantics", async () => {
    expect(canonicalPlantXml("<mujoco><!-- runtime only --><worldbody>\n  <body mass=\"1\" />\n</worldbody></mujoco>"))
      .toBe("<mujoco><worldbody><body mass=\"1\" /></worldbody></mujoco>");
    expect(sha256(canonicalPlantXml("<mujoco><body mass=\"1\" /></mujoco>")))
      .not.toBe(sha256(canonicalPlantXml("<mujoco><body mass=\"2\" /></mujoco>")));
    const ordinary = await compileAssembly(project, "force-sensing-3dof");
    const history = await compileAssembly(project, "force-sensing-history-3dof");
    expect(history.modelHash).not.toBe(ordinary.modelHash);
    expect(history.plantHash).toBe(ordinary.plantHash);
    expect(history.plantHash).toHaveLength(64);
  });

  test("typed Component config is resolved into MJCF and appears in semantic diffs", async () => {
    const comparison = await compareAssemblies(project, "filtered-imu-default", "filtered-imu-fast");
    expect(comparison.from.components[0]?.config).toEqual({ cutoffHz: 50 }); expect(comparison.to.components[0]?.config).toEqual({ cutoffHz: 200 });
    expect(comparison.components.changed).toHaveLength(1); expect(comparison.observations.changed).toEqual([]); expect(comparison.actions.changed).toEqual([]);
    expect(await readFile(comparison.from.modelPath, "utf8")).toContain('cutoff="50"'); expect(await readFile(comparison.to.modelPath, "utf8")).toContain('cutoff="200"');
    expect(comparison.from.modelHash).not.toBe(comparison.to.modelHash); expect(comparison.from.executionHash).not.toBe(comparison.to.executionHash);
  });

  test("a mount fragment adds physical geometry at an explicit Base slot", async () => {
    const comparison = await compareAssemblies(project, "baseline", "payload-equipped"); const payload = comparison.components.added[0];
    expect(payload?.componentId).toBe("torso-payload-module"); expect(payload?.mount).toBe("torso-payload"); expect(payload?.geometry).toEqual([{ name: "torso-payload-geom", kind: "box", collision: false }]);
    expect(comparison.massDeltaKg).toBeCloseTo(0.2); expect(comparison.costDelta).toBe(2); expect(comparison.observations.added).toEqual([]); expect(comparison.actions.added).toEqual([]);
    const model = await readFile(comparison.to.modelPath, "utf8"); expect(model).toContain('name="torso-payload-geom"'); expect(model).not.toContain("MUJICA_MOUNT");
  });

  test("Component config fails closed when a value is out of range or unbound", async () => {
    const root = await mkdtemp(join(tmpdir(), "mujica-component-config-"));
    try {
      await mkdir(join(root, "assemblies"), { recursive: true }); await mkdir(join(root, "components"), { recursive: true }); await mkdir(join(root, "robots"), { recursive: true });
      await cp(join(project, "mujica.json"), join(root, "mujica.json")); await cp(join(project, "morphology.json"), join(root, "morphology.json")); await cp(join(project, "robots/quadruped-base"), join(root, "robots/quadruped-base"), { recursive: true }); await cp(join(project, "components/filtered-body-imu"), join(root, "components/filtered-body-imu"), { recursive: true });
      await writeFile(join(root, "assemblies/invalid.robot.json"), JSON.stringify({ version: 1, id: "invalid", name: "Invalid config", base: "quadruped-base", components: [{ id: "body-imu", component: "filtered-body-imu", mount: "torso-sensor", config: { cutoffHz: 1001 } }] }));
      await expect(compileAssembly(root, "invalid")).rejects.toThrow("value must be at most 1000");
      await writeFile(join(root, "assemblies/invalid.robot.json"), JSON.stringify({ version: 1, id: "invalid", name: "Invalid config", base: "quadruped-base", components: [{ id: "body-imu", component: "filtered-body-imu", mount: "torso-sensor" }] }));
      const manifestPath = join(root, "components/filtered-body-imu/component.json"); const manifest = JSON.parse(await readFile(manifestPath, "utf8")); manifest.configSchema.properties.deadParameter = { type: "number", default: 1 }; await writeFile(manifestPath, JSON.stringify(manifest));
      await expect(compileAssembly(root, "invalid")).rejects.toThrow("configuration property 'deadParameter' is not bound");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("development candidates declare the compiled hardware and contract diff", async () => {
    const candidate = await loadCandidate(project, "foot-force-recovery");
    const verified = await verifyCandidateChanges(project, candidate);
    expect(verified.actual.components.added).toEqual(["foot-force-sensor"]);
    expect(verified.actual.observations.added).toEqual(["foot-contact-force"]);
    expect(verified.actual.actions.added).toEqual([]);
    const dishonest = structuredClone(candidate);
    dishonest.changes.observations.added = [];
    await expect(verifyCandidateChanges(project, dishonest)).rejects.toThrow("do not match compiled Assembly diff");
  });

  test("actuator telemetry is an explicit observation-only component", async () => {
    const comparison = await compareAssemblies(project, "force-sensing-3dof", "force-sensing-telemetry-3dof");
    expect(comparison.components.added.map((item) => item.componentId)).toEqual(["actuator-telemetry"]);
    expect(comparison.observations.added.map((item) => item.name)).toEqual(["last-commanded-action", "last-applied-action"]);
    expect(comparison.from.observationContract.size).toBe(45);
    expect(comparison.to.observationContract.size).toBe(69);
    expect(comparison.actions.changed).toEqual([]);
    expect(comparison.massDeltaKg).toBe(0);
  });

  test("Program Controller interfaces reject missing observations before runtime", async () => {
    const controller = await loadController(project, "latency-aware-spatial-gait");
    const ordinary = await compileAssembly(project, "force-sensing-3dof"); const history = await compileAssembly(project, "force-sensing-history-3dof");
    expect(programControllerInterfaceIssues(controller.definition, ordinary)).toEqual([{
      code: "observation.missing", channel: "actuator-delay-steps",
      message: "Program Controller 'latency-aware-spatial-gait' requires Observation 'actuator-delay-steps' (size 1), but Assembly 'force-sensing-3dof' does not provide it",
    }]);
    expect(programControllerInterfaceIssues(controller.definition, history)).toEqual([]);
    const commanded = await loadController(project, "command-conditioned-spatial-gait"); const commandAssembly = await compileAssembly(project, "command-conditioned-history-3dof");
    expect(programControllerInterfaceIssues(commanded.definition, history).map((issue) => issue.channel)).toEqual(["motion-command"]);
    expect(programControllerInterfaceIssues(commanded.definition, commandAssembly)).toEqual([]);
  });

  test("checked-in Program Controller declarations cover their direct Observation reads", async () => {
    for (const id of ["baseline-gait", "force-aware-gait", "forward-gait", "spatial-forward-gait", "latency-aware-spatial-gait", "command-conditioned-spatial-gait"]) {
      const controller = await loadController(project, id); if (controller.definition.kind !== "program") throw new Error(`${id} is not a Program Controller`);
      const source = await readFile(join(controller.rootDir, controller.definition.entry), "utf8");
      const reads = [...source.matchAll(/observation\["([a-z0-9-]+)"\]/g)].map((match) => match[1]!).sort();
      expect(controller.definition.interface.requiredObservations.map((channel) => channel.name).sort()).toEqual([...new Set(reads)]);
    }
  });

  test("identical source compiles to an identical content address", async () => {
    const first = await compileAssembly(project, "baseline");
    const second = await compileAssembly(project, "baseline");
    expect(second.assemblyHash).toBe(first.assemblyHash);
    expect(second.modelPath).toBe(first.modelPath);
  });

  test("the complete example project resolves", async () => {
    const result = await validateProject(project);
    expect(result.project.manifest.id).toBe("quadruped");
    expect(result.project.manifest.defaults.assembly).toBe("command-conditioned-history-3dof");
    expect(result.project.manifest.defaults.controller).toBe("bounded-traction-gait");
    expect(result.assemblies.map((item) => item.id)).toEqual(["baseline", "command-conditioned-history-3dof", "filtered-imu-default", "filtered-imu-fast", "force-sensing", "force-sensing-3dof", "force-sensing-history-3dof", "force-sensing-telemetry-3dof", "payload-equipped"]);
    const spatial = result.assemblies.find((item) => item.id === "force-sensing-3dof");
    expect(spatial?.observationContract.size).toBe(45);
    expect(spatial?.actionContract.size).toBe(12);
    const telemetry = result.assemblies.find((item) => item.id === "force-sensing-telemetry-3dof");
    expect(telemetry?.observationContract.size).toBe(69);
    expect(telemetry?.actionContract.size).toBe(12);
    const history = result.assemblies.find((item) => item.id === "force-sensing-history-3dof");
    expect(history?.observationContract.size).toBe(142);
    expect(history?.actionContract.size).toBe(12);
    const commanded = result.assemblies.find((item) => item.id === "command-conditioned-history-3dof");
    expect(commanded?.observationContract.channels.at(-1)).toMatchObject({ name: "foot-contact-force", size: 4 });
    expect(commanded?.observationContract.channels.find((channel) => channel.name === "motion-command")).toMatchObject({ kind: "command", size: 3, source: "task:motion-command" });
    expect(commanded?.observationContract.size).toBe(145);
  });

  test("Domain Profiles are bounded provenance-carrying Training inputs", async () => {
    const profile = await loadDomainProfile(project, "quadruped-pre-hil-v1");
    expect(profile.provenance.kind).toBe("synthetic");
    expect(profile.provenance.evidence).toBeNull();
    expect(profile.parameters.actuatorStrengthScale).toEqual({ minimum: 0.9, maximum: 1.1 });
    const training = await loadTraining(project, "sim-to-real-residual-locomotion");
    expect(training.domainProfile).toBe(profile.id);
    expect(domainProfileSchema.safeParse({ ...profile, parameters: { bodyMassScale: { minimum: 1.1, maximum: 0.9 } } }).success).toBe(false);
    expect(domainProfileSchema.safeParse({ ...profile, provenance: { kind: "real", evidence: null, notes: "" } }).success).toBe(false);
  });

  test("Calibration definitions preserve provenance and whole-source validation", async () => {
    const calibration = await loadCalibration(project, "quadruped-synthetic-hidden-plant");
    expect(calibration.provenance).toMatchObject({ kind: "synthetic", device: null });
    expect(calibration.sources).toHaveLength(3);
    expect(calibration.optimizer.validationSources).toBe(1);
    expect(calibration.optimizer.maximumValidationLoss).toBe(0.01);
    expect(calibration.parameters.actuatorDelaySteps).toEqual({ minimum: 0, maximum: 3 });
    expect(calibrationSchema.safeParse({ ...calibration, provenance: { ...calibration.provenance, kind: "real" } }).success).toBe(false);
    expect(calibrationSchema.safeParse({ ...calibration, optimizer: { ...calibration.optimizer, validationSources: 3 } }).success).toBe(false);
    expect(calibrationSchema.safeParse({ ...calibration, optimizer: { ...calibration.optimizer, samplesPerAxis: 4 } }).success).toBe(false);
  });

  test("Hardware Capture Plans bound finite episodes and physical authorization", async () => {
    const driver = await loadDriverPackage(project, "mujoco-protocol-simulator");
    expect(driver.definition).toMatchObject({
      executable: "driver.py",
      environments: ["dry-run"],
      device: { vendor: "Mujica", model: "Protocol simulator" },
    });
    expect(driver.definition.capabilities).toContain("latched-stop-health");
    expect(driver.definition.capabilities).toContain("command-lease");
    expect(driverPackageSchema.safeParse({ ...driver.definition, executable: "../escape.py" }).success).toBe(false);
    expect(driverPackageSchema.safeParse({ ...driver.definition, capabilities: [...driver.definition.capabilities, "stop-ack"] }).success).toBe(false);
    const plan = await loadHardwareCapturePlan(project, "quadruped-dry-run-identification");
    expect(plan.target).toBe("spatial-dry-run");
    expect(plan.bundle).toMatch(/^hardware-/);
    expect(plan.mode).toBe("actuate");
    expect(plan.episodes.map((episode) => episode.id)).toEqual(["fit-a", "fit-b", "validation"]);
    expect(plan.action).toEqual({ scale: 1, maximumSlewPerSecond: 400 });
    expect(hardwareCapturePlanSchema.safeParse({ ...plan, id: "shadow-plan", mode: "shadow" }).success).toBe(true);
    expect(hardwareCapturePlanSchema.safeParse({ ...plan, safety: { ...plan.safety, maximumDecisionLatencyMs: 5 } }).success).toBe(true);
    expect(hardwareCapturePlanSchema.safeParse({ ...plan, safety: { ...plan.safety, maximumDecisionLatencyMs: 0 } }).success).toBe(false);
    expect(hardwareCapturePlanSchema.safeParse({ ...plan, safety: { ...plan.safety, minimumBaseHeightM: 0.9, maximumBaseHeightM: 0.8 } }).success).toBe(false);
    const hostLossPlan = await loadHardwareCapturePlan(project, "quadruped-host-loss-trip");
    expect(hostLossPlan.hostLossTest).toEqual({ episode: "host-loss-trip", afterStateStep: 1 });
    expect(hardwareCapturePlanSchema.safeParse({ ...hostLossPlan, hostLossTest: { episode: "missing", afterStateStep: 1 } }).success).toBe(false);
    expect(hardwareCapturePlanSchema.safeParse({ ...hostLossPlan, hostLossTest: { episode: "host-loss-trip", afterStateStep: 10 } }).success).toBe(false);
    const authorization = {
      version: 1, plan: plan.id, planHash: "a".repeat(64), target: "physical-target", bundleHash: "b".repeat(64), environment: "real",
      device: { vendor: "Vendor", model: "Robot", serial: "robot-001" }, operator: "Operator",
      approvedAt: "2026-07-23T10:00:00.000Z", expiresAt: "2026-07-23T10:10:00.000Z", maximumEpisodes: 3, notes: "",
    };
    expect(hardwareCaptureAuthorizationSchema.safeParse(authorization).success).toBe(true);
    expect(hardwareCaptureAuthorizationSchema.safeParse({ ...authorization, environment: "dry-run" }).success).toBe(false);
    const policyTarget = await loadHardwareTarget(project, "history-policy-shadow-dry-run");
    expect(policyTarget).toMatchObject({
      revision: "quadruped-p-ed7ad2ff20dd",
      revisionKind: "policy",
      assembly: "force-sensing-history-3dof",
      controller: "capture-calibrated-history-residual-gait",
      driver: "mujoco-protocol-simulator",
      safety: {
        commandLeaseMs: 100,
        maximumCommandLeaseOverrunMs: 25,
        requireDecisionDeadline: true,
        requireDeviceHealth: true,
        maximumMotorTemperatureC: 80,
        maximumMotorCurrentA: 20,
        minimumBusVoltageV: 20,
        maximumBusVoltageV: 30,
        requirePostStopHealthCheck: true,
        postStopHealthySamples: 3,
        postStopMinimumHealthyDurationMs: 20,
      },
    });
    expect(hardwareTargetSchema.safeParse({ ...policyTarget, safety: { ...policyTarget.safety, maximumMotorTemperatureC: undefined } }).success).toBe(false);
    expect(hardwareTargetSchema.safeParse({ ...policyTarget, safety: { ...policyTarget.safety, minimumBusVoltageV: 31 } }).success).toBe(false);
    expect(hardwareTargetSchema.safeParse({ ...policyTarget, safety: { ...policyTarget.safety, requireDeviceHealth: false } }).success).toBe(false);
    expect(hardwareTargetSchema.safeParse({ ...policyTarget, safety: { ...policyTarget.safety, postStopHealthySamples: undefined } }).success).toBe(false);
    expect(hardwareTargetSchema.safeParse({ ...policyTarget, safety: { ...policyTarget.safety, requirePostStopHealthCheck: false } }).success).toBe(false);
    expect(hardwareTargetSchema.safeParse({ ...policyTarget, safety: { ...policyTarget.safety, maximumCommandLeaseOverrunMs: undefined } }).success).toBe(false);
  });

  test("research definitions expose a bounded editable surface", async () => {
    const research = await loadResearch(project, "support-controller");
    expect(research.editable.path).toBe("controllers/force-aware-gait/controller.json");
    expect(research.editable.parameters.map((item) => item.path)).toContain("/config/contactGain");
    expect(researchProposalSchema.safeParse({ strategy: "badStrategy", hypothesis: "x", expectedEffect: "y", values: { "/config/kp": 26 } }).success).toBe(false);
    const compound = await loadResearch(project, "compound-recovery"); expect(compound.assembly).toBe("force-sensing-history-3dof"); expect(compound.editable.parameters.map((item) => item.path)).toContain("/config/lateralVelocityGain");
  });

  test("human observations stay typed as source-bound hypotheses", () => {
    const draft = {
      version: 1,
      kind: "mujica-human-observation-draft",
      source: { kind: "run-frame", runId: "run-example", resultHash: "a".repeat(64), timeSeconds: 0.04 },
      assessment: { category: "motion", severity: "investigate", confidence: "medium", summary: "The front foot appears to slap." },
    };
    expect(humanObservationDraftSchema.safeParse(draft).success).toBe(true);
    expect(humanObservationDraftSchema.safeParse({ ...draft, assessment: { ...draft.assessment, severity: "verified" } }).success).toBe(false);
    expect(humanObservationDraftSchema.safeParse({
      ...draft,
      source: { ...draft.source, comparisonRunId: "run-subject" },
    }).success).toBe(false);
    expect(humanObservationDraftSchema.safeParse({
      ...draft,
      source: {
        kind: "hardware-capture-frame",
        captureId: "capture-example",
        captureHash: "b".repeat(64),
        bundleHash: "c".repeat(64),
        episodeId: "commissioning",
        episodeHash: "d".repeat(64),
        timeSeconds: 0.08,
      },
    }).success).toBe(true);
    expect(humanObservationDraftSchema.safeParse({
      ...draft,
      source: {
        kind: "digital-twin-audit-transition",
        auditId: "twin-audit-example",
        auditHash: "e".repeat(64),
        captureId: "capture-example",
        captureHash: "b".repeat(64),
        bundleHash: "c".repeat(64),
        episodeId: "commissioning",
        episodeHash: "d".repeat(64),
        transitionIndex: 6,
      },
    }).success).toBe(true);
  });

  test("Research Briefs preserve hypothesis and Judge authority boundaries", async () => {
    const lab = await loadResearchLab(project, "motion-quality-residual-policy");
    const context = { version: 1, kind: "mujica-run-frame-context", authority: "immutable-evidence", contextHash: "c".repeat(64) };
    const brief = {
      version: 1,
      kind: "mujica-research-brief",
      authority: "derived-handoff",
      claimKind: "research-prioritization",
      lab: { definition: lab, labHash: "a".repeat(64), programHash: "b".repeat(64), benchmarkLockHash: "d".repeat(64) },
      observations: [{
        id: "observation-example",
        observationHash: "e".repeat(64),
        contextHash: context.contextHash,
        draftHash: "f".repeat(64),
        observer: "Human reviewer",
        recordedAt: "2026-07-23T12:00:00.000Z",
        source: { kind: "run-frame", runId: "run-example", resultHash: "1".repeat(64), timeSeconds: 0.04 },
        assessment: { category: "motion", severity: "investigate", confidence: "medium", summary: "The front foot appears to slap." },
        context,
      }],
      authorityBoundary: { humanInput: "hypothesis-only", sourceContext: "immutable-evidence", sourceEdits: "lab-closure-only", promotion: "locked-judge-only" },
    };
    expect(researchBriefSchema.safeParse(brief).success).toBe(true);
    expect(researchBriefSchema.safeParse({
      ...brief,
      authorityBoundary: { ...brief.authorityBoundary, promotion: "human-approved" },
    }).success).toBe(false);
    expect(researchBriefSchema.safeParse({ ...brief, observations: [] }).success).toBe(false);
  });

  test("Research Reviews preserve visual interpretation below locked Judge authority", () => {
    const decision = {
      verdict: "REVERT",
      gateReasons: ["delayed-braking: lateral-drift regressed from passing to failing"],
      previousViolationCount: 0,
      candidateViolationCount: 1,
      previousViolationSeverity: 0,
      candidateViolationSeverity: 0.25,
      feasibilityImproved: false,
      severityImproved: false,
      scoreImproved: true,
      selectionReason: "gate-regression",
    };
    const run = (role: "accepted" | "candidate", digit: string) => ({
      role,
      id: `run-${role}`,
      runKey: digit.repeat(64),
      resultHash: digit.repeat(64),
      artifactHash: digit.repeat(64),
      manifestHash: digit.repeat(64),
      metricsHash: digit.repeat(64),
      scoreHash: digit.repeat(64),
      assembly: "review-assembly",
      controller: `review-${role}`,
      score: role === "accepted" ? 60 : 61,
    });
    const review = {
      version: 1,
      kind: "mujica-research-review",
      authority: "derived-human-review",
      claimKind: "visual-witness",
      lineage: {
        researchId: "review-lab",
        labHash: "1".repeat(64),
        programHash: "2".repeat(64),
        benchmarkLockHash: "3".repeat(64),
        researchBriefId: "brief-example",
        researchBriefHash: "4".repeat(64),
        observationIds: ["observation-example"],
        sessionId: "session-example",
        experimentId: "001-example",
        experimentHash: "5".repeat(64),
      },
      proposal: { strategy: "review-test", hypothesis: "Test a visible change.", expectedEffect: "The Judge and human see the same candidate." },
      judge: { verdict: "REVERT", decision, decisionHash: "6".repeat(64) },
      selectedCase: {
        benchmark: "review-benchmark",
        id: "delayed-braking",
        task: "brake",
        scenario: "delay",
        seed: 7,
        weight: 1,
        gating: true,
        selectionPolicy: "first-primary-gate-regression",
        selectionReason: "The locked Judge named this case first.",
        candidateScoreDelta: 1,
        weightedScoreDelta: 1,
      },
      accepted: run("accepted", "a"),
      candidate: run("candidate", "b"),
      authorityBoundary: {
        visualInterpretation: "hypothesis-only",
        simulationEvidence: "immutable-runs",
        experimentDecision: "locked-judge",
        sourcePromotion: "verdict-governed",
      },
    };
    expect(researchReviewSchema.safeParse(review).success).toBe(true);
    expect(researchReviewSchema.safeParse({
      ...review,
      authorityBoundary: { ...review.authorityBoundary, experimentDecision: "human-overridable" },
    }).success).toBe(false);
  });

  test("training research names one bounded Training definition", async () => {
    const research = await loadTrainingResearch(project, "residual-policy");
    expect(research.editable.path).toBe("training/force-residual-locomotion.training.json");
    expect(research.editable.parameters.find((item) => item.path === "/totalSteps")?.integer).toBe(true);
    expect(research.seed).toBe(42);
    const spatial = await loadTrainingResearch(project, "spatial-residual-policy");
    expect(spatial.editable.parameters.find((item) => item.path === "/residualScale")?.maximum).toBe(1);
    const generalized = await loadTrainingResearch(project, "spatial-generalized-policy");
    expect(generalized.editable.parameters.find((item) => item.path === "/residualPenalty")?.maximum).toBe(0.2);
    const historyLab = await loadResearchLab(project, "capture-calibrated-history-policy");
    expect(historyLab.execution).toMatchObject({ kind: "policy", referenceController: "latency-aware-spatial-gait" });
  });

  test("robustness benchmarks distinguish promotion gates from scored challenges", async () => {
    const benchmark = await loadBenchmark(project, "forward-locomotion");
    expect(benchmark.cases.find((item) => item.id === "nominal")?.gating).toBe(true);
    expect(benchmark.cases.find((item) => item.id === "actuator-delay")?.gating).toBe(false);
    const spatial = await loadBenchmark(project, "spatial-robustness");
    expect(spatial.cases.find((item) => item.id === "actuator-delay")?.gating).toBe(true);
    expect(spatial.cases.find((item) => item.id === "strong-lateral-push")?.gating).toBe(true);
  });

  test("scheduled motion commands are bounded and aligned to exact control steps", () => {
    const task = { version: 3, id: "brake", name: "Brake", durationSeconds: 4, controlHz: 50, healthyHeight: [0.19, 0.7], terminateOnFall: true, motionCommandSchedule: [
      { atSeconds: 0, command: { frame: "world", linearVelocityMps: [0.25, 0], yawRateRadPerSec: 0 } },
      { atSeconds: 2, command: { frame: "world", linearVelocityMps: [0, 0], yawRateRadPerSec: 0 } },
    ] };
    expect(taskSchema.safeParse(task).success).toBe(true);
    expect(taskSchema.safeParse({ ...task, motionCommandSchedule: [{ ...task.motionCommandSchedule[0], atSeconds: 0.01 }] }).success).toBe(false);
    expect(taskSchema.safeParse({ ...task, motionCommandSchedule: [task.motionCommandSchedule[0], { ...task.motionCommandSchedule[1], atSeconds: 1.999 }] }).success).toBe(false);
    expect(taskSchema.safeParse({ ...task, motionCommandSchedule: Array.from({ length: 17 }, (_, index) => ({ atSeconds: index * 0.02, command: task.motionCommandSchedule[0]!.command })) }).success).toBe(false);
  });
});
