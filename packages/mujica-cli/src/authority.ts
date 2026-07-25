import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  assertProgramControllerCompatible,
  atomicDirectory,
  compileAssembly,
  confined,
  hashDirectory,
  hashJson,
  loadAuthorityProfile,
  loadBenchmark,
  loadController,
  loadObjective,
  loadProject,
  loadScenario,
  loadTask,
  residualGateSchema,
  sha256,
  stableJson,
  writeJson,
  type ControllerDefinition,
} from "@mujica/core";
import { success } from "./contract";
import {
  harnessSourceHash,
  invokeRuntime,
  runtimeCompiled,
  runtimeSourceHash,
  runtimeVersion,
} from "./runtime";
import {
  diagnosticGates,
  requireBenchmarkLock,
  researchDecision,
  studioCommand,
} from "./commands";

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function violationSummary(
  objective: any,
  evaluation: any,
  baseline: any,
): { count: number; severity: number } {
  let count = 0;
  let severity = 0;
  for (let index = 0; index < evaluation.cases.length; index++) {
    const candidateCase = evaluation.cases[index];
    const baselineCase = baseline.cases[index];
    for (const gate of diagnosticGates(objective, candidateCase, baselineCase)) {
      if (!gate.enforced || gate.passed) continue;
      count++;
      severity += gate.severity;
    }
  }
  return { count, severity };
}

function counterfactualDirection(
  baseline: any,
  candidate: any,
  baselineViolations: { count: number; severity: number },
  candidateViolations: { count: number; severity: number },
  selection: { verdict: string; selectionReason: string; gateReasons: string[] },
): {
  direction: "EQUIVALENT" | "IMPROVED" | "DEGRADED" | "MIXED";
  selectionReason: string;
  gateReasons: string[];
} {
  const behavior = (evaluation: any) => evaluation.cases.map((item: any) =>
    item.behaviorHash);
  if (stableJson(behavior(baseline)) === stableJson(behavior(candidate))) {
    return {
      direction: "EQUIVALENT",
      selectionReason: "behavior-byte-equivalent",
      gateReasons: [],
    };
  }
  if (selection.verdict === "KEEP") {
    return {
      direction: "IMPROVED",
      selectionReason: selection.selectionReason,
      gateReasons: selection.gateReasons,
    };
  }
  const epsilon = 1e-9;
  const clearlyWorse = candidateViolations.count > baselineViolations.count
    || candidateViolations.severity > baselineViolations.severity + epsilon
    || (
      candidateViolations.count === baselineViolations.count
      && candidateViolations.severity >= baselineViolations.severity - epsilon
      && candidate.aggregateScore < baseline.aggregateScore - epsilon
    );
  return {
    direction: clearlyWorse ? "DEGRADED" : "MIXED",
    selectionReason: selection.selectionReason,
    gateReasons: selection.gateReasons,
  };
}

export async function loadAuthorityCounterfactual(
  projectDir: string,
  id: string,
): Promise<{ root: string; manifest: any; evaluation: any }> {
  const root = confined(projectDir, `authority-counterfactuals/${id}`);
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  const evaluation = JSON.parse(await readFile(join(root, "evaluation.json"), "utf8"));
  const evaluationHash = hashJson(evaluation);
  if (
    manifest.version !== 1
    || manifest.kind !== "mujica-authority-counterfactual"
    || manifest.id !== id
    || manifest.completed !== true
    || manifest.evaluationHash !== evaluationHash
    || id !== `authority-counterfactual-${evaluationHash.slice(0, 16)}`
  ) {
    throw new Error(`Authority Counterfactual '${id}' failed integrity verification`);
  }
  return { root, manifest, evaluation };
}

export async function authorityCounterfactualCommand(
  projectDir: string,
  options: {
    assembly: string;
    controller: string;
    policy: string;
    benchmark: string;
    profile: string;
  },
) {
  const project = await loadProject(projectDir);
  const benchmark = await loadBenchmark(project.rootDir, options.benchmark);
  const lock = await requireBenchmarkLock(project, benchmark);
  const objective = await loadObjective(project.rootDir, benchmark.objective);
  const assembly = await compileAssembly(project.rootDir, options.assembly);
  const sourceController = await loadController(project.rootDir, options.controller);
  if (sourceController.definition.kind !== "policy") {
    throw new Error("Authority Counterfactual requires a policy Controller");
  }
  const controller: ControllerDefinition = {
    ...sourceController.definition,
    policy: options.policy,
  };
  assertProgramControllerCompatible(controller, assembly);

  const policyRoot = confined(project.rootDir, `policies/${options.policy}`);
  const manifest = JSON.parse(await readFile(join(policyRoot, "manifest.json"), "utf8"));
  const architecture = JSON.parse(await readFile(join(policyRoot, "architecture.json"), "utf8"));
  const normalizerPath = join(policyRoot, "normalizer.json");
  const modelPath = join(policyRoot, "model.pt");
  const policyHash = await hashDirectory(policyRoot);
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
  if (architecture.actionTransform?.kind !== "program-controller-residual") {
    throw new Error("Authority Counterfactual requires a program-controller-residual Policy");
  }

  const candidateProfile = await loadAuthorityProfile(project.rootDir, options.profile);
  if (candidateProfile.policy !== options.policy) {
    throw new Error(
      `Authority Profile '${options.profile}' is bound to Policy '${candidateProfile.policy}', not '${options.policy}'`,
    );
  }
  const baselineGate = residualGateSchema.parse(
    architecture.actionTransform.residualGate,
  );
  const candidateGate = candidateProfile.residualGate;
  if (stableJson(baselineGate) === stableJson(candidateGate)) {
    throw new Error("Authority Profile must change the as-trained residual gate");
  }

  const frozenPolicy = {
    id: options.policy,
    policyHash,
    modelHash: sha256(await readFile(modelPath)),
    normalizerHash: sha256(await readFile(normalizerPath)),
    architectureHash: hashJson(architecture),
    observationContractHash: manifest.observationContractHash,
    actionContractHash: manifest.actionContractHash,
    trainingRun: manifest.createdByTrainingRun,
    trainingSteps: Number(manifest.budget),
  };
  const baselineProfile = {
    version: 1,
    id: "as-trained",
    name: "As-trained Policy authority",
    policy: options.policy,
    intervention: "residual-gate",
    rationale: "Frozen residual gate stored in the immutable Policy architecture.",
    residualGate: baselineGate,
  };
  const baselineProfileHash = hashJson({
    policyHash,
    profile: baselineProfile,
  });
  const candidateProfileHash = hashJson({
    policyHash,
    profile: candidateProfile,
  });
  const [sourceHash, harnessHash] = await Promise.all([
    runtimeSourceHash(),
    harnessSourceHash(),
  ]);

  const evaluate = async (
    profile: typeof baselineProfile | typeof candidateProfile,
    profileHash: string,
  ) => {
    const cases = [];
    let weighted = 0;
    let totalWeight = 0;
    const controllerHash = hashJson({
      kind: "frozen-policy-authority-counterfactual",
      policyHash,
      controller,
      profileHash,
    });
    for (const item of benchmark.cases) {
      const task = await loadTask(project.rootDir, item.task);
      const scenario = await loadScenario(project.rootDir, item.scenario);
      const result = await invokeRuntime("simulate", {
        runtimeVersion,
        runtimeSourceHash: sourceHash,
        harnessSourceHash: harnessHash,
        projectDir: project.rootDir,
        modelPath: assembly.modelPath,
        compiled: runtimeCompiled(assembly),
        controller,
        controllerRoot: sourceController.rootDir,
        controllerHash,
        trainingSteps: frozenPolicy.trainingSteps,
        task,
        scenario,
        objective,
        seed: item.seed,
        policyResidualGateOverride: profile.residualGate,
        authorityProfile: profile,
        authorityProfileHash: profileHash,
      });
      const runRoot = confined(project.rootDir, `runs/${result.runId}`);
      const behaviorHash = hashJson({
        trajectory: sha256(await readFile(join(runRoot, "trajectory.ndjson"))),
        events: sha256(await readFile(join(runRoot, "events.ndjson"))),
        metrics: sha256(await readFile(join(runRoot, "metrics.json"))),
        score: sha256(await readFile(join(runRoot, "score.json"))),
      });
      cases.push({
        case: item,
        metrics: result.metrics,
        score: result.score,
        resultHash: result.resultHash,
        runId: result.runId,
        behaviorHash,
      });
      weighted += result.score.total * item.weight;
      totalWeight += item.weight;
    }
    return {
      assembly: options.assembly,
      assemblyHash: assembly.assemblyHash,
      controller: options.controller,
      policy: options.policy,
      profile: profile.id,
      profileHash,
      aggregateScore: weighted / totalWeight,
      cases,
    };
  };

  const baseline = await evaluate(baselineProfile, baselineProfileHash);
  const candidate = await evaluate(candidateProfile, candidateProfileHash);
  const baselineViolations = violationSummary(objective, baseline, baseline);
  const candidateViolations = violationSummary(objective, candidate, baseline);
  const decision = researchDecision(
    objective,
    baseline,
    baseline,
    candidate,
    0,
  );
  const causalAssessment = counterfactualDirection(
    baseline,
    candidate,
    baselineViolations,
    candidateViolations,
    decision,
  );
  const cases = candidate.cases.map((item, index) => {
    const previous = baseline.cases[index]!;
    const gates = diagnosticGates(objective, item, previous);
    const violations = gates.filter((gate) => gate.enforced && !gate.passed);
    return {
      id: item.case.id,
      task: item.case.task,
      scenario: item.case.scenario,
      seed: item.case.seed,
      gating: item.case.gating,
      baselineRun: previous.runId,
      candidateRun: item.runId,
      baselineBehaviorHash: previous.behaviorHash,
      candidateBehaviorHash: item.behaviorHash,
      baselineScore: previous.score.total,
      candidateScore: item.score.total,
      scoreDelta: item.score.total - previous.score.total,
      baselineAuthoritySeconds: previous.metrics.policyResidualAuthoritySeconds,
      candidateAuthoritySeconds: item.metrics.policyResidualAuthoritySeconds,
      authoritySecondsDelta:
        item.metrics.policyResidualAuthoritySeconds
        - previous.metrics.policyResidualAuthoritySeconds,
      gates,
      violations,
    };
  });
  const evaluation = {
    version: 1,
    kind: "mujica-authority-counterfactual",
    project: project.manifest.id,
    benchmark: { id: benchmark.id, lockHash: lock.lockHash },
    subject: {
      assembly: options.assembly,
      assemblyHash: assembly.assemblyHash,
      executionHash: assembly.executionHash,
      modelHash: assembly.modelHash,
      plantHash: assembly.plantHash,
      controller: options.controller,
      frozenPolicy,
    },
    intervention: {
      path: "architecture.actionTransform.residualGate",
      baseline: { profile: baselineProfile, profileHash: baselineProfileHash },
      candidate: { profile: candidateProfile, profileHash: candidateProfileHash },
    },
    invariants: {
      weights: "byte-identical",
      normalizer: "byte-identical",
      architectureOutsideResidualGate: "byte-identical",
      assembly: "byte-identical",
      plant: "byte-identical",
      taskScenarioSeedPerCase: "byte-identical",
      resetPolicy: "between-cases-only",
    },
    baseline,
    candidate,
    delta: {
      aggregateScore: candidate.aggregateScore - baseline.aggregateScore,
      violationCount: candidateViolations.count - baselineViolations.count,
      violationSeverity: candidateViolations.severity - baselineViolations.severity,
      baselineViolationCount: baselineViolations.count,
      candidateViolationCount: candidateViolations.count,
      baselineViolationSeverity: baselineViolations.severity,
      candidateViolationSeverity: candidateViolations.severity,
    },
    causalAssessment: {
      ...causalAssessment,
      promotionVerdict: null,
    },
    cases,
    authorityBoundary: {
      causalClaim: "residual-gate-only",
      trainingClaim: "none",
      promotion: "locked-judge-required",
      visualInterpretation: "hypothesis-only",
    },
  };
  const evaluationHash = hashJson(evaluation);
  const id = `authority-counterfactual-${evaluationHash.slice(0, 16)}`;
  const target = confined(project.rootDir, `authority-counterfactuals/${id}`);
  let cached = false;
  if (await exists(join(target, "manifest.json"))) {
    await loadAuthorityCounterfactual(project.rootDir, id);
    cached = true;
  } else {
    await atomicDirectory(target, async (directory) => {
      await writeJson(join(directory, "evaluation.json"), evaluation);
      await writeFile(
        join(directory, "report.md"),
        `# Frozen Policy authority counterfactual\n\n`
        + `- Policy: \`${options.policy}\`\n`
        + `- Benchmark: \`${benchmark.id}\`\n`
        + `- Baseline gate: \`${baselineProfileHash.slice(0, 16)}\`\n`
        + `- Candidate gate: \`${candidateProfileHash.slice(0, 16)}\`\n`
        + `- Aggregate score delta: \`${evaluation.delta.aggregateScore.toFixed(6)}\`\n`
        + `- Violation count: \`${baselineViolations.count} → ${candidateViolations.count}\`\n`
        + `- Violation severity: \`${baselineViolations.severity.toFixed(6)} → ${candidateViolations.severity.toFixed(6)}\`\n`
        + `- Causal assessment: \`${evaluation.causalAssessment.direction}\`\n\n`
        + "This artifact changes only the Runtime-applied residual gate. It does not retrain or promote the Policy.\n",
      );
      await writeJson(join(directory, "manifest.json"), {
        version: 1,
        kind: "mujica-authority-counterfactual",
        id,
        evaluationHash,
        policy: options.policy,
        policyHash,
        benchmark: benchmark.id,
        benchmarkLockHash: lock.lockHash,
        baselineProfileHash,
        candidateProfileHash,
        completed: true,
      });
    });
  }
  const firstCase = cases[0];
  return success(
    "policy.counterfactual",
    { id, path: target, cached, evaluation },
    project,
    [{
      kind: "authority-counterfactual",
      id,
      path: target,
      immutable: true,
    }],
    firstCase ? [{
      id: "open-counterfactual-studio",
      description: `Inspect frozen-weight gate effects for '${firstCase.id}'`,
      argv: [
        "studio",
        project.rootDir,
        "--authority-counterfactual",
        id,
        "--case",
        firstCase.id,
      ],
      effect: "creates-artifact",
    }] : [],
  );
}

export async function authorityCounterfactualStudioCommand(
  projectDir: string,
  id: string,
  caseId?: string,
) {
  const project = await loadProject(projectDir);
  const artifact = await loadAuthorityCounterfactual(project.rootDir, id);
  const selected = caseId
    ? artifact.evaluation.cases.find((item: any) => item.id === caseId)
    : artifact.evaluation.cases[0];
  if (!selected) {
    throw new Error(
      caseId
        ? `Authority Counterfactual '${id}' has no case '${caseId}'`
        : `Authority Counterfactual '${id}' has no completed cases`,
    );
  }
  return await studioCommand(
    project.rootDir,
    selected.baselineRun,
    selected.candidateRun,
    undefined,
    undefined,
    {
      id,
      case: selected,
      evaluationHash: artifact.manifest.evaluationHash,
      benchmark: artifact.evaluation.benchmark,
      subject: artifact.evaluation.subject,
      intervention: artifact.evaluation.intervention,
      delta: artifact.evaluation.delta,
      causalAssessment: artifact.evaluation.causalAssessment,
      authorityBoundary: artifact.evaluation.authorityBoundary,
    },
  );
}
