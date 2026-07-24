import { cp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  atomicDirectory,
  compileAssembly,
  hashJson,
  idSchema,
  listWorkspaceProjects,
  loadBenchmark,
  loadDevelopmentCharter,
  loadObjective,
  loadProject,
  loadWorkspace,
  resolveProjectDirectory,
  validateProject,
  validateProjectDefinitions,
  writeJson,
} from "@mujica/core";
import { success } from "./contract";
import { writeWorkspaceStudioSnapshot } from "@mujica/studio";
import { controllerIdentity, diagnosticGates, diagnosticHypotheses, evaluatePair, requireBenchmarkLock } from "./commands";

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

export const PROJECT_TEMPLATES = [{
  id: "hexapod",
  name: "Six-legged walking robot",
  description: "Executable MuJoCo hexapod with a readable tripod gait, nominal capability stage, and contact evidence from six feet.",
}] as const;

async function developmentReviewIds(projectDirectory: string): Promise<string[]> {
  const root = join(projectDirectory, "development-reviews");
  if (!(await exists(root))) return [];
  const ids = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.isSymbolicLink() && entry.name.startsWith("development-review-") && await exists(join(root, entry.name, "manifest.json"))) ids.push(entry.name);
  }
  return ids.sort();
}

export async function projectListCommand(workspaceDirectory: string) {
  const workspace = await loadWorkspace(workspaceDirectory);
  const projects = [];
  for (const project of await listWorkspaceProjects(workspace.rootDir)) {
    const charter = await loadDevelopmentCharter(project.rootDir);
    projects.push({
      id: project.manifest.id,
      name: project.manifest.name,
      rootDir: project.rootDir,
      isDefault: project.isDefault,
      proposition: charter.proposition,
      northStar: charter.northStar,
      morphology: charter.morphology,
      capabilityStages: charter.capabilityStages.map((stage) => ({ id: stage.id, name: stage.name, status: stage.status })),
    });
  }
  return success("project.list", { workspace: workspace.manifest, projects, templates: PROJECT_TEMPLATES });
}

export async function projectInspectCommand(input: string, projectId?: string) {
  const projectDirectory = await resolveProjectDirectory(input, projectId);
  const project = await loadProject(projectDirectory);
  const charter = await loadDevelopmentCharter(project.rootDir);
  const validation = await validateProject(project.rootDir);
  const definitions = await validateProjectDefinitions(project.rootDir);
  const developmentReviews = await developmentReviewIds(project.rootDir);
  return success("project.inspect", {
    project: project.manifest,
    charter,
    assemblies: validation.assemblies.map((assembly) => ({
      id: assembly.id,
      morphology: assembly.morphology,
      observationSize: assembly.observationContract.size,
      actionSize: assembly.actionContract.size,
    })),
    definitions,
    developmentReviews,
  }, project);
}

function resourceAssessment(id: string, label: string, comparator: "<=" | "==", value: number, threshold: number, unit: string) {
  const margin = comparator === "<=" ? threshold - value : -Math.abs(value - threshold);
  return { id, label, comparator, value, threshold, unit, margin, passed: comparator === "<=" ? value <= threshold : value === threshold };
}

type DevelopmentBenchmarkCase = {
  id: string;
  task: string;
  scenario: string;
  seed: number;
  gating: boolean;
  score: number;
  scoreDelta: number;
  resultHash: string;
  metrics: Record<string, any>;
  gates: Array<Record<string, any>>;
  violations: Array<Record<string, any>>;
  violationSeverity: number;
  findings: Array<Record<string, any>>;
  hypotheses: Array<{ kind: "hypothesis"; surface: "controller" | "assembly" | "training"; description: string; rationale: string }>;
  reproduceArgv: string[];
};

type DevelopmentBenchmarkReview = {
  id: string;
  lockHash: string;
  objective: string;
  subject: { assembly: string; controller: string };
  baseline: { assembly: string; controller: string };
  aggregateScore: number;
  aggregateDelta: number;
  status: "PASS" | "FAIL";
  violationCount: number;
  violations: Array<Record<string, any>>;
  worstCase: string | null;
  cases: DevelopmentBenchmarkCase[];
};

export async function projectReviewCommand(input: string, options: { project?: string; assembly?: string; controller?: string }) {
  const projectDirectory = await resolveProjectDirectory(input, options.project);
  const project = await loadProject(projectDirectory);
  const charter = await loadDevelopmentCharter(project.rootDir);
  const assemblyId = options.assembly ?? project.manifest.defaults.assembly;
  const controllerId = options.controller ?? project.manifest.defaults.controller;
  const assembly = await compileAssembly(project.rootDir, assemblyId);
  const controller = await controllerIdentity(project.rootDir, controllerId);
  const constraints = charter.designConstraints;
  const design = {
    subject: {
      totalMassKg: assembly.totalMassKg,
      componentCost: assembly.componentCost,
      actionSize: assembly.actionContract.size,
      observationSize: assembly.observationContract.size,
      contactPointCount: assembly.morphology.contactPoints.length,
    },
    constraints: [
      resourceAssessment("total-mass", "Total compiled mass", "<=", assembly.totalMassKg, constraints.maximumTotalMassKg, "kg"),
      resourceAssessment("component-cost", "Component cost proxy", "<=", assembly.componentCost, constraints.maximumComponentCost, "cost"),
      resourceAssessment("action-size", "Action width", "<=", assembly.actionContract.size, constraints.maximumActionSize, "channels"),
      resourceAssessment("observation-size", "Observation width", "<=", assembly.observationContract.size, constraints.maximumObservationSize, "channels"),
      resourceAssessment("contact-points", "Declared contact points", "==", assembly.morphology.contactPoints.length, constraints.requiredContactPointCount, "points"),
    ],
  };
  const benchmarkIds = [...new Set(charter.capabilityStages.flatMap((stage) => stage.scenarios.map((witness) => witness.benchmark)))].sort();
  const benchmarkReviews: DevelopmentBenchmarkReview[] = [];
  for (const benchmarkId of benchmarkIds) {
    const benchmark = await loadBenchmark(project.rootDir, benchmarkId);
    const lock = await requireBenchmarkLock(project, benchmark);
    const objective = await loadObjective(project.rootDir, benchmark.objective);
    const baseline = await evaluatePair(project, benchmark, benchmark.baseline.assembly, benchmark.baseline.controller);
    const evaluation = assemblyId === benchmark.baseline.assembly && controllerId === benchmark.baseline.controller
      ? baseline
      : await evaluatePair(project, benchmark, assemblyId, controllerId);
    const cases = evaluation.cases.map((item, index) => {
      const gates = diagnosticGates(objective, item, baseline.cases[index]);
      const violations = gates.filter((gate) => gate.enforced && !gate.passed);
      return {
        id: item.case.id,
        task: item.case.task,
        scenario: item.case.scenario,
        seed: item.case.seed,
        gating: item.case.gating !== false,
        score: item.score.total,
        scoreDelta: item.score.total - (baseline.cases[index]?.score.total ?? item.score.total),
        resultHash: item.resultHash,
        metrics: item.metrics,
        gates,
        violations,
        violationSeverity: violations.reduce((sum, gate) => sum + gate.severity, 0),
        findings: violations.map((gate) => ({ kind: "evidence" as const, code: `gate.${gate.id}`, metric: gate.metric, value: gate.value, comparator: gate.comparator, threshold: gate.threshold, margin: gate.margin })),
        hypotheses: diagnosticHypotheses(violations),
        reproduceArgv: ["simulate", project.rootDir, "--assembly", assemblyId, "--controller", controllerId, "--task", item.case.task, "--scenario", item.case.scenario, "--objective", benchmark.objective, "--seed", String(item.case.seed)],
      };
    });
    const gatingCases = cases.filter((item) => item.gating);
    const violations = gatingCases.flatMap((item) => item.violations.map((gate) => ({ case: item.id, ...gate })));
    const ranked = [...gatingCases].sort((left, right) => right.violationSeverity - left.violationSeverity || left.scoreDelta - right.scoreDelta || left.id.localeCompare(right.id));
    benchmarkReviews.push({
      id: benchmark.id,
      lockHash: lock.lockHash,
      objective: benchmark.objective,
      subject: { assembly: assemblyId, controller: controllerId },
      baseline: benchmark.baseline,
      aggregateScore: evaluation.aggregateScore,
      aggregateDelta: evaluation.aggregateScore - baseline.aggregateScore,
      status: violations.length ? "FAIL" as const : "PASS" as const,
      violationCount: violations.length,
      violations,
      worstCase: ranked[0]?.id ?? null,
      cases,
    });
  }
  const stages = charter.capabilityStages.map((stage) => {
    const stageBenchmarkIds = [...new Set(stage.scenarios.map((witness) => witness.benchmark))];
    const reviews = stageBenchmarkIds.map((id) => benchmarkReviews.find((review) => review.id === id)!);
    const witnesses = stage.scenarios.map((witness) => {
      const review = benchmarkReviews.find((item) => item.id === witness.benchmark)!;
      const cases = review.cases.filter((item) => item.task === witness.task && item.scenario === witness.scenario);
      return { ...witness, cases: cases.map((item) => item.id), passed: cases.length > 0 && cases.every((item) => item.violations.length === 0) };
    });
    return {
      id: stage.id,
      name: stage.name,
      authoredStatus: stage.status,
      observedStatus: reviews.every((review) => review.status === "PASS") ? "PASS" as const : "FAIL" as const,
      benchmarks: reviews.map((review) => ({ id: review.id, status: review.status, lockHash: review.lockHash, violationCount: review.violationCount })),
      witnesses,
      exitCriteria: stage.exitCriteria,
    };
  });
  const designPassed = design.constraints.every((constraint) => constraint.passed);
  const northStarStage = stages.find((stage) => stage.id === charter.northStar.stage)!;
  const northStarBenchmark = benchmarkReviews.find((review) => review.id === charter.northStar.benchmark)!;
  const numericalNorthStarSatisfied = designPassed && northStarStage.observedStatus === "PASS" && northStarBenchmark.status === "PASS";
  const northStarSatisfied = numericalNorthStarSatisfied && !charter.northStar.requireHumanReview;
  const worstCases = benchmarkReviews.flatMap((review) => review.cases.filter((item) => item.gating).map((item) => ({ benchmark: review.id, ...item })))
    .filter((item) => item.violationSeverity > 0)
    .sort((left, right) => right.violationSeverity - left.violationSeverity || left.id.localeCompare(right.id));
  const interventionSurfaces = [
    ...(!designPassed ? [{ surface: "design" as const, rationale: "One or more compiled design resource constraints failed." }] : []),
    ...[...new Map(worstCases.flatMap((item) => item.hypotheses).map((hypothesis) => [hypothesis.surface, { surface: hypothesis.surface, rationale: hypothesis.rationale }])).values()],
    ...(numericalNorthStarSatisfied && charter.northStar.requireHumanReview ? [{ surface: "human-review" as const, rationale: "Numerical gates pass; inspect the authoritative replay before accepting the capability claim." }] : []),
  ];
  const review = {
    version: 1,
    kind: "mujica-development-review",
    project: project.manifest.id,
    charterHash: hashJson(charter),
    morphologyHash: hashJson(assembly.morphology),
    subject: { assembly: assemblyId, assemblyHash: assembly.assemblyHash, controller: controllerId, controllerHash: controller.hash, controllerKind: controller.definition.kind },
    design,
    benchmarks: benchmarkReviews,
    stages,
    northStar: {
      ...charter.northStar,
      satisfied: northStarSatisfied,
      numericalSatisfied: numericalNorthStarSatisfied,
      humanReviewStatus: charter.northStar.requireHumanReview ? "REQUIRED" as const : "NOT_REQUIRED" as const,
      designPassed,
      stageStatus: northStarStage.observedStatus,
      benchmarkStatus: northStarBenchmark.status,
    },
    summary: {
      status: northStarSatisfied
        ? "NORTH_STAR_SATISFIED" as const
        : numericalNorthStarSatisfied && charter.northStar.requireHumanReview
          ? "HUMAN_REVIEW_REQUIRED" as const
          : "DEVELOPMENT_REQUIRED" as const,
      designPassed,
      passedStages: stages.filter((stage) => stage.observedStatus === "PASS").length,
      totalStages: stages.length,
      violationCount: benchmarkReviews.reduce((sum, review) => sum + review.violationCount, 0),
      worstCase: worstCases[0] ? { benchmark: worstCases[0].benchmark, case: worstCases[0].id, severity: worstCases[0].violationSeverity } : null,
      interventionSurfaces,
    },
  };
  const reviewHash = hashJson(review);
  const id = `development-review-${reviewHash.slice(0, 16)}`;
  const target = join(project.rootDir, "development-reviews", id);
  if (!(await exists(join(target, "manifest.json")))) await atomicDirectory(target, async (directory) => {
    await writeJson(join(directory, "review.json"), review);
    await writeJson(join(directory, "manifest.json"), {
      version: 1,
      id,
      kind: review.kind,
      project: project.manifest.id,
      reviewHash,
      charterHash: review.charterHash,
      subject: review.subject,
      status: review.summary.status,
      northStarSatisfied,
      completed: true,
    });
    const stageLines = stages.map((stage) => `- ${stage.observedStatus}: ${stage.id} (${stage.benchmarks.map((benchmark) => benchmark.id).join(", ")})`).join("\n");
    const constraintLines = design.constraints.map((constraint) => `- ${constraint.passed ? "PASS" : "FAIL"}: ${constraint.label} ${constraint.value} ${constraint.comparator} ${constraint.threshold} ${constraint.unit}`).join("\n");
    await writeFile(join(directory, "report.md"), `# Development Review ${id}\n\nNorth star: **${review.summary.status}**\n\n## Design envelope\n\n${constraintLines}\n\n## Capability stages\n\n${stageLines}\n`);
  });
  await writeJson(join(project.rootDir, "development-reviews", "current.json"), { version: 1, id, reviewHash });
  const nextActions = [];
  if (!designPassed) nextActions.push({ id: "inspect-assembly", description: "Inspect the compiled Assembly and resource inventory before changing behavior", argv: ["assembly", "inspect", project.rootDir, "--assembly", assemblyId], effect: "read-only" as const });
  if (worstCases[0]) {
    nextActions.push({ id: "diagnose-worst-benchmark", description: `Diagnose the worst locked case '${worstCases[0].id}'`, argv: ["diagnose", project.rootDir, "--assembly", assemblyId, "--controller", controllerId, "--benchmark", worstCases[0].benchmark], effect: "read-only" as const });
    nextActions.push({ id: "reproduce-worst-case", description: "Persist the worst case for trajectory and visual inspection", argv: worstCases[0].reproduceArgv, effect: "creates-artifact" as const });
  }
  nextActions.push({ id: "open-studio", description: "Project this Review beside the authoritative robot replay", argv: ["studio", project.rootDir], effect: "creates-artifact" as const });
  return success("project.review", { id, reviewHash, path: target, review }, project, [{ kind: "development-review", id, path: target, immutable: true }], nextActions);
}

async function copyTemplate(templateRoot: string, destination: string): Promise<void> {
  for (const entry of await readdir(templateRoot, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error(`Project template contains a symlink: ${entry.name}`);
    await cp(join(templateRoot, entry.name), join(destination, entry.name), { recursive: true });
  }
}

export async function projectCreateCommand(workspaceDirectory: string, input: { id: string; name: string; template: string }) {
  const id = idSchema.parse(input.id);
  const name = input.name.trim();
  if (!name) throw new Error("Project name must not be empty");
  const template = PROJECT_TEMPLATES.find((item) => item.id === input.template);
  if (!template) throw new Error(`Unknown project template '${input.template}'`);
  const workspace = await loadWorkspace(workspaceDirectory);
  const target = join(workspace.projectsDir, id);
  if (await exists(target)) throw new Error(`Workspace project '${id}' already exists`);
  const templateRoot = resolve(import.meta.dir, "..", "templates", template.id);
  if (!(await exists(join(templateRoot, "mujica.json")))) throw new Error(`Project template '${template.id}' is unavailable`);
  await atomicDirectory(target, async (temporary) => {
    await copyTemplate(templateRoot, temporary);
    for (const filename of ["mujica.json", "development-charter.json", "morphology.json"]) {
      const path = join(temporary, filename);
      const rendered = (await readFile(path, "utf8"))
        .replaceAll("__PROJECT_ID__", id)
        .replaceAll("__PROJECT_NAME__", name);
      await writeFile(path, rendered);
    }
    await validateProject(temporary);
    await validateProjectDefinitions(temporary);
  });
  const project = await loadProject(target);
  const charter = await loadDevelopmentCharter(target);
  return success("project.create", {
    project: project.manifest,
    charter,
    template: template.id,
    path: target,
  }, project, [], [
    { id: "benchmark.lock", description: "Freeze the starter capability benchmark before evaluation", argv: ["benchmark", "lock", target, "--benchmark", project.manifest.defaults.benchmark], effect: "mutates-project" },
    { id: "simulate", description: "Run the starter scenario", argv: ["simulate", target, "--assembly", project.manifest.defaults.assembly, "--controller", project.manifest.defaults.controller, "--task", project.manifest.defaults.task, "--scenario", project.manifest.defaults.scenario], effect: "creates-artifact" },
    { id: "studio.workspace", description: "Regenerate the Workspace Studio to include the project", argv: ["studio", workspace.rootDir], effect: "creates-artifact" },
  ]);
}

export async function workspaceStudioCommand(workspaceDirectory: string) {
  const workspace = await loadWorkspace(workspaceDirectory);
  const result = await writeWorkspaceStudioSnapshot(workspace.rootDir);
  return success("studio", {
    id: result.id,
    workspace: workspace.manifest,
    projects: result.snapshot.projects.map((project) => ({ id: project.id, name: project.name, studio: project.studio?.id ?? null })),
    indexPath: result.indexPath,
  }, undefined, [{ kind: "workspace-studio-snapshot", id: result.id, path: result.path, immutable: false }]);
}
