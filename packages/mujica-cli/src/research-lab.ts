import { appendFile, cp, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
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
  researchLabProposalSchema,
  sha256,
  writeJson,
  type BenchmarkDefinition,
  type ControllerDefinition,
  type ProjectContext,
  type ResearchLabDefinition,
  type ResearchLabProposal,
} from "@mujica/core";
import { candidateCommand, evaluatePair, executeTraining, requireBenchmarkLock, researchDecision, researchGateReasons } from "./commands";
import { success, type Artifact } from "./contract";

const GENERATED_ROOTS = new Set([
  ".mujica", "runs", "training-runs", "research-runs", "training-research-runs",
  "revisions", "policy-revisions", "hardware-bundles", "hardware-verifications",
]);
const SOURCE_ARTIFACT_ROOTS = new Set([...GENERATED_ROOTS, "policies"]);

type Evaluation = Awaited<ReturnType<typeof evaluatePair>>;
type SourceHashes = Record<string, string>;

function artifact(kind: Artifact["kind"], id: string, path: string, immutable = true): Artifact {
  return { kind, id, path, immutable };
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
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

async function evaluateRegressions(options: {
  originalProject: ProjectContext; stagedProject: ProjectContext; lab: ResearchLabDefinition; previousSubject: { assembly: string; controller: string }; candidateSubject: { assembly: string; controller: string }; referenceSubject?: { assembly: string; controller: string }; deadlineMs: number;
}): Promise<{ results: any[]; gateReasons: string[] }> {
  const results: any[] = []; const gateReasons: string[] = [];
  for (const id of options.lab.regressions) {
    const originalBenchmark = await loadBenchmark(options.originalProject.rootDir, id); const stagedBenchmark = await loadBenchmark(options.stagedProject.rootDir, id);
    const originalLock = await requireBenchmarkLock(options.originalProject, originalBenchmark); const stagedLock = await requireBenchmarkLock(options.stagedProject, stagedBenchmark);
    if (originalLock.lockHash !== stagedLock.lockHash) throw new Error(`Regression Benchmark '${id}' lock differs in the staged project`);
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

export async function researchLabListCommand(projectDir: string) {
  const project = await loadProject(projectDir); const labs = [];
  for (const id of await listResearchLabIds(project.rootDir)) labs.push(await loadResearchLab(project.rootDir, id));
  return success("research.list", { labs }, project);
}

export async function researchLabInspectCommand(projectDir: string, id: string) {
  const project = await loadProject(projectDir); const lab = await loadResearchLab(project.rootDir, id); const program = await readFile(confined(project.rootDir, lab.program), "utf8");
  const benchmark = await loadBenchmark(project.rootDir, lab.benchmark); const lock = await requireBenchmarkLock(project, benchmark);
  return success("research.inspect", { lab, programHash: sha256(program), benchmarkLockHash: lock.lockHash }, project, [], [
    { id: "run-research", description: "Run one isolated source experiment through the locked Judge", argv: ["research", "run", project.rootDir, "--lab", id, "--iterations", "1", "--agent-command", "<command>"], effect: "mutates-project" },
  ]);
}

export async function researchLabStatusCommand(projectDir: string, id: string) {
  const project = await loadProject(projectDir); await loadResearchLab(project.rootDir, id); const sessionsRoot = join(project.rootDir, "research-runs", id, "sessions"); const sessions: any[] = [];
  if (await exists(sessionsRoot)) for (const entry of await readdir(sessionsRoot, { withFileTypes: true })) if (entry.isDirectory() && await exists(join(sessionsRoot, entry.name, "manifest.json"))) sessions.push(JSON.parse(await readFile(join(sessionsRoot, entry.name, "manifest.json"), "utf8")));
  sessions.sort((left, right) => String(left.startedAt).localeCompare(String(right.startedAt)));
  return success("research.status", { lab: id, sessions, head: sessions.at(-1) ?? null }, project);
}

export async function researchLabRunCommand(projectDir: string, id: string, requestedIterations: number, agentCommand: string) {
  const project = await loadProject(projectDir); const lab = await loadResearchLab(project.rootDir, id); const benchmark = await loadBenchmark(project.rootDir, lab.benchmark); const lock = await requireBenchmarkLock(project, benchmark);
  if (!Number.isInteger(requestedIterations) || requestedIterations <= 0) throw new Error("--iterations must be a positive integer");
  if (!agentCommand.trim()) throw new Error("Research Lab V2 requires --agent-command");
  const iterations = Math.min(requestedIterations, lab.budget.maxExperiments); const program = await readFile(confined(project.rootDir, lab.program), "utf8"); const programHash = sha256(program); const labHash = hashJson(lab);
  const startedAt = new Date().toISOString(); const sessionId = `session-${hashJson({ labHash, programHash, lockHash: lock.lockHash, startedAt }).slice(0, 16)}`; const sessionRoot = join(project.rootDir, "research-runs", id, "sessions", sessionId); const experimentsRoot = join(sessionRoot, "experiments");
  await mkdir(experimentsRoot, { recursive: true }); const ledgerPath = join(sessionRoot, "results.tsv");
  await writeFile(ledgerPath, "sequence\texperiment\tpolicy\tscore\tdelta\tviolations\tstatus\tstrategy\tdescription\n");
  const initial = await currentPrimary(project, lab, benchmark); let current = initial.current; let currentSubject = initial.subject; const objective = await loadObjective(project.rootDir, benchmark.objective);
  const summaries: any[] = []; const artifacts: Artifact[] = []; let exhausted = false;

  for (let sequence = 1; sequence <= iterations; sequence++) {
    const workspaceContainer = await mkdtemp(join(tmpdir(), `mujica-${id}-`)); const workspace = join(workspaceContainer, "project"); const snapshots = join(workspaceContainer, "snapshots"); const beforeSnapshot = join(snapshots, "before"); const afterSnapshot = join(snapshots, "after");
    const experimentStarted = Date.now(); const deadlineMs = experimentStarted + lab.budget.maxWallClockSeconds * 1000;
    const previous = current;
    let proposal: ResearchLabProposal | null = null; let researcher: { stderr: string; durationMs: number } | null = null; let patch = ""; let beforeSource: SourceHashes = {}; let afterSource: SourceHashes = {}; let execution: any = null; let candidate: Evaluation | null = null; let referencePrimary: Evaluation | null = null; let regressionResults: any[] = []; let decision: ReturnType<typeof researchDecision> | null = null; let verdict: "KEEP" | "REVERT" | "CRASH" = "CRASH"; let errorMessage: string | null = null; let policyId: string | null = null; let revision: { id: string; path: string } | null = null; let finalChanged: string[] = []; let researcherChangedPaths: string[] = [];
    try {
      await copyProject(project.rootDir, workspace); beforeSource = await materializeEditableSnapshot(project.rootDir, beforeSnapshot, lab); const beforeGuard = await snapshotFiles(workspace, false);
      const response = await invokeResearcher(agentCommand, workspace, { version: 2, lab, program, programHash, benchmarkLockHash: lock.lockHash, workspace, currentBest: current, history: summaries }, Math.max(1, deadlineMs - Date.now()));
      proposal = response.proposal; researcher = { stderr: response.stderr, durationMs: response.durationMs };
      const afterGuard = await snapshotFiles(workspace, false); researcherChangedPaths = changedPaths(beforeGuard, afterGuard);
      afterSource = await materializeEditableSnapshot(workspace, afterSnapshot, lab); finalChanged = changedPaths(beforeSource, afterSource); patch = await sourcePatch(beforeSnapshot, afterSnapshot);
      assertResearchLabEditableChanges(lab, researcherChangedPaths);
      const stagedProject = await loadProject(workspace); const stagedBenchmark = await loadBenchmark(workspace, lab.benchmark); const stagedLock = await requireBenchmarkLock(stagedProject, stagedBenchmark);
      if (stagedLock.lockHash !== lock.lockHash) throw new Error("Primary Benchmark lock differs in the staged project");
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
      const experimentHash = hashJson({ labHash, programHash, lockHash: lock.lockHash, proposal, beforeSource, afterSource, policyId, results: candidateEvaluation.cases.map((item) => item.resultHash), referenceResults: referencePrimary?.cases.map((item) => item.resultHash) ?? null, regressionResults: regressionResults.map((item) => ({ reference: item.reference?.cases.map((entry: any) => entry.resultHash) ?? null, candidate: item.candidate.cases.map((entry: any) => entry.resultHash) })), verdict });
      const experimentId = `${String(sequence).padStart(3, "0")}-${experimentHash.slice(0, 12)}`;
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
        await writeJson(join(directory, "evaluation.json"), { primary: candidateEvaluation, referencePrimary, regressions: regressionResults });
        await writeJson(join(directory, "verdict.json"), { verdict, decision, revisionId: revision?.id ?? null });
        await writeJson(join(directory, "manifest.json"), { version: 2, id: experimentId, sequence, sessionId, researchId: lab.id, labHash, programHash, benchmarkLockHash: lock.lockHash, sourceHash: hashJson(afterSource), researcherChangedPaths, changedPaths: finalChanged, proposal, policyId, score: candidateEvaluation.aggregateScore, delta: candidateEvaluation.aggregateScore - previous.aggregateScore, verdict, decision, revisionId: revision?.id ?? null, durationMs: Date.now() - experimentStarted, completed: true });
      });
      const summary = { sequence, experimentId, proposal, policyId, score: candidateEvaluation.aggregateScore, delta: candidateEvaluation.aggregateScore - previous.aggregateScore, verdict, decision: finalDecision, revisionId: revision?.id ?? null, artifactPath };
      summaries.push(summary); artifacts.push(artifact("research-experiment", experimentId, artifactPath)); if (revision) artifacts.push(artifact(lab.promotion === "policy-revision" ? "policy-revision" : "revision", revision.id, revision.path));
      await appendFile(ledgerPath, `${sequence}\t${experimentId}\t${policyId ?? "-"}\t${candidateEvaluation.aggregateScore}\t${summary.delta}\t${finalDecision.candidateViolationCount}\t${verdict.toLowerCase()}\t${proposal.strategy}\t${proposal.hypothesis.replace(/[\t\r\n]+/g, " ")}\n`);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error); const experimentHash = hashJson({ labHash, programHash, lockHash: lock.lockHash, proposal, beforeSource, afterSource, researcherChangedPaths, errorMessage, verdict: "CRASH" }); const experimentId = `${String(sequence).padStart(3, "0")}-${experimentHash.slice(0, 12)}`; const artifactPath = join(experimentsRoot, experimentId);
      if (!patch && await exists(beforeSnapshot) && await exists(afterSnapshot)) try { patch = await sourcePatch(beforeSnapshot, afterSnapshot); } catch {}
      await atomicDirectory(artifactPath, async (directory) => {
        await writeJson(join(directory, "proposal.json"), proposal); await writeJson(join(directory, "before-source-hashes.json"), beforeSource); await writeJson(join(directory, "after-source-hashes.json"), afterSource); await writeFile(join(directory, "patch.diff"), patch); await writeJson(join(directory, "execution.json"), execution);
        if (researcher?.stderr.trim()) await writeFile(join(directory, "agent.stderr.txt"), researcher.stderr); await writeFile(join(directory, "error.txt"), `${errorMessage}\n`);
        await writeJson(join(directory, "verdict.json"), { verdict: "CRASH", error: errorMessage });
        await writeJson(join(directory, "manifest.json"), { version: 2, id: experimentId, sequence, sessionId, researchId: lab.id, labHash, programHash, benchmarkLockHash: lock.lockHash, sourceHash: Object.keys(afterSource).length ? hashJson(afterSource) : null, researcherChangedPaths, changedPaths: finalChanged, proposal, policyId, score: current.aggregateScore, delta: 0, verdict: "CRASH", error: errorMessage, revisionId: null, durationMs: Date.now() - experimentStarted, completed: true });
      });
      const summary = { sequence, experimentId, proposal, policyId, score: current.aggregateScore, delta: 0, verdict: "CRASH", error: errorMessage, revisionId: null, artifactPath }; summaries.push(summary); artifacts.push(artifact("research-experiment", experimentId, artifactPath));
      await appendFile(ledgerPath, `${sequence}\t${experimentId}\t${policyId ?? "-"}\t${current.aggregateScore}\t0\t-\tcrash\t${proposal?.strategy ?? "proposal-error"}\t${errorMessage.replace(/[\t\r\n]+/g, " ")}\n`);
    } finally {
      await rm(workspaceContainer, { recursive: true, force: true });
    }
  }

  const endedAt = new Date().toISOString(); const sessionManifest = { version: 2, id: sessionId, researchId: lab.id, labHash, programHash, benchmarkLockHash: lock.lockHash, startedAt, endedAt, iterationsRequested: requestedIterations, iterationsCompleted: summaries.length, initialScore: initial.current.aggregateScore, finalScore: current.aggregateScore, scoreDelta: current.aggregateScore - initial.current.aggregateScore, exhausted, experiments: summaries.map((item) => item.experimentId), completed: true };
  await writeJson(join(sessionRoot, "manifest.json"), sessionManifest); artifacts.push(artifact("research-session", sessionId, sessionRoot));
  return success("research.run", { ...sessionManifest, lab, experiments: summaries, ledgerPath }, project, artifacts, [
    { id: "research-status", description: "Inspect Research Lab sessions and current head", argv: ["research", "status", project.rootDir, "--lab", id], effect: "read-only" },
  ]);
}
