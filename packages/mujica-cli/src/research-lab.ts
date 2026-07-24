import { appendFile, cp, lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import {
  assertProgramControllerCompatible,
  atomicDirectory,
  compileAssembly,
  confined,
  hashDirectory,
  hashJson,
  listResearchLabIds,
  loadBenchmark,
  loadCandidate,
  loadController,
  loadObjective,
  loadProject,
  loadResearchLab,
  loadTrainer,
  loadTraining,
  researchBriefSchema,
  researchLabProposalSchema,
  researchReviewSchema,
  sha256,
  writeJson,
  type BenchmarkDefinition,
  type ControllerDefinition,
  type ProjectContext,
  type ResearchLabDefinition,
  type ResearchLabProposal,
  type ResearchBrief,
  type ResearchReview,
} from "@mujica/core";
import { candidateCommand, evaluatePair, executeTraining, requireBenchmarkLock, researchDecision, researchGateReasons, simulateCommand, studioCommand } from "./commands";
import { success, type Artifact } from "./contract";
import { verifyHumanObservation } from "./evidence";

const GENERATED_ROOTS = new Set([
  ".mujica", "runs", "training-runs", "research-runs", "training-research-runs",
  "revisions", "policy-revisions", "hardware-bundles", "hardware-verifications",
  "human-observations", "research-briefs",
]);
const SOURCE_ARTIFACT_ROOTS = new Set([...GENERATED_ROOTS, "policies"]);

type Evaluation = Awaited<ReturnType<typeof evaluatePair>>;
type SourceHashes = Record<string, string>;
type ResearchDecision = ReturnType<typeof researchDecision>;

export function selectResearchReviewCase(
  benchmark: BenchmarkDefinition,
  previous: Evaluation,
  candidate: Evaluation,
  decision: ResearchDecision,
) {
  const evaluated = benchmark.cases.map((definition) => {
    const accepted = previous.cases.find((item) => item.case.id === definition.id);
    const proposed = candidate.cases.find((item) => item.case.id === definition.id);
    if (!accepted || !proposed) throw new Error(`Research Review case '${definition.id}' is missing from the locked evaluation`);
    const candidateScoreDelta = proposed.score.total - accepted.score.total;
    return {
      definition,
      accepted,
      candidate: proposed,
      candidateScoreDelta,
      weightedScoreDelta: candidateScoreDelta * definition.weight,
    };
  });
  if (!evaluated.length) throw new Error(`Benchmark '${benchmark.id}' has no Research Review cases`);
  const gateCase = evaluated.find((item) => decision.gateReasons.some((reason) => reason.startsWith(`${item.definition.id}:`)));
  if (gateCase) {
    return {
      ...gateCase,
      selectionPolicy: "first-primary-gate-regression" as const,
      selectionReason: `First primary gate regression named by the locked Judge: ${decision.gateReasons.find((reason) => reason.startsWith(`${gateCase.definition.id}:`))}`,
    };
  }
  const ranked = evaluated
    .map((item, index) => ({ ...item, index }))
    .sort((left, right) => Math.abs(right.weightedScoreDelta) - Math.abs(left.weightedScoreDelta) || left.index - right.index);
  const selected = ranked[0]!;
  if (Math.abs(selected.weightedScoreDelta) > 1e-12) {
    return {
      ...selected,
      selectionPolicy: "largest-absolute-weighted-score-delta" as const,
      selectionReason: "Largest absolute primary-case score contribution change between the accepted state and candidate.",
    };
  }
  return {
    ...selected,
    selectionPolicy: "first-primary-case" as const,
    selectionReason: "All primary-case score deltas are equal; selected the first locked Benchmark case.",
  };
}

function artifact(kind: Artifact["kind"], id: string, path: string, immutable = true): Artifact {
  return { kind, id, path, immutable };
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

async function importImmutableSimulationRun(projectRoot: string, result: Record<string, any>): Promise<string> {
  const source = resolve(String(result.artifactPath));
  const sourceStat = await lstat(source);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) throw new Error(`Research Review Run '${result.runId}' is not a real artifact directory`);
  const target = confined(projectRoot, `runs/${result.runId}`);
  const sourceHash = await hashDirectory(source);
  if (resolve(target) !== source) {
    if (await exists(target)) {
      if (await hashDirectory(target) !== sourceHash) throw new Error(`Research Review Run '${result.runId}' conflicts with an existing immutable Run`);
    } else {
      await atomicDirectory(target, async (directory) => {
        for (const entry of await readdir(source, { withFileTypes: true })) {
          if (entry.isSymbolicLink()) throw new Error(`Research Review Run '${result.runId}' contains a symlink`);
          await cp(join(source, entry.name), join(directory, entry.name), { recursive: true });
        }
      });
    }
  }
  if (await hashDirectory(target) !== sourceHash) throw new Error(`Research Review Run '${result.runId}' failed immutable import verification`);
  return target;
}

async function researchReviewRunReference(
  projectRoot: string,
  result: Record<string, any>,
  role: "accepted" | "candidate",
  assembly: string,
  controller: string,
  expectedResultHash: string,
  expectedScore: number,
) {
  if (result.resultHash !== expectedResultHash) throw new Error(`Research Review ${role} Run differs from the locked evaluation result`);
  const root = await importImmutableSimulationRun(projectRoot, result);
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  const metrics = JSON.parse(await readFile(join(root, "metrics.json"), "utf8"));
  const score = JSON.parse(await readFile(join(root, "score.json"), "utf8"));
  if (
    manifest.completed !== true
    || manifest.id !== result.runId
    || manifest.runKey !== result.runKey
    || manifest.resultHash !== result.resultHash
    || Math.abs(Number(score.total) - expectedScore) > 1e-9
  ) throw new Error(`Research Review ${role} Run '${result.runId}' failed identity verification`);
  return {
    role,
    id: String(result.runId),
    runKey: String(result.runKey),
    resultHash: String(result.resultHash),
    artifactHash: await hashDirectory(root),
    manifestHash: hashJson(manifest),
    metricsHash: hashJson(metrics),
    scoreHash: hashJson(score),
    assembly,
    controller,
    score: Number(score.total),
  };
}

async function captureResearchReview(options: {
  project: ProjectContext;
  stagedProject: ProjectContext;
  lab: ResearchLabDefinition;
  benchmark: BenchmarkDefinition;
  previous: Evaluation;
  candidate: Evaluation;
  previousSubject: { assembly: string; controller: string };
  candidateSubject: { assembly: string; controller: string };
  decision: ResearchDecision;
  proposal: ResearchLabProposal;
  experimentId: string;
  experimentHash: string;
  sessionId: string;
  labHash: string;
  programHash: string;
  benchmarkLockHash: string;
  researchBrief: Awaited<ReturnType<typeof verifyResearchBrief>> | null;
}): Promise<ResearchReview> {
  const selected = selectResearchReviewCase(options.benchmark, options.previous, options.candidate, options.decision);
  const simulation = {
    task: selected.definition.task,
    scenario: selected.definition.scenario,
    objective: options.benchmark.objective,
    seed: selected.definition.seed,
  };
  const acceptedEnvelope = await simulateCommand(options.project.rootDir, {
    assembly: options.previousSubject.assembly,
    controller: options.previousSubject.controller,
    ...simulation,
  });
  const candidateEnvelope = await simulateCommand(options.stagedProject.rootDir, {
    assembly: options.candidateSubject.assembly,
    controller: options.candidateSubject.controller,
    ...simulation,
  });
  const accepted = await researchReviewRunReference(
    options.project.rootDir,
    acceptedEnvelope.data,
    "accepted",
    options.previousSubject.assembly,
    options.previousSubject.controller,
    selected.accepted.resultHash,
    selected.accepted.score.total,
  );
  const candidate = await researchReviewRunReference(
    options.project.rootDir,
    candidateEnvelope.data,
    "candidate",
    options.candidateSubject.assembly,
    options.candidateSubject.controller,
    selected.candidate.resultHash,
    selected.candidate.score.total,
  );
  return researchReviewSchema.parse({
    version: 1,
    kind: "mujica-research-review",
    authority: "derived-human-review",
    claimKind: "visual-witness",
    lineage: {
      researchId: options.lab.id,
      labHash: options.labHash,
      programHash: options.programHash,
      benchmarkLockHash: options.benchmarkLockHash,
      researchBriefId: options.researchBrief?.id ?? null,
      researchBriefHash: options.researchBrief?.briefHash ?? null,
      observationIds: options.researchBrief?.brief.observations.map((item) => item.id) ?? [],
      sessionId: options.sessionId,
      experimentId: options.experimentId,
      experimentHash: options.experimentHash,
    },
    proposal: options.proposal,
    judge: {
      verdict: options.decision.verdict,
      decision: options.decision,
      decisionHash: hashJson(options.decision),
    },
    selectedCase: {
      benchmark: options.benchmark.id,
      id: selected.definition.id,
      task: selected.definition.task,
      scenario: selected.definition.scenario,
      seed: selected.definition.seed,
      weight: selected.definition.weight,
      gating: selected.definition.gating,
      selectionPolicy: selected.selectionPolicy,
      selectionReason: selected.selectionReason,
      candidateScoreDelta: selected.candidateScoreDelta,
      weightedScoreDelta: selected.weightedScoreDelta,
    },
    accepted,
    candidate,
    authorityBoundary: {
      visualInterpretation: "hypothesis-only",
      simulationEvidence: "immutable-runs",
      experimentDecision: "locked-judge",
      sourcePromotion: "verdict-governed",
    },
  });
}

async function researchLabBinding(projectRoot: string, id: string) {
  const lab = await loadResearchLab(projectRoot, id);
  const program = await readFile(confined(projectRoot, lab.program), "utf8");
  const benchmark = await loadBenchmark(projectRoot, lab.benchmark);
  const project = await loadProject(projectRoot);
  const lock = await requireBenchmarkLock(project, benchmark);
  return {
    lab,
    program,
    benchmark,
    labHash: hashJson(lab),
    programHash: sha256(program),
    benchmarkLockHash: lock.lockHash,
  };
}

function briefObservation(observation: Awaited<ReturnType<typeof verifyHumanObservation>>) {
  return {
    id: observation.manifest.id,
    observationHash: observation.manifest.observationHash,
    contextHash: observation.manifest.contextHash,
    draftHash: observation.manifest.draftHash,
    observer: observation.manifest.observer,
    recordedAt: observation.manifest.recordedAt,
    source: observation.manifest.source,
    assessment: observation.manifest.assessment,
    context: observation.context,
  };
}

export async function verifyResearchBrief(projectRoot: string, id: string) {
  const root = confined(projectRoot, `research-briefs/${id}`);
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error(`Research Brief '${id}' must be a real artifact directory`);
  const brief = researchBriefSchema.parse(JSON.parse(await readFile(join(root, "brief.json"), "utf8")));
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  const briefHash = hashJson(brief);
  const identity = {
    version: manifest.version,
    kind: manifest.kind,
    id: manifest.id,
    briefHash: manifest.briefHash,
    labId: manifest.labId,
    labHash: manifest.labHash,
    programHash: manifest.programHash,
    benchmarkLockHash: manifest.benchmarkLockHash,
    observationIds: manifest.observationIds,
    observationHashes: manifest.observationHashes,
    completed: manifest.completed,
  };
  if (
    manifest.version !== 1
    || manifest.kind !== "mujica-research-brief-artifact"
    || manifest.completed !== true
    || briefHash !== manifest.briefHash
    || id !== manifest.id
    || id !== `brief-${briefHash.slice(0, 16)}`
    || manifest.manifestHash !== hashJson(identity)
    || brief.lab.labHash !== hashJson(brief.lab.definition)
    || brief.lab.definition.id !== manifest.labId
    || brief.lab.labHash !== manifest.labHash
    || brief.lab.programHash !== manifest.programHash
    || brief.lab.benchmarkLockHash !== manifest.benchmarkLockHash
    || hashJson(brief.observations.map((item) => item.id)) !== hashJson(manifest.observationIds)
    || hashJson(brief.observations.map((item) => item.observationHash)) !== hashJson(manifest.observationHashes)
  ) throw new Error(`Research Brief '${id}' has invalid identity`);
  for (const item of brief.observations) {
    const observation = await verifyHumanObservation(confined(projectRoot, `human-observations/${item.id}`));
    if (hashJson(briefObservation(observation)) !== hashJson(item)) {
      throw new Error(`Research Brief '${id}' observation '${item.id}' differs from its immutable artifact`);
    }
  }
  return { id, briefHash, path: root, manifest, brief };
}

async function assertResearchBriefForBinding(
  projectRoot: string,
  briefId: string,
  binding: Awaited<ReturnType<typeof researchLabBinding>>,
) {
  const verified = await verifyResearchBrief(projectRoot, briefId);
  if (
    verified.brief.lab.definition.id !== binding.lab.id
    || verified.brief.lab.labHash !== binding.labHash
    || verified.brief.lab.programHash !== binding.programHash
    || verified.brief.lab.benchmarkLockHash !== binding.benchmarkLockHash
  ) {
    throw new Error(`Research Brief '${briefId}' is stale or belongs to another Research Lab`);
  }
  return verified;
}

function excluded(relativePath: string, sourceOnly: boolean): boolean {
  if (!relativePath) return false;
  const first = relativePath.split("/")[0]!;
  return (sourceOnly ? SOURCE_ARTIFACT_ROOTS : GENERATED_ROOTS).has(first);
}

async function snapshotFiles(root: string, sourceOnly: boolean): Promise<SourceHashes> {
  const hashes: SourceHashes = {};
  async function walk(directory: string, prefix: string): Promise<void> {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.name === ".DS_Store" || entry.name === "__pycache__") continue;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (excluded(path, sourceOnly)) continue;
      const absolute = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Research project contains unsupported symlink '${path}'`);
      if (entry.isDirectory()) await walk(absolute, path);
      else if (entry.isFile()) hashes[path] = sha256(await readFile(absolute));
    }
  }
  await walk(root, "");
  return hashes;
}

function changedPaths(before: SourceHashes, after: SourceHashes): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((path) => before[path] !== after[path]).sort();
}

export function researchPathIsEditable(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (!pattern.endsWith("/**")) return path === pattern;
    const root = pattern.slice(0, -3);
    return path === root || path.startsWith(`${root}/`);
  });
}

export function assertResearchLabEditableChanges(lab: ResearchLabDefinition, paths: string[]): void {
  const escaped = paths.filter((path) => !researchPathIsEditable(path, lab.editable.paths));
  if (escaped.length) throw new Error(`Researcher changed files outside the declared source closure: ${escaped.join(", ")}`);
  if (!paths.length) throw new Error("Researcher produced no source changes");
}

export function policyReferenceGateReasons(referenceDecision: ReturnType<typeof researchDecision> | null, regressionGateReasons: string[]): string[] {
  if (!referenceDecision || referenceDecision.verdict === "KEEP") return [...regressionGateReasons];
  const primary = referenceDecision.gateReasons.length
    ? referenceDecision.gateReasons.map((reason) => `reference-controller: ${reason}`)
    : [`reference-controller: ${referenceDecision.selectionReason}`];
  return [...primary, ...regressionGateReasons];
}

async function copyProject(source: string, destination: string): Promise<void> {
  await cp(source, destination, {
    recursive: true,
    filter: (path) => {
      const rel = relative(source, path).split("\\").join("/");
      return !excluded(rel, false);
    },
  });
}

async function materializeEditableSnapshot(root: string, destination: string, lab: ResearchLabDefinition): Promise<SourceHashes> {
  const hashes = await snapshotFiles(root, true); const selected: SourceHashes = {};
  for (const [path, hash] of Object.entries(hashes)) {
    if (!researchPathIsEditable(path, lab.editable.paths)) continue;
    selected[path] = hash; const target = join(destination, path); await mkdir(dirname(target), { recursive: true }); await cp(confined(root, path), target);
  }
  return selected;
}

async function sourcePatch(beforeRoot: string, afterRoot: string): Promise<string> {
  const child = Bun.spawnSync(["git", "diff", "--no-index", "--binary", "--", "before", "after"], { cwd: dirname(beforeRoot), stdout: "pipe", stderr: "pipe" });
  if (child.exitCode !== 0 && child.exitCode !== 1) throw new Error(`Unable to create source patch: ${child.stderr.toString().trim()}`);
  return child.stdout.toString();
}

async function invokeResearcher(command: string, cwd: string, input: unknown, timeoutMs: number): Promise<{ proposal: ResearchLabProposal; stderr: string; durationMs: number }> {
  const started = Date.now(); let timedOut = false;
  const child = Bun.spawn(["/bin/sh", "-lc", command], { cwd, stdin: new Blob([JSON.stringify(input)]), stdout: "pipe", stderr: "pipe" });
  const stdoutPromise = new Response(child.stdout).text(); const stderrPromise = new Response(child.stderr).text();
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, Math.max(1, timeoutMs));
  const [exitCode, stdout, stderr] = await Promise.all([child.exited, stdoutPromise, stderrPromise]); clearTimeout(timer);
  if (timedOut) throw new Error(`Researcher exceeded the ${Math.ceil(timeoutMs / 1000)} second remaining wall-clock budget`);
  if (exitCode !== 0) throw new Error(`Researcher command failed with exit ${exitCode}${stderr.trim() ? `: ${stderr.trim()}` : ""}`);
  let inputProposal: unknown;
  try { inputProposal = JSON.parse(stdout.trim()); }
  catch { throw new Error(`Researcher returned invalid JSON: ${stdout.trim().slice(0, 500)}`); }
  return { proposal: researchLabProposalSchema.parse(inputProposal), stderr, durationMs: Date.now() - started };
}

async function importImmutableDirectory(source: string, target: string): Promise<void> {
  if (await exists(target)) {
    if (await hashDirectory(source) !== await hashDirectory(target)) throw new Error(`Immutable artifact collision at ${target}`);
    return;
  }
  await atomicDirectory(target, async (temporary) => { await cp(source, temporary, { recursive: true }); });
}

export function trainingRunStableResultIdentity(value: any): unknown {
  return {
    trainingRunId: value.trainingRunId,
    policyId: value.policyId,
    modelHash: value.modelHash,
    trainingMetrics: value.trainingMetrics,
  };
}

async function importTrainingArtifacts(stagedRoot: string, projectRoot: string, result: any): Promise<{ trainingRunPath: string; policyPath: string }> {
  const trainingRunPath = confined(projectRoot, `training-runs/${result.trainingRunId}`); const policyPath = confined(projectRoot, `policies/${result.policyId}`);
  const stagedRun = confined(stagedRoot, `training-runs/${result.trainingRunId}`); const stagedPolicy = confined(stagedRoot, `policies/${result.policyId}`);
  await importImmutableDirectory(stagedPolicy, policyPath);
  if (await exists(trainingRunPath)) {
    const [stagedManifest, existingManifest, stagedResult, existingResult] = await Promise.all([
      readFile(join(stagedRun, "manifest.json"), "utf8").then(JSON.parse),
      readFile(join(trainingRunPath, "manifest.json"), "utf8").then(JSON.parse),
      readFile(join(stagedRun, "result.json"), "utf8").then(JSON.parse),
      readFile(join(trainingRunPath, "result.json"), "utf8").then(JSON.parse),
    ]);
    if (hashJson(stagedManifest) !== hashJson(existingManifest) || hashJson(trainingRunStableResultIdentity(stagedResult)) !== hashJson(trainingRunStableResultIdentity(existingResult))) {
      throw new Error(`Immutable Training Run identity collision at ${trainingRunPath}`);
    }
  } else {
    await importImmutableDirectory(stagedRun, trainingRunPath);
  }
  return { trainingRunPath, policyPath };
}

async function applySourceTransaction(projectRoot: string, stagedRoot: string, before: SourceHashes, after: SourceHashes, paths: string[]): Promise<() => Promise<void>> {
  const current = await snapshotFiles(projectRoot, true);
  for (const path of paths) if (current[path] !== before[path]) throw new Error(`Research KEEP is stale because '${path}' changed during evaluation`);
  const backups = new Map<string, Buffer | null>();
  for (const path of paths) backups.set(path, await exists(confined(projectRoot, path)) ? await readFile(confined(projectRoot, path)) : null);
  const restore = async () => {
    for (const [path, bytes] of backups) {
      const target = confined(projectRoot, path);
      if (bytes === null) await rm(target, { force: true });
      else { await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes); }
    }
  };
  try {
    for (const path of paths) {
      const target = confined(projectRoot, path);
      if (after[path] === undefined) { await rm(target, { force: true }); continue; }
      const source = confined(stagedRoot, path); const temporary = `${target}.research-${process.pid}-${Date.now()}`;
      await mkdir(dirname(target), { recursive: true }); await writeFile(temporary, await readFile(source)); await rename(temporary, target);
    }
  } catch (error) {
    await restore();
    throw error;
  }
  return restore;
}

async function latestRevision(projectRoot: string): Promise<string | null> {
  const root = join(projectRoot, "revisions"); if (!(await exists(root))) return null; const manifests: any[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) if (entry.isDirectory() && await exists(join(root, entry.name, "manifest.json"))) manifests.push(JSON.parse(await readFile(join(root, entry.name, "manifest.json"), "utf8")));
  manifests.sort((left, right) => String(left.appliedAt).localeCompare(String(right.appliedAt)) || String(left.id).localeCompare(String(right.id)));
  return manifests.at(-1)?.id ?? null;
}

async function latestPolicyRevision(projectRoot: string, researchId: string): Promise<string | null> {
  const root = join(projectRoot, "policy-revisions"); if (!(await exists(root))) return null; const manifests: any[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !(await exists(join(root, entry.name, "manifest.json")))) continue;
    const manifest = JSON.parse(await readFile(join(root, entry.name, "manifest.json"), "utf8")); if (manifest.researchId === researchId) manifests.push(manifest);
  }
  manifests.sort((left, right) => String(left.appliedAt).localeCompare(String(right.appliedAt)) || String(left.id).localeCompare(String(right.id)));
  return manifests.at(-1)?.id ?? null;
}

async function labSourceClosure(projectRoot: string, lab: ResearchLabDefinition, benchmark: BenchmarkDefinition): Promise<string[]> {
  const source = await snapshotFiles(projectRoot, true); const editable = Object.keys(source).filter((path) => researchPathIsEditable(path, lab.editable.paths));
  const closure = new Set<string>([...editable, `research/${lab.id}/research.json`, lab.program, `benchmarks/${benchmark.id}.benchmark.json`, `benchmarks/${benchmark.id}.lock.json`, `objectives/${benchmark.objective}.objective.json`]);
  for (const item of benchmark.cases) { closure.add(`tasks/${item.task}.task.json`); closure.add(`scenarios/${item.scenario}.scenario.json`); }
  for (const regressionId of lab.regressions) {
    const regression = await loadBenchmark(projectRoot, regressionId); closure.add(`benchmarks/${regression.id}.benchmark.json`); closure.add(`benchmarks/${regression.id}.lock.json`); closure.add(`objectives/${regression.objective}.objective.json`);
    for (const item of regression.cases) { closure.add(`tasks/${item.task}.task.json`); closure.add(`scenarios/${item.scenario}.scenario.json`); }
  }
  return [...closure].sort();
}

async function publishControllerRevision(options: {
  project: ProjectContext; lab: ResearchLabDefinition; benchmark: BenchmarkDefinition; lockHash: string; experimentId: string; experimentHash: string;
  proposal: ResearchLabProposal; previous: Evaluation; candidate: Evaluation; decision: ReturnType<typeof researchDecision>;
}): Promise<{ id: string; path: string }> {
  if (options.lab.execution.kind !== "controller") throw new Error("Controller Revision publisher received a non-controller Lab");
  const parent = await latestRevision(options.project.rootDir); const assembly = await compileAssembly(options.project.rootDir, options.lab.execution.assembly); const controller = await loadController(options.project.rootDir, options.lab.execution.controller);
  assertProgramControllerCompatible(controller.definition, assembly); const controllerHash = await hashDirectory(controller.rootDir);
  const revisionHash = hashJson({ parent, lab: options.lab.id, experimentHash: options.experimentHash, assemblyHash: assembly.assemblyHash, controllerHash, results: options.candidate.cases.map((item) => item.resultHash) });
  const id = `${options.project.manifest.id}-r-${revisionHash.slice(0, 12)}`; const target = join(options.project.rootDir, "revisions", id);
  const sourceClosure = [...new Set([...assembly.sourceFiles, ...await labSourceClosure(options.project.rootDir, options.lab, options.benchmark)])].sort();
  await atomicDirectory(target, async (directory) => {
    for (const path of sourceClosure) { const destination = join(directory, "sources", path); await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, await readFile(confined(options.project.rootDir, path))); }
    const compiled = join(directory, "compiled"); await mkdir(compiled, { recursive: true });
    for (const name of ["model.xml", "observation-contract.json", "action-contract.json", "compiled-assembly.json"]) await writeFile(join(compiled, name), await readFile(join(assembly.artifactDir, name)));
    await writeJson(join(directory, "evaluation.json"), { proposal: options.proposal, previous: options.previous, candidate: options.candidate, decision: options.decision });
    await writeJson(join(directory, "manifest.json"), {
      version: 1, id, kind: "research-lab-controller", parent, researchId: options.lab.id, experimentId: options.experimentId, experimentHash: options.experimentHash,
      benchmarkId: options.benchmark.id, benchmarkLockHash: options.lockHash, assembly: assembly.id, assemblyHash: assembly.assemblyHash,
      controller: controller.definition.id, controllerHash, aggregateScore: options.candidate.aggregateScore,
      scoreDelta: options.candidate.aggregateScore - options.previous.aggregateScore, selectionReason: options.decision.selectionReason, sourceClosure, appliedAt: new Date().toISOString(),
    });
  });
  return { id, path: target };
}

async function publishPolicyRevision(options: {
  project: ProjectContext; lab: ResearchLabDefinition; benchmark: BenchmarkDefinition; lockHash: string; experimentId: string; experimentHash: string;
  proposal: ResearchLabProposal; previous: Evaluation; candidate: Evaluation; decision: ReturnType<typeof researchDecision>; policyId: string;
}): Promise<{ id: string; path: string }> {
  const execution = options.lab.execution; if (execution.kind !== "policy") throw new Error("Policy Revision publisher received a non-policy Lab");
  const training = await loadTraining(options.project.rootDir, execution.training); const assembly = await compileAssembly(options.project.rootDir, training.assembly); const policyPath = confined(options.project.rootDir, `policies/${options.policyId}`); const policyHash = await hashDirectory(policyPath);
  const parent = await latestPolicyRevision(options.project.rootDir, options.lab.id);
  const revisionHash = hashJson({ parent, lab: options.lab.id, experimentHash: options.experimentHash, training, policyHash, results: options.candidate.cases.map((item) => item.resultHash) });
  const id = `${options.project.manifest.id}-p-${revisionHash.slice(0, 12)}`; const target = join(options.project.rootDir, "policy-revisions", id); const sourceClosure = [...new Set([...assembly.sourceFiles, ...await labSourceClosure(options.project.rootDir, options.lab, options.benchmark)])].sort();
  await atomicDirectory(target, async (directory) => {
    for (const path of sourceClosure) { const destination = join(directory, "sources", path); await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, await readFile(confined(options.project.rootDir, path))); }
    await cp(policyPath, join(directory, "policy"), { recursive: true }); const compiled = join(directory, "compiled"); await mkdir(compiled, { recursive: true });
    for (const name of ["model.xml", "observation-contract.json", "action-contract.json", "compiled-assembly.json"]) await writeFile(join(compiled, name), await readFile(join(assembly.artifactDir, name)));
    await writeJson(join(directory, "evaluation.json"), { proposal: options.proposal, previous: options.previous, candidate: options.candidate, decision: options.decision });
    await writeJson(join(directory, "manifest.json"), {
      version: 1, id, kind: "research-lab-policy", parent, researchId: options.lab.id, experimentId: options.experimentId, experimentHash: options.experimentHash,
      benchmarkId: options.benchmark.id, benchmarkLockHash: options.lockHash, assembly: training.assembly, assemblyHash: assembly.assemblyHash,
      controller: execution.controller, policyId: options.policyId, policyHash, trainingHash: hashJson(training),
      aggregateScore: options.candidate.aggregateScore, scoreDelta: options.candidate.aggregateScore - options.previous.aggregateScore,
      selectionReason: options.decision.selectionReason, sourceClosure, appliedAt: new Date().toISOString(),
    });
  });
  return { id, path: target };
}

async function currentPrimary(project: ProjectContext, lab: ResearchLabDefinition, benchmark: BenchmarkDefinition): Promise<{ lockedBaseline: Evaluation; current: Evaluation; subject: { assembly: string; controller: string } }> {
  if (lab.execution.kind === "development") {
    const envelope = await candidateCommand(project.rootDir, lab.execution.candidate, false); const data: any = envelope.data;
    return { lockedBaseline: data.baseline, current: data.proposed, subject: { assembly: data.candidate.proposed.assembly, controller: data.candidate.proposed.controller } };
  }
  const subject = lab.execution.kind === "controller"
    ? { assembly: lab.execution.assembly, controller: lab.execution.controller }
    : { assembly: (await loadTraining(project.rootDir, lab.execution.training)).assembly, controller: lab.execution.controller };
  return {
    lockedBaseline: await evaluatePair(project, benchmark, benchmark.baseline.assembly, benchmark.baseline.controller),
    current: await evaluatePair(project, benchmark, subject.assembly, subject.controller),
    subject,
  };
}

async function assertStagedBenchmarkInputsUnedited(originalProject: ProjectContext, stagedProject: ProjectContext, benchmark: BenchmarkDefinition): Promise<void> {
  const stagedBenchmark = await loadBenchmark(stagedProject.rootDir, benchmark.id);
  const [originalLock, stagedLock] = await Promise.all([
    readFile(confined(originalProject.rootDir, `benchmarks/${benchmark.id}.lock.json`), "utf8").then(JSON.parse),
    readFile(confined(stagedProject.rootDir, `benchmarks/${benchmark.id}.lock.json`), "utf8").then(JSON.parse),
  ]);
  if (hashJson(stagedBenchmark) !== hashJson(benchmark) || hashJson(stagedLock) !== hashJson(originalLock)) {
    throw new Error(`Researcher changed locked Benchmark '${benchmark.id}' or its lock artifact`);
  }
}

async function evaluateRegressions(options: {
  originalProject: ProjectContext; stagedProject: ProjectContext; lab: ResearchLabDefinition; previousSubject: { assembly: string; controller: string }; candidateSubject: { assembly: string; controller: string }; referenceSubject?: { assembly: string; controller: string }; deadlineMs: number;
}): Promise<{ results: any[]; gateReasons: string[] }> {
  const results: any[] = []; const gateReasons: string[] = [];
  for (const id of options.lab.regressions) {
    const originalBenchmark = await loadBenchmark(options.originalProject.rootDir, id); const stagedBenchmark = await loadBenchmark(options.stagedProject.rootDir, id);
    const originalLock = await requireBenchmarkLock(options.originalProject, originalBenchmark);
    await assertStagedBenchmarkInputsUnedited(options.originalProject, options.stagedProject, originalBenchmark);
    const objective = await loadObjective(options.originalProject.rootDir, originalBenchmark.objective);
    const baseline = await evaluatePair(options.originalProject, originalBenchmark, originalBenchmark.baseline.assembly, originalBenchmark.baseline.controller, undefined, options.deadlineMs);
    const previous = await evaluatePair(options.originalProject, originalBenchmark, options.previousSubject.assembly, options.previousSubject.controller, undefined, options.deadlineMs);
    const reference = options.referenceSubject
      ? await evaluatePair(options.originalProject, originalBenchmark, options.referenceSubject.assembly, options.referenceSubject.controller, undefined, options.deadlineMs)
      : previous;
    const candidate = await evaluatePair(options.stagedProject, stagedBenchmark, options.candidateSubject.assembly, options.candidateSubject.controller, undefined, options.deadlineMs);
    const reasons = researchGateReasons(objective, baseline, reference, candidate).map((reason) => `${id}: ${reason}`); gateReasons.push(...reasons);
    results.push({ benchmark: id, lockHash: originalLock.lockHash, previous, reference: options.referenceSubject ? reference : null, candidate, gateReasons: reasons });
  }
  return { results, gateReasons };
}

async function verifyResearchReviewRun(projectRoot: string, reference: ResearchReview["accepted"] | ResearchReview["candidate"]) {
  const root = confined(projectRoot, `runs/${reference.id}`);
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error(`Research Review Run '${reference.id}' must be a real artifact directory`);
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  const metrics = JSON.parse(await readFile(join(root, "metrics.json"), "utf8"));
  const score = JSON.parse(await readFile(join(root, "score.json"), "utf8"));
  if (
    manifest.completed !== true
    || manifest.id !== reference.id
    || manifest.runKey !== reference.runKey
    || manifest.resultHash !== reference.resultHash
    || hashJson(manifest) !== reference.manifestHash
    || hashJson(metrics) !== reference.metricsHash
    || hashJson(score) !== reference.scoreHash
    || await hashDirectory(root) !== reference.artifactHash
    || Math.abs(Number(score.total) - reference.score) > 1e-9
  ) throw new Error(`Research Review Run '${reference.id}' failed immutable verification`);
  return { root, manifest, metrics, score };
}

export async function verifyResearchReview(projectRoot: string, labId: string, sessionId: string, experimentId: string) {
  const sessionRoot = confined(projectRoot, `research-runs/${labId}/sessions/${sessionId}`);
  const experimentRoot = confined(sessionRoot, `experiments/${experimentId}`);
  for (const [label, root] of [["Session", sessionRoot], ["Experiment", experimentRoot]] as const) {
    const item = await lstat(root);
    if (!item.isDirectory() || item.isSymbolicLink()) throw new Error(`Research Review ${label} must be a real artifact directory`);
  }
  const session = JSON.parse(await readFile(join(sessionRoot, "manifest.json"), "utf8"));
  const experiment = JSON.parse(await readFile(join(experimentRoot, "manifest.json"), "utf8"));
  if (experiment.review?.status !== "AVAILABLE") {
    const reason = experiment.review?.error ? `: ${experiment.review.error}` : "";
    throw new Error(`Research experiment '${experimentId}' has no available visual Review${reason}`);
  }
  const review = researchReviewSchema.parse(JSON.parse(await readFile(join(experimentRoot, "review.json"), "utf8")));
  const reviewHash = hashJson(review);
  const evaluation = JSON.parse(await readFile(join(experimentRoot, "evaluation.json"), "utf8"));
  const acceptedCase = evaluation.previousPrimary?.cases?.find((item: any) => item.case?.id === review.selectedCase.id);
  const candidateCase = evaluation.primary?.cases?.find((item: any) => item.case?.id === review.selectedCase.id);
  if (
    session.id !== sessionId
    || session.researchId !== labId
    || !session.experiments?.includes(experimentId)
    || experiment.id !== experimentId
    || experiment.sessionId !== sessionId
    || experiment.researchId !== labId
    || experiment.experimentHash !== review.lineage.experimentHash
    || experiment.labHash !== review.lineage.labHash
    || experiment.programHash !== review.lineage.programHash
    || experiment.benchmarkLockHash !== review.lineage.benchmarkLockHash
    || experiment.researchBriefId !== review.lineage.researchBriefId
    || experiment.researchBriefHash !== review.lineage.researchBriefHash
    || experiment.verdict !== review.judge.verdict
    || hashJson(experiment.decision) !== review.judge.decisionHash
    || hashJson(experiment.decision) !== hashJson(review.judge.decision)
    || hashJson(experiment.proposal) !== hashJson(review.proposal)
    || experiment.review.reviewHash !== reviewHash
    || experiment.review.acceptedRunId !== review.accepted.id
    || experiment.review.candidateRunId !== review.candidate.id
    || experiment.review.caseId !== review.selectedCase.id
    || !acceptedCase
    || !candidateCase
    || acceptedCase.resultHash !== review.accepted.resultHash
    || candidateCase.resultHash !== review.candidate.resultHash
    || Math.abs(Number(acceptedCase.score?.total) - review.accepted.score) > 1e-9
    || Math.abs(Number(candidateCase.score?.total) - review.candidate.score) > 1e-9
  ) throw new Error(`Research Review '${experimentId}' failed lineage verification`);
  if (review.lineage.researchBriefId) {
    const brief = await verifyResearchBrief(projectRoot, review.lineage.researchBriefId);
    if (
      brief.briefHash !== review.lineage.researchBriefHash
      || hashJson(brief.brief.observations.map((item) => item.id)) !== hashJson(review.lineage.observationIds)
    ) throw new Error(`Research Review '${experimentId}' differs from its immutable Research Brief`);
  } else if (review.lineage.researchBriefHash !== null || review.lineage.observationIds.length) {
    throw new Error(`Research Review '${experimentId}' has observations without a Research Brief`);
  }
  const [accepted, candidate] = await Promise.all([
    verifyResearchReviewRun(projectRoot, review.accepted),
    verifyResearchReviewRun(projectRoot, review.candidate),
  ]);
  return { review, reviewHash, path: join(experimentRoot, "review.json"), session, experiment, evaluation, accepted, candidate };
}

export async function researchReviewInspectCommand(projectDir: string, labId: string, sessionId: string, experimentId: string) {
  const project = await loadProject(projectDir);
  const verified = await verifyResearchReview(project.rootDir, labId, sessionId, experimentId);
  return success("research.review.inspect", {
    review: verified.review,
    reviewHash: verified.reviewHash,
    path: verified.path,
    session: verified.session,
    experiment: verified.experiment,
  }, project, [], [
    {
      id: "open-visual-review",
      description: "Render the immutable accepted/candidate MuJoCo Run pair with complete Research Review lineage",
      argv: ["studio", project.rootDir, "--research-lab", labId, "--session", sessionId, "--experiment", experimentId],
      effect: "creates-artifact",
    },
    {
      id: "inspect-candidate-evidence",
      description: "Inspect the candidate Run at its initial frame with the accepted Run as comparison",
      argv: ["evidence", "inspect", project.rootDir, "--run", verified.review.accepted.id, "--time", "0", "--compare-run", verified.review.candidate.id],
      effect: "read-only",
    },
  ]);
}

export async function researchTimelineStudioCommand(projectDir: string, labId: string, sessionId?: string, experimentId?: string) {
  const project = await loadProject(projectDir);
  const sessionsRoot = confined(project.rootDir, `research-runs/${labId}/sessions`);
  if (!(await exists(sessionsRoot))) throw new Error(`Research Lab '${labId}' has no completed Sessions`);
  if (experimentId && !sessionId) throw new Error("Studio Research Timeline requires --session when --experiment is supplied");
  const availableSessions = (await readdir(sessionsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort();
  const selectedSessions = sessionId ? availableSessions.filter((id) => id === sessionId) : availableSessions;
  if (!selectedSessions.length) throw new Error(`Research Session '${sessionId}' does not exist in Lab '${labId}'`);
  const verifiedReviews: Array<Awaited<ReturnType<typeof verifyResearchReview>>> = [];
  for (const selectedSessionId of selectedSessions) {
    const sessionRoot = confined(sessionsRoot, selectedSessionId);
    const sessionManifest = JSON.parse(await readFile(join(sessionRoot, "manifest.json"), "utf8"));
    const experimentIds = Array.isArray(sessionManifest.experiments) ? sessionManifest.experiments.map(String) : [];
    const scopedExperimentIds = experimentId ? experimentIds.filter((id: string) => id === experimentId) : experimentIds;
    if (experimentId && !scopedExperimentIds.length) {
      throw new Error(`Research Experiment '${experimentId}' does not exist in Session '${selectedSessionId}'`);
    }
    for (const selectedExperimentId of scopedExperimentIds) {
      const manifest = JSON.parse(await readFile(join(sessionRoot, "experiments", selectedExperimentId, "manifest.json"), "utf8"));
      if (manifest.review?.status === "AVAILABLE") {
        verifiedReviews.push(await verifyResearchReview(project.rootDir, labId, selectedSessionId, selectedExperimentId));
      } else if (experimentId) {
        const reason = manifest.review?.error ? `: ${manifest.review.error}` : "";
        throw new Error(`Research experiment '${selectedExperimentId}' has no available visual Review${reason}`);
      }
    }
  }
  if (!verifiedReviews.length) {
    throw new Error(`Research Timeline '${labId}' has no immutable visual Reviews in the selected scope`);
  }
  const selected = experimentId
    ? verifiedReviews.find((entry) => entry.review.lineage.experimentId === experimentId)
    : verifiedReviews.at(-1);
  if (!selected) throw new Error(`Research Experiment '${experimentId}' has no immutable visual Review`);
  return studioCommand(
    project.rootDir,
    selected.review.accepted.id,
    selected.review.candidate.id,
    { review: selected.review, reviewHash: selected.reviewHash },
    {
      labId,
      ...(sessionId ? { sessionId } : {}),
      ...(experimentId ? { experimentId } : {}),
      selectedKey: `${selected.review.lineage.sessionId}/${selected.review.lineage.experimentId}`,
      entries: verifiedReviews.map((entry) => ({ review: entry.review, reviewHash: entry.reviewHash })),
    },
  );
}

export async function researchLabListCommand(projectDir: string) {
  const project = await loadProject(projectDir); const labs = [];
  for (const id of await listResearchLabIds(project.rootDir)) labs.push(await loadResearchLab(project.rootDir, id));
  return success("research.list", { labs }, project);
}

export async function researchBriefCommand(projectDir: string, labId: string, observationIds: string[]) {
  const project = await loadProject(projectDir);
  if (!observationIds.length || observationIds.length > 16) throw new Error("Research Brief requires 1..16 --observation values");
  if (new Set(observationIds).size !== observationIds.length) throw new Error("Research Brief observation ids must be unique");
  const binding = await researchLabBinding(project.rootDir, labId);
  const observations = [];
  for (const id of [...observationIds].sort()) {
    observations.push(briefObservation(await verifyHumanObservation(confined(project.rootDir, `human-observations/${id}`))));
  }
  const brief: ResearchBrief = researchBriefSchema.parse({
    version: 1,
    kind: "mujica-research-brief",
    authority: "derived-handoff",
    claimKind: "research-prioritization",
    lab: {
      definition: binding.lab,
      labHash: binding.labHash,
      programHash: binding.programHash,
      benchmarkLockHash: binding.benchmarkLockHash,
    },
    observations,
    authorityBoundary: {
      humanInput: "hypothesis-only",
      sourceContext: "immutable-evidence",
      sourceEdits: "lab-closure-only",
      promotion: "locked-judge-only",
    },
  });
  const briefHash = hashJson(brief);
  const id = `brief-${briefHash.slice(0, 16)}`;
  const path = join(project.rootDir, "research-briefs", id);
  const identity = {
    version: 1,
    kind: "mujica-research-brief-artifact",
    id,
    briefHash,
    labId: binding.lab.id,
    labHash: binding.labHash,
    programHash: binding.programHash,
    benchmarkLockHash: binding.benchmarkLockHash,
    observationIds: observations.map((item) => item.id),
    observationHashes: observations.map((item) => item.observationHash),
    completed: true,
  };
  const manifest = { ...identity, manifestHash: hashJson(identity) };
  if (await exists(path)) {
    const existing = await verifyResearchBrief(project.rootDir, id);
    if (existing.briefHash !== briefHash) throw new Error(`Immutable Research Brief collision at '${id}'`);
  } else {
    await atomicDirectory(path, async (directory) => {
      await writeJson(join(directory, "brief.json"), brief);
      await writeJson(join(directory, "manifest.json"), manifest);
    });
  }
  return success("research.brief", { id, briefHash, path, manifest, brief }, project, [
    artifact("research-brief", id, path),
  ], [
    { id: "inspect-research-brief", description: "Verify the immutable human-to-Agent research handoff", argv: ["research", "brief", "inspect", project.rootDir, "--brief", id], effect: "read-only" },
    { id: "run-briefed-research", description: "Run the bound Lab with this exact human hypothesis context", argv: ["research", "run", project.rootDir, "--lab", labId, "--brief", id, "--iterations", "1", "--agent-command", "<command>"], effect: "mutates-project" },
  ]);
}

export async function researchBriefInspectCommand(projectDir: string, id: string) {
  const project = await loadProject(projectDir);
  const verified = await verifyResearchBrief(project.rootDir, id);
  return success("research.brief.inspect", verified, project, [
    artifact("research-brief", id, verified.path),
  ], [
    { id: "run-briefed-research", description: "Run the bound Lab with this exact human hypothesis context", argv: ["research", "run", project.rootDir, "--lab", verified.brief.lab.definition.id, "--brief", id, "--iterations", "1", "--agent-command", "<command>"], effect: "mutates-project" },
  ]);
}

export async function researchLabInspectCommand(projectDir: string, id: string) {
  const project = await loadProject(projectDir); const binding = await researchLabBinding(project.rootDir, id);
  return success("research.inspect", { lab: binding.lab, programHash: binding.programHash, benchmarkLockHash: binding.benchmarkLockHash }, project, [], [
    { id: "run-research", description: "Run one isolated source experiment through the locked Judge", argv: ["research", "run", project.rootDir, "--lab", id, "--iterations", "1", "--agent-command", "<command>"], effect: "mutates-project" },
    { id: "prepare-human-brief", description: "Bind an explicit human observation before running this Lab", argv: ["research", "brief", project.rootDir, "--lab", id, "--observation", "<observation-id>"], effect: "creates-artifact" },
  ]);
}

export async function researchLabStatusCommand(projectDir: string, id: string) {
  const project = await loadProject(projectDir); await loadResearchLab(project.rootDir, id); const sessionsRoot = join(project.rootDir, "research-runs", id, "sessions"); const sessions: any[] = [];
  if (await exists(sessionsRoot)) for (const entry of await readdir(sessionsRoot, { withFileTypes: true })) if (entry.isDirectory() && await exists(join(sessionsRoot, entry.name, "manifest.json"))) sessions.push(JSON.parse(await readFile(join(sessionsRoot, entry.name, "manifest.json"), "utf8")));
  sessions.sort((left, right) => String(left.startedAt).localeCompare(String(right.startedAt)));
  return success("research.status", { lab: id, sessions, head: sessions.at(-1) ?? null }, project);
}

export async function researchLabRunCommand(projectDir: string, id: string, requestedIterations: number, agentCommand: string, briefId?: string) {
  const project = await loadProject(projectDir); const binding = await researchLabBinding(project.rootDir, id);
  const { lab, benchmark, program, programHash, labHash } = binding;
  const lock = { lockHash: binding.benchmarkLockHash };
  const researchBrief = briefId ? await assertResearchBriefForBinding(project.rootDir, briefId, binding) : null;
  if (!Number.isInteger(requestedIterations) || requestedIterations <= 0) throw new Error("--iterations must be a positive integer");
  if (!agentCommand.trim()) throw new Error("Research Lab V2 requires --agent-command");
  const iterations = Math.min(requestedIterations, lab.budget.maxExperiments);
  const startedAt = new Date().toISOString(); const sessionId = `session-${hashJson({ labHash, programHash, lockHash: lock.lockHash, briefHash: researchBrief?.briefHash ?? null, startedAt }).slice(0, 16)}`; const sessionRoot = join(project.rootDir, "research-runs", id, "sessions", sessionId); const experimentsRoot = join(sessionRoot, "experiments");
  await mkdir(experimentsRoot, { recursive: true }); const ledgerPath = join(sessionRoot, "results.tsv");
  if (researchBrief) await writeJson(join(sessionRoot, "brief.json"), researchBrief.brief);
  await writeFile(ledgerPath, "sequence\texperiment\tpolicy\tscore\tdelta\tviolations\tstatus\tstrategy\tdescription\n");
  const initial = await currentPrimary(project, lab, benchmark); let current = initial.current; let currentSubject = initial.subject; const objective = await loadObjective(project.rootDir, benchmark.objective);
  const summaries: any[] = []; const artifacts: Artifact[] = []; let exhausted = false;

  for (let sequence = 1; sequence <= iterations; sequence++) {
    const workspaceContainer = await mkdtemp(join(tmpdir(), `mujica-${id}-`)); const workspace = join(workspaceContainer, "project"); const snapshots = join(workspaceContainer, "snapshots"); const beforeSnapshot = join(snapshots, "before"); const afterSnapshot = join(snapshots, "after");
    const experimentStarted = Date.now(); const deadlineMs = experimentStarted + lab.budget.maxWallClockSeconds * 1000;
    const previous = current;
    let proposal: ResearchLabProposal | null = null; let researcher: { stderr: string; durationMs: number } | null = null; let patch = ""; let beforeSource: SourceHashes = {}; let afterSource: SourceHashes = {}; let execution: any = null; let candidate: Evaluation | null = null; let referencePrimary: Evaluation | null = null; let regressionResults: any[] = []; let decision: ReturnType<typeof researchDecision> | null = null; let verdict: "KEEP" | "REVERT" | "CRASH" = "CRASH"; let errorMessage: string | null = null; let policyId: string | null = null; let revision: { id: string; path: string } | null = null; let finalChanged: string[] = []; let researcherChangedPaths: string[] = []; let review: ResearchReview | null = null; let reviewError: string | null = null;
    try {
      await copyProject(project.rootDir, workspace); beforeSource = await materializeEditableSnapshot(project.rootDir, beforeSnapshot, lab); const beforeGuard = await snapshotFiles(workspace, false);
      const response = await invokeResearcher(agentCommand, workspace, {
        version: 3,
        lab,
        program,
        programHash,
        benchmarkLockHash: lock.lockHash,
        workspace,
        currentBest: current,
        history: summaries,
        researchBrief: researchBrief?.brief ?? null,
        researchBriefId: researchBrief?.id ?? null,
        researchBriefHash: researchBrief?.briefHash ?? null,
      }, Math.max(1, deadlineMs - Date.now()));
      proposal = response.proposal; researcher = { stderr: response.stderr, durationMs: response.durationMs };
      const afterGuard = await snapshotFiles(workspace, false); researcherChangedPaths = changedPaths(beforeGuard, afterGuard);
      afterSource = await materializeEditableSnapshot(workspace, afterSnapshot, lab); finalChanged = changedPaths(beforeSource, afterSource); patch = await sourcePatch(beforeSnapshot, afterSnapshot);
      assertResearchLabEditableChanges(lab, researcherChangedPaths);
      const stagedProject = await loadProject(workspace); const stagedBenchmark = await loadBenchmark(workspace, lab.benchmark);
      await assertStagedBenchmarkInputsUnedited(project, stagedProject, benchmark);
      let candidateSubject: { assembly: string; controller: string };
      if (lab.execution.kind === "controller") {
        const loaded = await loadController(workspace, lab.execution.controller); if (loaded.definition.kind !== "program") throw new Error("Controller Lab target is no longer a program Controller");
        const assembly = await compileAssembly(workspace, lab.execution.assembly); assertProgramControllerCompatible(loaded.definition, assembly);
        candidateSubject = { assembly: lab.execution.assembly, controller: lab.execution.controller };
        candidate = await evaluatePair(stagedProject, stagedBenchmark, candidateSubject.assembly, candidateSubject.controller, undefined, deadlineMs);
        execution = { kind: "controller", assemblyHash: candidate.assemblyHash };
      } else if (lab.execution.kind === "policy") {
        const training = await loadTraining(workspace, lab.execution.training);
        if (training.totalSteps > lab.budget.maximumTrainingSteps!) throw new Error(`Training totalSteps ${training.totalSteps} exceeds Lab maximum ${lab.budget.maximumTrainingSteps}`);
        const loaded = await loadController(workspace, lab.execution.controller); if (loaded.definition.kind !== "policy") throw new Error("Policy Lab target is no longer a policy Controller");
        const trainingResult = await executeTraining(stagedProject, training, lab.execution.seed, deadlineMs); policyId = trainingResult.policyId;
        const imported = await importTrainingArtifacts(workspace, project.rootDir, trainingResult); const candidateController: ControllerDefinition = { ...loaded.definition, policy: trainingResult.policyId };
        await writeJson(join(loaded.rootDir, "controller.json"), candidateController);
        candidateSubject = { assembly: training.assembly, controller: lab.execution.controller };
        candidate = await evaluatePair(stagedProject, stagedBenchmark, candidateSubject.assembly, candidateSubject.controller, undefined, deadlineMs);
        execution = { kind: "policy", trainingRunId: trainingResult.trainingRunId, trainingRunPath: imported.trainingRunPath, policyId, policyPath: imported.policyPath, trainingMetrics: trainingResult.trainingMetrics };
        artifacts.push(artifact("training-run", trainingResult.trainingRunId, imported.trainingRunPath), artifact("policy", trainingResult.policyId, imported.policyPath));
      } else {
        const stagedCandidate = await loadCandidate(workspace, lab.execution.candidate); if (stagedCandidate.benchmark !== lab.benchmark) throw new Error("Development Candidate changed its locked Benchmark");
        const envelope = await candidateCommand(workspace, lab.execution.candidate, false, deadlineMs); const data: any = envelope.data;
        candidate = data.proposed; candidateSubject = { assembly: data.candidate.proposed.assembly, controller: data.candidate.proposed.controller };
        execution = { kind: "development", candidate: data.candidate.id, semanticChanges: data.verifiedChanges };
      }
      if (!candidate) throw new Error("Research Lab execution did not produce a candidate evaluation");
      const candidateEvaluation = candidate;
      const referenceSubject = lab.execution.kind === "policy" && lab.execution.referenceController
        ? { assembly: (await loadTraining(project.rootDir, lab.execution.training)).assembly, controller: lab.execution.referenceController }
        : undefined;
      let referenceDecision: ReturnType<typeof researchDecision> | null = null;
      if (referenceSubject) {
        referencePrimary = await evaluatePair(project, benchmark, referenceSubject.assembly, referenceSubject.controller, undefined, deadlineMs);
        referenceDecision = researchDecision(objective, initial.lockedBaseline, referencePrimary, candidateEvaluation, lab.minimumImprovement);
      }
      const regressions = await evaluateRegressions({ originalProject: project, stagedProject, lab, previousSubject: currentSubject, candidateSubject, ...(referenceSubject ? { referenceSubject } : {}), deadlineMs }); regressionResults = regressions.results;
      const candidateDecision = researchDecision(objective, initial.lockedBaseline, previous, candidateEvaluation, lab.minimumImprovement);
      const externalGateReasons = policyReferenceGateReasons(referenceDecision, regressions.gateReasons);
      verdict = candidateDecision.verdict === "KEEP" && externalGateReasons.length === 0 ? "KEEP" : "REVERT";
      const finalDecision: ReturnType<typeof researchDecision> = externalGateReasons.length
        ? { ...candidateDecision, verdict: "REVERT", gateReasons: [...candidateDecision.gateReasons, ...externalGateReasons], selectionReason: "gate-regression" }
        : candidateDecision;
      decision = finalDecision;
      afterSource = await materializeEditableSnapshot(workspace, afterSnapshot, lab); finalChanged = changedPaths(beforeSource, afterSource); assertResearchLabEditableChanges(lab, finalChanged); patch = await sourcePatch(beforeSnapshot, afterSnapshot);
      const experimentHash = hashJson({ labHash, programHash, lockHash: lock.lockHash, briefHash: researchBrief?.briefHash ?? null, proposal, beforeSource, afterSource, policyId, results: candidateEvaluation.cases.map((item) => item.resultHash), referenceResults: referencePrimary?.cases.map((item) => item.resultHash) ?? null, regressionResults: regressionResults.map((item) => ({ reference: item.reference?.cases.map((entry: any) => entry.resultHash) ?? null, candidate: item.candidate.cases.map((entry: any) => entry.resultHash) })), verdict });
      const experimentId = `${String(sequence).padStart(3, "0")}-${experimentHash.slice(0, 12)}`;
      try {
        review = await captureResearchReview({
          project,
          stagedProject,
          lab,
          benchmark,
          previous,
          candidate: candidateEvaluation,
          previousSubject: currentSubject,
          candidateSubject,
          decision: finalDecision,
          proposal,
          experimentId,
          experimentHash,
          sessionId,
          labHash,
          programHash,
          benchmarkLockHash: lock.lockHash,
          researchBrief,
        });
      } catch (error) {
        reviewError = error instanceof Error ? error.message : String(error);
      }
      if (verdict === "KEEP") {
        const rollback = await applySourceTransaction(project.rootDir, workspace, beforeSource, afterSource, finalChanged);
        try {
          if (lab.promotion === "policy-revision") {
            if (!policyId) throw new Error("Policy KEEP is missing a frozen Policy");
            revision = await publishPolicyRevision({ project, lab, benchmark, lockHash: lock.lockHash, experimentId, experimentHash, proposal, previous, candidate: candidateEvaluation, decision: finalDecision, policyId });
          } else if (lab.promotion === "robot-revision") {
            if (lab.execution.kind === "controller") revision = await publishControllerRevision({ project, lab, benchmark, lockHash: lock.lockHash, experimentId, experimentHash, proposal, previous, candidate: candidateEvaluation, decision: finalDecision });
            else if (lab.execution.kind === "development") {
              const applied = await candidateCommand(project.rootDir, lab.execution.candidate, true, deadlineMs); const data: any = applied.data; revision = { id: data.revisionId, path: data.revisionPath };
            }
          }
        } catch (error) { await rollback(); throw error; }
        current = candidateEvaluation; currentSubject = candidateSubject;
      }
      const artifactPath = join(experimentsRoot, experimentId);
      await atomicDirectory(artifactPath, async (directory) => {
        await writeJson(join(directory, "proposal.json"), proposal); await writeJson(join(directory, "before-source-hashes.json"), beforeSource); await writeJson(join(directory, "after-source-hashes.json"), afterSource); await writeFile(join(directory, "patch.diff"), patch);
        if (researcher?.stderr.trim()) await writeFile(join(directory, "agent.stderr.txt"), researcher.stderr); await writeJson(join(directory, "execution.json"), execution);
        await writeJson(join(directory, "evaluation.json"), { previousPrimary: previous, primary: candidateEvaluation, referencePrimary, regressions: regressionResults });
        await writeJson(join(directory, "verdict.json"), { verdict, decision, revisionId: revision?.id ?? null });
        if (review) await writeJson(join(directory, "review.json"), review);
        await writeJson(join(directory, "manifest.json"), {
          version: 4, id: experimentId, experimentHash, sequence, sessionId, researchId: lab.id, labHash, programHash, benchmarkLockHash: lock.lockHash,
          researchBriefId: researchBrief?.id ?? null, researchBriefHash: researchBrief?.briefHash ?? null, sourceHash: hashJson(afterSource),
          researcherChangedPaths, changedPaths: finalChanged, proposal, policyId, score: candidateEvaluation.aggregateScore,
          delta: candidateEvaluation.aggregateScore - previous.aggregateScore, verdict, decision, revisionId: revision?.id ?? null,
          review: review
            ? { status: "AVAILABLE", reviewHash: hashJson(review), acceptedRunId: review.accepted.id, candidateRunId: review.candidate.id, caseId: review.selectedCase.id }
            : { status: "UNAVAILABLE", error: reviewError ?? "Research Review was not captured" },
          durationMs: Date.now() - experimentStarted, completed: true,
        });
      });
      const summary = {
        sequence, experimentId, proposal, policyId, score: candidateEvaluation.aggregateScore,
        delta: candidateEvaluation.aggregateScore - previous.aggregateScore, verdict, decision: finalDecision,
        revisionId: revision?.id ?? null,
        review: review
          ? { status: "AVAILABLE", reviewHash: hashJson(review), acceptedRunId: review.accepted.id, candidateRunId: review.candidate.id, caseId: review.selectedCase.id }
          : { status: "UNAVAILABLE", error: reviewError ?? "Research Review was not captured" },
        artifactPath,
      };
      summaries.push(summary); artifacts.push(artifact("research-experiment", experimentId, artifactPath)); if (revision) artifacts.push(artifact(lab.promotion === "policy-revision" ? "policy-revision" : "revision", revision.id, revision.path));
      if (review) {
        artifacts.push(artifact("research-review", `${experimentId}-review`, join(artifactPath, "review.json")));
        for (const run of [review.accepted, review.candidate]) {
          if (!artifacts.some((item) => item.kind === "simulation-run" && item.id === run.id)) artifacts.push(artifact("simulation-run", run.id, confined(project.rootDir, `runs/${run.id}`)));
        }
      }
      await appendFile(ledgerPath, `${sequence}\t${experimentId}\t${policyId ?? "-"}\t${candidateEvaluation.aggregateScore}\t${summary.delta}\t${finalDecision.candidateViolationCount}\t${verdict.toLowerCase()}\t${proposal.strategy}\t${proposal.hypothesis.replace(/[\t\r\n]+/g, " ")}\n`);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error); const experimentHash = hashJson({ labHash, programHash, lockHash: lock.lockHash, briefHash: researchBrief?.briefHash ?? null, proposal, beforeSource, afterSource, researcherChangedPaths, errorMessage, verdict: "CRASH" }); const experimentId = `${String(sequence).padStart(3, "0")}-${experimentHash.slice(0, 12)}`; const artifactPath = join(experimentsRoot, experimentId);
      if (!patch && await exists(beforeSnapshot) && await exists(afterSnapshot)) try { patch = await sourcePatch(beforeSnapshot, afterSnapshot); } catch {}
      await atomicDirectory(artifactPath, async (directory) => {
        await writeJson(join(directory, "proposal.json"), proposal); await writeJson(join(directory, "before-source-hashes.json"), beforeSource); await writeJson(join(directory, "after-source-hashes.json"), afterSource); await writeFile(join(directory, "patch.diff"), patch); await writeJson(join(directory, "execution.json"), execution);
        if (researcher?.stderr.trim()) await writeFile(join(directory, "agent.stderr.txt"), researcher.stderr); await writeFile(join(directory, "error.txt"), `${errorMessage}\n`);
        await writeJson(join(directory, "verdict.json"), { verdict: "CRASH", error: errorMessage });
        await writeJson(join(directory, "manifest.json"), { version: 4, id: experimentId, experimentHash, sequence, sessionId, researchId: lab.id, labHash, programHash, benchmarkLockHash: lock.lockHash, researchBriefId: researchBrief?.id ?? null, researchBriefHash: researchBrief?.briefHash ?? null, sourceHash: Object.keys(afterSource).length ? hashJson(afterSource) : null, researcherChangedPaths, changedPaths: finalChanged, proposal, policyId, score: current.aggregateScore, delta: 0, verdict: "CRASH", error: errorMessage, revisionId: null, review: { status: "NOT_APPLICABLE", error: "Experiment did not complete locked Judge evaluation" }, durationMs: Date.now() - experimentStarted, completed: true });
      });
      const summary = { sequence, experimentId, proposal, policyId, score: current.aggregateScore, delta: 0, verdict: "CRASH", error: errorMessage, revisionId: null, artifactPath }; summaries.push(summary); artifacts.push(artifact("research-experiment", experimentId, artifactPath));
      await appendFile(ledgerPath, `${sequence}\t${experimentId}\t${policyId ?? "-"}\t${current.aggregateScore}\t0\t-\tcrash\t${proposal?.strategy ?? "proposal-error"}\t${errorMessage.replace(/[\t\r\n]+/g, " ")}\n`);
    } finally {
      await rm(workspaceContainer, { recursive: true, force: true });
    }
  }

  const endedAt = new Date().toISOString(); const sessionManifest = {
    version: 4, id: sessionId, researchId: lab.id, labHash, programHash, benchmarkLockHash: lock.lockHash,
    researchBriefId: researchBrief?.id ?? null, researchBriefHash: researchBrief?.briefHash ?? null,
    startedAt, endedAt, iterationsRequested: requestedIterations, iterationsCompleted: summaries.length,
    initialScore: initial.current.aggregateScore, finalScore: current.aggregateScore,
    scoreDelta: current.aggregateScore - initial.current.aggregateScore, exhausted,
    reviewCount: summaries.filter((item) => item.review?.status === "AVAILABLE").length,
    reviewFailureCount: summaries.filter((item) => item.review?.status === "UNAVAILABLE").length,
    experiments: summaries.map((item) => item.experimentId), completed: true,
  };
  await writeJson(join(sessionRoot, "manifest.json"), sessionManifest); artifacts.push(artifact("research-session", sessionId, sessionRoot));
  const latestReview = [...summaries].reverse().find((item) => item.review?.status === "AVAILABLE");
  return success("research.run", { ...sessionManifest, lab, experiments: summaries, ledgerPath }, project, artifacts, [
    ...(latestReview ? [{
      id: "review-latest-experiment",
      description: "Inspect and visually compare the exact accepted/candidate MuJoCo Runs",
      argv: ["research", "review", "inspect", project.rootDir, "--lab", id, "--session", sessionId, "--experiment", latestReview.experimentId],
      effect: "read-only" as const,
    }] : []),
    { id: "research-status", description: "Inspect Research Lab sessions and current head", argv: ["research", "status", project.rootDir, "--lab", id], effect: "read-only" },
  ]);
}
