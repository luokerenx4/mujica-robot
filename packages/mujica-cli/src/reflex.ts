import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  assertProgramControllerCompatible,
  atomicDirectory,
  compileAssembly,
  confined,
  hashDirectory,
  hashJson,
  loadBenchmark,
  loadController,
  loadProject,
  loadScenario,
  loadTask,
  sha256,
  writeJson,
  type ControllerDefinition,
} from "@mujica/core";
import { success } from "./contract";
import { requireBenchmarkLock } from "./commands";
import {
  harnessSourceHash,
  invokeRuntime,
  runtimeCompiled,
  runtimeSourceHash,
  runtimeVersion,
} from "./runtime";
import { loadReflexSearch } from "./reflex-artifact";

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function boundedInteger(
  value: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer within [${minimum}, ${maximum}]`);
  }
  return value;
}

function boundedNumber(
  value: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be within [${minimum}, ${maximum}]`);
  }
  return value;
}

export async function reflexSearchCommand(
  projectDir: string,
  options: {
    assembly: string;
    controller: string;
    policy: string;
    benchmark: string;
    task: string;
    scenarios: string[];
    caseSeedBase: number;
    seedsPerScenario: number;
    samples: number;
    seed: number;
    segments: number;
    reflexDurationSeconds: number;
    outcomeHorizonSeconds: number;
    maximumRawActionDelta: number;
    actionAxes: number[];
  },
) {
  const samples = boundedInteger(options.samples, "samples", 1, 512);
  const seed = boundedInteger(options.seed, "seed", 0, 2_147_483_647);
  const seedsPerScenario = boundedInteger(
    options.seedsPerScenario,
    "seeds-per-scenario",
    1,
    8,
  );
  const caseSeedBase = boundedInteger(
    options.caseSeedBase,
    "case-seed-base",
    0,
    2_147_483_647
      - Math.max(options.scenarios.length * seedsPerScenario - 1, 0),
  );
  const segments = boundedInteger(options.segments, "segments", 1, 8);
  const reflexDurationSeconds = boundedNumber(
    options.reflexDurationSeconds,
    "reflex-duration",
    0.02,
    2,
  );
  const outcomeHorizonSeconds = boundedNumber(
    options.outcomeHorizonSeconds,
    "outcome-horizon",
    0.1,
    8,
  );
  const maximumRawActionDelta = boundedNumber(
    options.maximumRawActionDelta,
    "maximum-delta",
    0.01,
    4,
  );
  const project = await loadProject(projectDir);
  const benchmark = await loadBenchmark(project.rootDir, options.benchmark);
  const lock = await requireBenchmarkLock(project, benchmark);
  const assembly = await compileAssembly(project.rootDir, options.assembly);
  const sourceController = await loadController(project.rootDir, options.controller);
  if (sourceController.definition.kind !== "policy") {
    throw new Error("Reflex Search requires a Policy Controller");
  }
  const controller: ControllerDefinition = {
    ...sourceController.definition,
    policy: options.policy,
    deterministic: true,
  };
  assertProgramControllerCompatible(controller, assembly);
  if (
    options.actionAxes.length === 0
    || new Set(options.actionAxes).size !== options.actionAxes.length
    || options.actionAxes.some(
      (axis) => !Number.isInteger(axis)
        || axis < 0
        || axis >= assembly.actionContract.size,
    )
  ) {
    throw new Error(
      `action-axes must be unique indices within [0, ${assembly.actionContract.size})`,
    );
  }
  const policyRoot = confined(project.rootDir, `policies/${options.policy}`);
  const [manifest, architecture, policyHash, model, normalizer] = await Promise.all([
    readFile(join(policyRoot, "manifest.json"), "utf8").then(JSON.parse),
    readFile(join(policyRoot, "architecture.json"), "utf8").then(JSON.parse),
    hashDirectory(policyRoot),
    readFile(join(policyRoot, "model.pt")),
    readFile(join(policyRoot, "normalizer.json")),
  ]);
  if (
    manifest.id !== options.policy
    || manifest.executionHash !== assembly.executionHash
    || manifest.observationContractHash !== hashJson(assembly.observationContract)
    || manifest.actionContractHash !== hashJson(assembly.actionContract)
  ) {
    throw new Error(
      `Frozen Policy '${options.policy}' is not executable on Assembly '${options.assembly}'`,
    );
  }
  if (
    architecture.actionTransform?.kind !== "program-controller-residual"
    || architecture.bilateralSymmetry?.kind !== "lateral-reflection-v1"
  ) {
    throw new Error(
      "Reflex Search requires a residual Policy with validated lateral reflection",
    );
  }
  if (
    options.scenarios.length < 2
    || new Set(options.scenarios).size !== options.scenarios.length
  ) {
    throw new Error("Reflex Search requires at least two unique Training scenarios");
  }
  const task = await loadTask(project.rootDir, options.task);
  const benchmarkSeeds = new Set(benchmark.cases.map((item) => item.seed));
  const loadedScenarios = await Promise.all(
    options.scenarios.map(
      async (scenarioId) => await loadScenario(project.rootDir, scenarioId),
    ),
  );
  const cases = loadedScenarios.flatMap((scenario, scenarioIndex) =>
    Array.from({ length: seedsPerScenario }, (_, seedIndex) => {
      const caseSeed = caseSeedBase + scenarioIndex * seedsPerScenario + seedIndex;
      if (benchmarkSeeds.has(caseSeed)) {
        throw new Error(
          `Reflex Search seed '${caseSeed}' overlaps locked Benchmark '${benchmark.id}'`,
        );
      }
      return {
        id: `training-${scenario.id}-seed-${caseSeed}`,
        weight: 1,
        gating: false,
        task,
        scenario,
        seed: caseSeed,
      };
    })
  );
  const [sourceHash, harnessHash] = await Promise.all([
    runtimeSourceHash(),
    harnessSourceHash(),
  ]);
  const search = {
    samples,
    seed,
    segments,
    reflexDurationSeconds,
    outcomeHorizonSeconds,
    maximumRawActionDelta,
    actionAxes: options.actionAxes,
    seedsPerScenario,
  };
  const runtimeResult = await invokeRuntime("search-reflex", {
    runtimeVersion,
    runtimeSourceHash: sourceHash,
    harnessSourceHash: harnessHash,
    projectDir: project.rootDir,
    modelPath: assembly.modelPath,
    compiled: runtimeCompiled(assembly),
    controller,
    architecture,
    cases,
    search,
  });
  const demonstrations = runtimeResult.demonstrations;
  const demonstrationsHash = hashJson(demonstrations);
  const evaluation = {
    version: 1,
    kind: "mujica-impact-reflex-search",
    project: project.manifest.id,
    benchmark: { id: benchmark.id, lockHash: lock.lockHash },
    dataPartition: {
      search: {
        authority: "training-only",
        task: options.task,
        cases: cases.map((item) => ({
          id: item.id,
          scenario: item.scenario.id,
          seed: item.seed,
        })),
      },
      judge: {
        authority: "promotion-only",
        cases: benchmark.cases.map((item) => ({
          id: item.id,
          task: item.task,
          scenario: item.scenario,
          seed: item.seed,
        })),
      },
      seedOverlap: false,
    },
    subject: {
      assembly: assembly.id,
      assemblyHash: assembly.assemblyHash,
      executionHash: assembly.executionHash,
      modelHash: assembly.modelHash,
      plantHash: assembly.plantHash,
      controller: options.controller,
      frozenPolicy: {
        id: options.policy,
        policyHash,
        modelHash: sha256(model),
        normalizerHash: sha256(normalizer),
        architectureHash: hashJson(architecture),
        observationContractHash: manifest.observationContractHash,
        actionContractHash: manifest.actionContractHash,
        priorControllerHash: architecture.actionTransform.controllerHash,
      },
    },
    invariants: {
      policyWeights: "byte-identical",
      normalizer: "byte-identical",
      programPrior: "byte-identical",
      assembly: "byte-identical",
      plantPerCase: "byte-identical",
      taskScenarioSeedPerCase: "byte-identical",
      judgeSeedsExcludedFromSearch: true,
      preTriggerStatePerCase: "hash-identical",
      candidateMapping: "state-conditioned-load-aware",
      bilateralSymmetry: "audited-not-forced-for-load-asymmetric-cases",
    },
    search: runtimeResult.contract,
    preTriggerStateHashes: runtimeResult.preTriggerStateHashes,
    baseline: runtimeResult.baseline,
    selected: runtimeResult.selected,
    selectedIndex: runtimeResult.selectedIndex,
    candidateCount: runtimeResult.candidateCount,
    candidateSummaries: runtimeResult.candidateSummaries,
    assessment: runtimeResult.assessment,
    demonstrations: {
      hash: demonstrationsHash,
      count: demonstrations.length,
      path: "demonstrations.json",
      target: "pre-transform-actor-raw-action",
    },
    authorityBoundary: {
      proxyClaim: "bounded-post-impact-physical-state-only",
      trainingClaim: "demonstration-source-only",
      promotion: "locked-continuous-mission-judge-required",
      visualInterpretation: "hypothesis-only",
    },
    provenance: {
      runtimeVersion,
      runtimeSourceHash: sourceHash,
      harnessSourceHash: harnessHash,
    },
  };
  const evaluationHash = hashJson(evaluation);
  const id = `reflex-search-${evaluationHash.slice(0, 16)}`;
  const target = confined(project.rootDir, `reflex-searches/${id}`);
  let cached = false;
  if (await exists(join(target, "manifest.json"))) {
    await loadReflexSearch(project.rootDir, id);
    cached = true;
  } else {
    await atomicDirectory(target, async (directory) => {
      await writeJson(join(directory, "evaluation.json"), evaluation);
      await writeJson(join(directory, "demonstrations.json"), demonstrations);
      await writeFile(
        join(directory, "report.md"),
        `# Bilateral impact-reflex search\n\n`
        + `- Frozen Policy: \`${options.policy}\`\n`
        + `- Locked Benchmark: \`${benchmark.id}\`\n`
        + `- Candidates: \`${runtimeResult.candidateCount}\`\n`
        + `- Selected candidates: \`${JSON.stringify(runtimeResult.selectedIndex)}\`\n`
        + `- Proxy assessment: \`${runtimeResult.assessment.direction}\`\n`
        + `- Demonstrations: \`${demonstrations.length}\`\n\n`
        + "This artifact may provide supervised Training data. It cannot promote a Policy or robot; only the unchanged continuous Mission Judge can do that.\n",
      );
      await writeJson(join(directory, "manifest.json"), {
        version: 1,
        kind: "mujica-impact-reflex-search",
        id,
        evaluationHash,
        demonstrationsHash,
        policy: options.policy,
        policyHash,
        benchmark: benchmark.id,
        benchmarkLockHash: lock.lockHash,
        completed: true,
      });
    });
  }
  return success(
    "policy.reflex-search",
    {
      id,
      path: target,
      cached,
      evaluation,
      demonstrations: {
        count: demonstrations.length,
        hash: demonstrationsHash,
      },
    },
    project,
    [{
      kind: "reflex-search",
      id,
      path: target,
      immutable: true,
    }],
  );
}
