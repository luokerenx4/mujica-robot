import { describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compareAssemblies, compileAssembly, loadBenchmark, loadCandidate, loadComponent, loadController, loadResearch, loadTrainingResearch, programControllerInterfaceIssues, researchProposalSchema, validateProject, verifyCandidateChanges } from "./index";

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

  test("components expose physical and kinematic inventory without changing executable MJCF", async () => {
    const component = await loadComponent(project, "body-imu");
    expect(component.manifest.physical.inertiaDiagonalKgM2).toEqual([0.00001, 0.00001, 0.00001]);
    expect(component.manifest.geometry).toEqual([]); expect(component.manifest.joints).toEqual([]); expect(component.manifest.actuators).toEqual([]);
    expect(component.manifest.sensors.map((item) => item.name)).toEqual(["body-gyro", "body-accelerometer"]);
    const assembly = await compileAssembly(project, "force-sensing-3dof");
    expect(assembly.modelHash).toBe("9690d57de5ea56e19d3c970b2acdda352a69e42a95bbe19797f963b8131ff0ea"); expect(assembly.executionHash).toHaveLength(64);
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
      await cp(join(project, "mujica.json"), join(root, "mujica.json")); await cp(join(project, "robots/quadruped-base"), join(root, "robots/quadruped-base"), { recursive: true }); await cp(join(project, "components/filtered-body-imu"), join(root, "components/filtered-body-imu"), { recursive: true });
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
    expect(result.project.manifest.defaults.assembly).toBe("force-sensing-3dof");
    expect(result.project.manifest.defaults.controller).toBe("spatial-residual-gait");
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

  test("research definitions expose a bounded editable surface", async () => {
    const research = await loadResearch(project, "support-controller");
    expect(research.editable.path).toBe("controllers/force-aware-gait/controller.json");
    expect(research.editable.parameters.map((item) => item.path)).toContain("/config/contactGain");
    expect(researchProposalSchema.safeParse({ strategy: "badStrategy", hypothesis: "x", expectedEffect: "y", values: { "/config/kp": 26 } }).success).toBe(false);
    const compound = await loadResearch(project, "compound-recovery"); expect(compound.assembly).toBe("force-sensing-history-3dof"); expect(compound.editable.parameters.map((item) => item.path)).toContain("/config/lateralVelocityGain");
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
  });

  test("robustness benchmarks distinguish promotion gates from scored challenges", async () => {
    const benchmark = await loadBenchmark(project, "forward-locomotion");
    expect(benchmark.cases.find((item) => item.id === "nominal")?.gating).toBe(true);
    expect(benchmark.cases.find((item) => item.id === "actuator-delay")?.gating).toBe(false);
    const spatial = await loadBenchmark(project, "spatial-robustness");
    expect(spatial.cases.find((item) => item.id === "actuator-delay")?.gating).toBe(true);
    expect(spatial.cases.find((item) => item.id === "strong-lateral-push")?.gating).toBe(true);
  });
});
