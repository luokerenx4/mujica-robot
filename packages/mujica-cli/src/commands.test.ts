import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { loadController, loadResearch, loadResearchLab, loadTraining, loadTrainingResearch } from "@mujica/core";
import { assertDomainProfilePlantCompatible, candidateSelection, researchDecision, researchGateReasons, upperViolationSeverity, validateResearchProposal, validateTrainingProposal } from "./commands";
import { assertResearchLabEditableChanges, policyReferenceGateReasons, researchPathIsEditable, trainingRunStableResultIdentity } from "./research-lab";
import { assertCaptureModeAllowed, validateCaptureAuthorization } from "./hardware";

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
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "train-research")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "policy-revision.inspect")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "studio")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "hardware.export")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "hardware.verify")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "capture.run")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "policy.requalify")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "controller.list")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "controller.inspect")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "diagnose")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "domain.inspect")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "calibrate")).toBe(true);
    expect(envelope.data.commands.some((item: { id: string }) => item.id === "calibration.promote")).toBe(true);
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
      "--driver", "examples/quadruped/drivers/mujoco-protocol-simulator.py",
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
      expect(manifest.protocolCapabilities).toEqual(["applied-action", "shadow-action", "state-age-ms", "stop-ack"]);
      expect(manifest.stateAge.samples).toBeGreaterThan(0);
      expect(manifest.driverInputs[0].hash).toHaveLength(64);
      expect(manifest.episodes.map((episode: any) => episode.hash).every((hash: string) => hash.length === 64)).toBe(true);
      const firstRow = JSON.parse((await readFile(resolve(artifactPath, manifest.episodes[0].path), "utf8")).split("\n")[0]!);
      expect(firstRow.proposedAction).toHaveLength(12);
      expect(firstRow.commandedAction).toHaveLength(12);
      expect(firstRow.appliedAction).toHaveLength(12);
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
      "--driver", "examples/quadruped/drivers/mujoco-protocol-simulator.py",
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
    });
    expect(() => assertCaptureModeAllowed(
      { id: bundle.data.id, sourceKind: "policy-revision", maximumCaptureMode: "shadow" },
      { id: "forbidden-policy-actuation", mode: "actuate" } as any,
    )).toThrow("cannot actuate shadow-only Policy Revision Bundle");

    const captured = invoke([
      "capture", "run", "examples/quadruped", "--plan", "history-policy-shadow-dry-run",
      "--driver", "examples/quadruped/drivers/mujoco-protocol-simulator.py",
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

  test("physical Capture requires matching, live, external operator authorization", () => {
    const target: any = { version: 1, id: "robot-target", name: "Robot", revision: "robot-r1", assembly: "robot", controller: "control", environment: "real", protocol: "stdio-jsonl-v1", controlHz: 50, safety: { maximumLatencyMs: 10, maximumConsecutiveMisses: 1, emergencyStopAction: [0] }, device: { vendor: "Vendor", model: "Robot", serialRequired: true } };
    const plan: any = { version: 1, id: "capture-plan", name: "Capture", target: target.id, bundle: "hardware-a", episodes: [{ id: "one", seed: 1, steps: 10 }], action: { scale: 0.5, maximumSlewPerSecond: 1 }, safety: { maximumJointVelocityRadPerSec: 1 }, notes: "" };
    const bundle = { bundleHash: "b".repeat(64) }; const planHash = "a".repeat(64); const now = Date.parse("2026-07-23T10:05:00.000Z");
    const authorization: any = { version: 1, plan: plan.id, planHash, target: target.id, bundleHash: bundle.bundleHash, environment: "real", device: { vendor: "Vendor", model: "Robot", serial: "robot-001" }, operator: "Operator", approvedAt: "2026-07-23T10:00:00.000Z", expiresAt: "2026-07-23T10:10:00.000Z", maximumEpisodes: 1, notes: "" };
    expect(() => validateCaptureAuthorization(target, plan, planHash, bundle, "Operator", null, now)).toThrow("requires --authorization");
    expect(() => validateCaptureAuthorization(target, plan, planHash, bundle, "Operator", authorization, now)).not.toThrow();
    expect(() => validateCaptureAuthorization(target, plan, planHash, bundle, "Operator", { ...authorization, expiresAt: "2026-07-23T10:04:00.000Z" }, now)).toThrow("not currently valid");
    expect(() => validateCaptureAuthorization(target, plan, planHash, bundle, "Different", authorization, now)).toThrow("operator");
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

  test("validation crosses the Python MuJoCo boundary", async () => {
    const result = invoke(["validate", "examples/quadruped", "--json"]); const envelope = JSON.parse(result.stdout);
    expect(result.code).toBe(0);
    expect(envelope.data.runtimeModels.map((item: { nu: number }) => item.nu)).toEqual([8, 12, 8, 8, 8, 12, 12, 12, 8]);
    expect(envelope.data.runtimeModels.map((item: { nsensor: number }) => item.nsensor)).toEqual([2, 6, 2, 2, 6, 6, 6, 6, 2]);
    const baseline = envelope.data.runtimeModels.find((item: { assembly: string }) => item.assembly === "baseline"); const payload = envelope.data.runtimeModels.find((item: { assembly: string }) => item.assembly === "payload-equipped");
    expect(payload.ngeom).toBe(baseline.ngeom + 1); expect(payload.modelMassKg - baseline.modelMassKg).toBeCloseTo(0.2);
    expect(envelope.data.definitions.research).toBe(9);
    expect(envelope.data.definitions.trainingResearch).toBe(4);
    expect(envelope.data.definitions.hardwareTargets).toBe(2);
    expect(envelope.data.definitions.researchLabs).toBe(5);
    expect(envelope.data.definitions.domainProfiles).toBe(4);
    expect(envelope.data.definitions.calibrations).toBe(2);
    expect(envelope.data.definitions.capturePlans).toBe(4);
    const lock = JSON.parse(await readFile(resolve(root, "examples/quadruped/benchmarks/sensor-development.lock.json"), "utf8"));
    expect(lock.harnessSourceHash).toHaveLength(64);
    expect(lock.evaluatorDependencyLockHash).toHaveLength(64);
  }, 20_000);

  test("hardware dry-run evidence cannot masquerade as physical verification", async () => {
    const exported = invoke(["hardware", "export", "examples/quadruped", "--target", "spatial-dry-run", "--json"]); const bundle = JSON.parse(exported.stdout); expect(exported.code).toBe(0);
    const verified = invoke(["hardware", "verify", "examples/quadruped", "--bundle", bundle.data.id, "--evidence", "examples/quadruped/hardware-evidence/spatial-dry-run.json", "--json"]); const result = JSON.parse(verified.stdout);
    expect(verified.code).toBe(0); expect(result.data.status).toBe("PROTOCOL-VERIFIED"); expect(result.data.protocolVerified).toBe(true); expect(result.data.hardwareVerified).toBe(false);
    expect(result.data.evidence.samples).toBe(250); expect(result.data.reasons).toEqual([]);
    const policyVerified = invoke([
      "hardware", "verify", "examples/quadruped",
      "--bundle", "hardware-113d1063cfc83f6b",
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
      const evidencePath = resolve(temporaryRoot, "stale.json");
      await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
      const rejected = invoke(["hardware", "verify", "examples/quadruped", "--bundle", bundle.data.id, "--evidence", evidencePath, "--json"]);
      expect(rejected.code).toBe(0);
      const rejectedEnvelope = JSON.parse(rejected.stdout);
      expect(rejectedEnvelope.data.status).toBe("FAILED");
      expect(rejectedEnvelope.data.reasons).toEqual([
        "observed state age exceeds safety limit",
        "not every emergency stop was acknowledged",
      ]);
      rmSync(rejectedEnvelope.data.path, { recursive: true, force: true });
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
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
