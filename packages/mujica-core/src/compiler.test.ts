import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { compareAssemblies, compileAssembly, loadBenchmark, loadResearch, loadTrainingResearch, researchProposalSchema, validateProject } from "./index";

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
    expect(result.assemblies.map((item) => item.id)).toEqual(["baseline", "force-sensing"]);
  });

  test("research definitions expose a bounded editable surface", async () => {
    const research = await loadResearch(project, "support-controller");
    expect(research.editable.path).toBe("controllers/force-aware-gait/controller.json");
    expect(research.editable.parameters.map((item) => item.path)).toContain("/config/contactGain");
    expect(researchProposalSchema.safeParse({ strategy: "badStrategy", hypothesis: "x", expectedEffect: "y", values: { "/config/kp": 26 } }).success).toBe(false);
  });

  test("training research names one bounded Training definition", async () => {
    const research = await loadTrainingResearch(project, "residual-policy");
    expect(research.editable.path).toBe("training/force-residual-locomotion.training.json");
    expect(research.editable.parameters.find((item) => item.path === "/totalSteps")?.integer).toBe(true);
    expect(research.seed).toBe(42);
  });

  test("robustness benchmarks distinguish promotion gates from scored challenges", async () => {
    const benchmark = await loadBenchmark(project, "forward-locomotion");
    expect(benchmark.cases.find((item) => item.id === "nominal")?.gating).toBe(true);
    expect(benchmark.cases.find((item) => item.id === "actuator-delay")?.gating).toBe(false);
  });
});
