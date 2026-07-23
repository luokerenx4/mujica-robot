import { createReadStream } from "node:fs";
import { cp, lstat, mkdir, readdir, readFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join, resolve } from "node:path";
import { atomicDirectory, compileAssembly, confined, hashJson, humanObservationDraftSchema, listAssemblyIds, listComponentIds, loadComponent, loadProject, researchReviewSchema, sha256, writeJson, type ResearchReview } from "@mujica/core";

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

async function artifactManifests(root: string): Promise<unknown[]> {
  if (!(await exists(root))) return [];
  const entries = await readdir(root, { withFileTypes: true }); const values: Array<Record<string, any>> = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(root, entry.name, "manifest.json");
    if (entry.isDirectory() && !entry.isSymbolicLink() && await exists(path)) values.push(JSON.parse(await readFile(path, "utf8")));
  }
  return values;
}

async function humanObservationManifests(root: string): Promise<Array<Record<string, any>>> {
  if (!(await exists(root))) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const values: Array<Record<string, any>> = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const directory = join(root, entry.name);
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
    const draft = humanObservationDraftSchema.parse(JSON.parse(await readFile(join(directory, "draft.json"), "utf8")));
    const context = JSON.parse(await readFile(join(directory, "context.json"), "utf8"));
    const { contextHash, ...contextBody } = context;
    const identity = {
      version: manifest.version, kind: manifest.kind, authority: manifest.authority, claimKind: manifest.claimKind,
      observer: manifest.observer, recordedAt: manifest.recordedAt, source: manifest.source, assessment: manifest.assessment,
      contextHash: manifest.contextHash, draftHash: manifest.draftHash,
    };
    if (
      contextHash !== manifest.contextHash
      || hashJson(contextBody) !== contextHash
      || hashJson(draft) !== manifest.draftHash
      || hashJson(identity) !== manifest.observationHash
      || entry.name !== manifest.id
      || manifest.id !== `observation-${manifest.observationHash.slice(0, 16)}`
      || manifest.authority !== "human"
      || manifest.claimKind !== "hypothesis"
      || manifest.completed !== true
    ) throw new Error(`Human observation '${entry.name}' failed integrity verification`);
    values.push(manifest);
  }
  return values;
}

async function definitions(root: string, suffix: string): Promise<unknown[]> {
  if (!(await exists(root))) return [];
  const entries = await readdir(root, { withFileTypes: true }); const values: unknown[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) if (entry.isFile() && entry.name.endsWith(suffix)) values.push(JSON.parse(await readFile(join(root, entry.name), "utf8")));
  return values;
}

async function candidateDefinitions(root: string): Promise<unknown[]> {
  if (!(await exists(root))) return [];
  const entries = await readdir(root, { withFileTypes: true }); const values: unknown[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(root, entry.name, "candidate.json");
    if (entry.isDirectory() && !entry.isSymbolicLink() && await exists(path)) values.push(JSON.parse(await readFile(path, "utf8")));
  }
  return values;
}

async function researchLabDefinitions(root: string): Promise<Array<Record<string, any>>> {
  if (!(await exists(root))) return [];
  const entries = await readdir(root, { withFileTypes: true }); const values: Array<Record<string, any>> = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(root, entry.name, "research.json");
    if (entry.isDirectory() && !entry.isSymbolicLink() && await exists(path)) values.push(JSON.parse(await readFile(path, "utf8")));
  }
  return values;
}

async function researchSessions(root: string): Promise<Array<Record<string, any>>> {
  if (!(await exists(root))) return [];
  const labs = await readdir(root, { withFileTypes: true }); const values: Array<Record<string, any>> = [];
  for (const lab of labs.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!lab.isDirectory() || lab.isSymbolicLink()) continue;
    const sessionsRoot = join(root, lab.name, "sessions");
    if (!(await exists(sessionsRoot))) continue;
    const sessions = await readdir(sessionsRoot, { withFileTypes: true });
    for (const session of sessions.sort((a, b) => a.name.localeCompare(b.name))) {
      const sessionRoot = join(sessionsRoot, session.name); const manifestPath = join(sessionRoot, "manifest.json");
      if (!session.isDirectory() || session.isSymbolicLink() || !(await exists(manifestPath))) continue;
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")); const experiments = [];
      const experimentsRoot = join(sessionRoot, "experiments");
      if (await exists(experimentsRoot)) {
        const entries = await readdir(experimentsRoot, { withFileTypes: true });
        for (const experiment of entries.sort((a, b) => a.name.localeCompare(b.name))) {
          const path = join(experimentsRoot, experiment.name, "manifest.json");
          if (experiment.isDirectory() && !experiment.isSymbolicLink() && await exists(path)) {
            const experimentRoot = join(experimentsRoot, experiment.name);
            const experimentManifest = JSON.parse(await readFile(path, "utf8"));
            let visualReview = null;
            if (experimentManifest.review?.status === "AVAILABLE") {
              const reviewPath = join(experimentRoot, "review.json");
              if (!(await exists(reviewPath))) throw new Error(`Research experiment '${experiment.name}' is missing its available Review`);
              visualReview = researchReviewSchema.parse(JSON.parse(await readFile(reviewPath, "utf8")));
              if (hashJson(visualReview) !== experimentManifest.review.reviewHash) throw new Error(`Research experiment '${experiment.name}' Review hash is invalid`);
            }
            experiments.push({ ...experimentManifest, visualReview });
          }
        }
      }
      values.push({ ...manifest, experiments });
    }
  }
  return values;
}

async function sampledNdjson(path: string, maximum: number): Promise<{ rows: unknown[]; total: number; stride: number }> {
  if (!(await exists(path))) return { rows: [], total: 0, stride: 1 };
  const reader = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  let rows: unknown[] = []; let total = 0; let stride = 1; let last: unknown;
  for await (const line of reader) {
    if (!line.trim()) continue;
    const value = JSON.parse(line); last = value;
    if (total % stride === 0) rows.push(value);
    total++;
    if (rows.length > maximum) { stride *= 2; rows = rows.filter((_, index) => index % 2 === 0); }
  }
  if (last !== undefined && rows.at(-1) !== last) rows.push(last);
  return { rows, total, stride };
}

async function selectedRun(root: string, requested?: string, selectDefault = true) {
  const manifests = await artifactManifests(join(root, "runs")) as Array<Record<string, unknown>>;
  if (!manifests.length || (!requested && !selectDefault)) return { summaries: manifests, selected: null };
  const id = requested ?? String(manifests.at(-1)?.id);
  if (!manifests.some((item) => item.id === id)) throw new Error(`Unknown completed run '${id}'`);
  const directory = join(root, "runs", id);
  const readOptional = async (name: string) => await exists(join(directory, name)) ? JSON.parse(await readFile(join(directory, name), "utf8")) : null;
  return {
    summaries: manifests,
    selected: {
      id, manifest: await readOptional("manifest.json"), metrics: await readOptional("metrics.json"), score: await readOptional("score.json"),
      events: await sampledNdjson(join(directory, "events.ndjson"), 5_000), trajectory: await sampledNdjson(join(directory, "trajectory.ndjson"), 2_000),
    },
  };
}

async function hardwareCaptureSummaries(root: string): Promise<Array<Record<string, any>>> {
  if (!(await exists(root))) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const captures: Array<Record<string, any>> = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const directory = join(root, entry.name);
    const manifestPath = join(directory, "manifest.json");
    const transcriptPath = join(directory, "transcript.ndjson");
    if (!entry.isDirectory() || entry.isSymbolicLink() || !(await exists(manifestPath)) || !(await exists(transcriptPath))) continue;
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const transcript = await readNdjsonWithIndices(transcriptPath);
    const interestingTypes = new Set(["lease-expired", "deadline-rejected", "stopped", "control-rejected"]);
    const interesting = transcript.find(({ row }) => interestingTypes.has(String(row?.message?.type ?? row?.type ?? "")))
      ?? transcript.find(({ row }) => row?.message?.deviceHealth?.faults?.length || row?.message?.deviceHealth?.estopEngaged === true)
      ?? [...transcript].reverse().find(({ row }) => row?.message?.type === "state")
      ?? transcript.at(-1);
    captures.push({
      ...manifest,
      transcriptLength: transcript.length,
      attentionEventIndex: interesting?.index ?? 0,
      attentionEvent: interesting?.row ?? null,
    });
  }
  return captures;
}

async function readNdjsonWithIndices(path: string): Promise<Array<{ index: number; row: Record<string, any> }>> {
  const reader = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  const rows: Array<{ index: number; row: Record<string, any> }> = [];
  for await (const line of reader) if (line.trim()) rows.push({ index: rows.length, row: JSON.parse(line) });
  return rows;
}

type ReplayInput = { path: string; manifest: Record<string, any> };
type ResearchReviewInput = { review: ResearchReview; reviewHash: string };
export type ResearchTimelineInput = {
  labId: string;
  sessionId?: string;
  experimentId?: string;
  selectedKey: string;
  entries: Array<ResearchReviewInput & {
    acceptedReplay: ReplayInput;
    candidateReplay: ReplayInput;
  }>;
};
type HardwareCaptureInput = {
  path: string;
  manifest: Record<string, any>;
  episodeId: string;
  bundle: {
    id: string;
    bundleHash: string;
    sourceKind: string;
    maximumCaptureMode: string;
    assemblyHash: string;
    modelHash: string;
    stateContractHash: string;
    stateContractAuthority: "bundle-frozen" | "derived-from-frozen-model";
  };
  replay: ReplayInput;
};
type TwinAuditInput = {
  path: string;
  manifest: Record<string, any>;
  hardwareCapture: HardwareCaptureInput;
  predictionReplay: ReplayInput;
};
type StudioSnapshotOptions = {
  run?: string;
  replay?: ReplayInput;
  compareRun?: string;
  compareReplay?: ReplayInput;
  researchReview?: ResearchReviewInput;
  researchTimeline?: ResearchTimelineInput;
  hardwareCapture?: HardwareCaptureInput;
  twinAudit?: TwinAuditInput;
};

async function validateReplayInput(replay: ReplayInput): Promise<void> {
  const root = resolve(replay.path); const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Visual replay path must be a real directory");
  const diskManifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  if (hashJson(diskManifest) !== hashJson(replay.manifest)) throw new Error("Visual replay manifest differs from the immutable cache");
  const count = Number(replay.manifest.frameCount);
  if (!Number.isInteger(count) || count < 1 || replay.manifest.framePattern !== "frames/%06d.png") throw new Error("Visual replay frame contract is invalid");
  const frameRoot = join(root, "frames"); const frameStat = await lstat(frameRoot);
  if (!frameStat.isDirectory() || frameStat.isSymbolicLink()) throw new Error("Visual replay frame path must be a real directory");
  const expected = Array.from({ length: count }, (_, index) => `${String(index).padStart(6, "0")}.png`);
  const actual = (await readdir(frameRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort();
  if (hashJson(actual) !== hashJson(expected)) throw new Error("Visual replay frame cache is incomplete");
  if (!Array.isArray(replay.manifest.frameHashes) || replay.manifest.frameHashes.length !== count) throw new Error("Visual replay frame integrity record is incomplete");
  const actualHashes = await Promise.all(expected.map(async (name) => sha256(await readFile(join(frameRoot, name)))));
  if (hashJson(actualHashes) !== hashJson(replay.manifest.frameHashes)) throw new Error("Visual replay frame cache failed integrity verification");
}

async function verifyReplayForRun(replay: ReplayInput | undefined, run: Awaited<ReturnType<typeof selectedRun>>["selected"], label: string): Promise<void> {
  if (!replay) return;
  await validateReplayInput(replay);
  if (!run) throw new Error(`A ${label} visual replay requires a selected completed Run`);
  if (replay.manifest.runId !== run.id) throw new Error(`${label} visual replay Run id does not match the selected Run`);
  if (replay.manifest.resultHash !== run.manifest?.resultHash) throw new Error(`${label} visual replay result hash does not match the selected Run`);
  if (replay.manifest.completed !== true) throw new Error(`${label} visual replay is incomplete`);
}

async function validateHardwareCaptureInput(input: HardwareCaptureInput) {
  const root = resolve(input.path);
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Hardware Capture path must be a real directory");
  const diskManifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  if (hashJson(diskManifest) !== hashJson(input.manifest)) throw new Error("Hardware Capture manifest differs from its verified artifact");
  if (
    typeof input.manifest.id !== "string"
    || typeof input.manifest.captureHash !== "string"
    || typeof input.manifest.bundleHash !== "string"
    || input.manifest.status !== "COMPLETED"
  ) throw new Error("Studio device replay requires a completed immutable Hardware Capture");
  const episode = input.manifest.episodes?.find((item: any) => item.id === input.episodeId);
  if (!episode || episode.completed !== true || typeof episode.path !== "string" || typeof episode.hash !== "string") {
    throw new Error(`Hardware Capture episode '${input.episodeId}' is not a completed immutable episode`);
  }
  const episodePath = confined(root, episode.path);
  const episodeStat = await lstat(episodePath);
  if (!episodeStat.isFile() || episodeStat.isSymbolicLink()) throw new Error("Hardware Capture episode path must be a real file");
  if (sha256(await readFile(episodePath)) !== episode.hash) throw new Error("Hardware Capture episode bytes changed");
  const trajectory = await sampledNdjson(episodePath, 2_000);
  if (!trajectory.total) throw new Error("Hardware Capture episode has no device telemetry");
  for (const [index, value] of trajectory.rows.entries()) {
    const row = value as Record<string, any>;
    if (
      row.episode !== episode.id
      || !Number.isFinite(Number(row.time))
      || !Number.isInteger(Number(row.step))
      || !Array.isArray(row.qpos)
      || !row.qpos.length
      || row.qpos.some((item: unknown) => !Number.isFinite(Number(item)))
      || !Array.isArray(row.qvel)
      || row.qvel.some((item: unknown) => !Number.isFinite(Number(item)))
      || !row.deviceHealth
      || !Array.isArray(row.deviceHealth.faults)
      || typeof row.deviceHealth.estopEngaged !== "boolean"
      || typeof row.deviceHealth.watchdogHealthy !== "boolean"
    ) throw new Error(`Hardware Capture episode row ${index} lacks the required device telemetry contract`);
  }
  if (
    input.bundle.bundleHash !== input.manifest.bundleHash
    || input.bundle.assemblyHash !== input.manifest.assemblyHash
    || input.bundle.modelHash !== input.manifest.modelHash
    || (typeof input.manifest.stateContractHash === "string" && input.bundle.stateContractHash !== input.manifest.stateContractHash)
  ) throw new Error("Hardware Capture and frozen Bundle identities differ");
  await validateReplayInput(input.replay);
  const replay = input.replay.manifest;
  if (
    replay.version !== 2
    || replay.kind !== "mujica-hardware-capture-replay"
    || replay.completed !== true
    || replay.trajectoryHash !== episode.hash
    || replay.assemblyHash !== input.bundle.assemblyHash
    || replay.modelHash !== input.bundle.modelHash
    || replay.source?.kind !== "hardware-capture-episode"
    || replay.source.captureId !== input.manifest.id
    || replay.source.captureHash !== input.manifest.captureHash
    || replay.source.bundleId !== input.bundle.id
    || replay.source.bundleHash !== input.bundle.bundleHash
    || replay.source.episodeId !== episode.id
    || replay.source.episodeHash !== episode.hash
  ) throw new Error("Device telemetry replay differs from its immutable Capture, episode, or frozen Bundle");
  return {
    id: input.manifest.id,
    captureHash: input.manifest.captureHash,
    status: input.manifest.status,
    plan: input.manifest.plan,
    target: input.manifest.target,
    environment: input.manifest.environment,
    device: input.manifest.device,
    operator: input.manifest.operator,
    mode: input.manifest.mode,
    actuationAuthorized: input.manifest.actuationAuthorized,
    bundleHash: input.manifest.bundleHash,
    assembly: input.manifest.assembly,
    assemblyHash: input.manifest.assemblyHash,
    controller: input.manifest.controller,
    episode,
    trajectory,
    bundle: input.bundle,
    authorityBoundary: {
      kinematics: "device-reported",
      geometry: "bundle-frozen-digital-twin",
      visualGroundTruth: false,
      cameraOrMotionCapture: false,
      physicalContactTruth: "reported-telemetry-only",
      hardwareVerification: "unchanged",
      calibrationAuthority: "unchanged",
      actuationAuthority: "unchanged",
    },
  };
}

async function validateTwinAuditInput(input: TwinAuditInput, capture: Awaited<ReturnType<typeof validateHardwareCaptureInput>>) {
  const root = resolve(input.path);
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Digital Twin Audit path must be a real directory");
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  if (hashJson(manifest) !== hashJson(input.manifest)) throw new Error("Digital Twin Audit manifest differs from its verified artifact");
  if (manifest.kind !== "mujica-digital-twin-audit" || manifest.version !== 1 || manifest.completed !== true) {
    throw new Error("Studio requires a completed Digital Twin Audit");
  }
  for (const [field, name] of [
    ["transitionsHash", "transitions.ndjson"],
    ["predictionHash", "prediction.ndjson"],
    ["summaryHash", "summary.json"],
    ["requestHash", "request.json"],
    ["reportHash", "report.md"],
  ] as const) {
    if (sha256(await readFile(join(root, name))) !== manifest[field]) throw new Error(`Digital Twin Audit ${name} bytes changed`);
  }
  if (
    manifest.identity?.source?.captureId !== capture.id
    || manifest.identity.source.captureHash !== capture.captureHash
    || manifest.identity.source.episodeId !== capture.episode.id
    || manifest.identity.source.episodeHash !== capture.episode.hash
    || manifest.identity.source.bundleId !== capture.bundle.id
    || manifest.identity.source.bundleHash !== capture.bundle.bundleHash
    || manifest.identity.assemblyHash !== capture.assemblyHash
    || manifest.identity.modelHash !== capture.bundle.modelHash
    || manifest.identity.stateContractHash !== capture.bundle.stateContractHash
  ) throw new Error("Digital Twin Audit differs from its Capture, episode, or frozen Bundle");
  const summary = JSON.parse(await readFile(join(root, "summary.json"), "utf8"));
  const transitions = await readNdjsonWithIndices(join(root, "transitions.ndjson"));
  const prediction = await sampledNdjson(join(root, "prediction.ndjson"), 2_000);
  if (transitions.length !== manifest.transitionCount || summary.transitionCount !== manifest.transitionCount || prediction.total !== transitions.length + 1) {
    throw new Error("Digital Twin Audit transition contract is inconsistent");
  }
  await validateReplayInput(input.predictionReplay);
  const replay = input.predictionReplay.manifest;
  if (
    replay.kind !== "mujica-digital-twin-prediction-replay"
    || replay.version !== 1
    || replay.completed !== true
    || replay.trajectoryHash !== manifest.predictionHash
    || replay.modelHash !== capture.bundle.modelHash
    || replay.assemblyHash !== capture.assemblyHash
    || replay.source?.kind !== "digital-twin-audit-prediction"
    || replay.source.auditId !== manifest.id
    || replay.source.auditHash !== manifest.auditHash
    || replay.source.captureId !== capture.id
    || replay.source.bundleId !== capture.bundle.id
  ) throw new Error("Digital Twin prediction replay differs from its immutable Audit");
  return {
    id: manifest.id,
    auditHash: manifest.auditHash,
    manifest,
    summary,
    transitions: transitions.map((item) => item.row),
    prediction,
    authorityBoundary: summary.authority,
  };
}

export async function buildStudioSnapshot(projectDirectory: string, options: StudioSnapshotOptions = {}) {
  const project = await loadProject(projectDirectory); const assemblies = [];
  for (const id of await listAssemblyIds(project.rootDir)) {
    const assembly = await compileAssembly(project.rootDir, id);
    assemblies.push({
      id, name: assembly.name, hash: assembly.assemblyHash, totalMassKg: assembly.totalMassKg, componentCost: assembly.componentCost,
      components: assembly.components, observationContract: assembly.observationContract, actionContract: assembly.actionContract,
    });
  }
  const components = [];
  for (const id of await listComponentIds(project.rootDir)) { const component = await loadComponent(project.rootDir, id); components.push({ ...component.manifest, hash: component.hash }); }
  if (options.hardwareCapture && options.twinAudit) throw new Error("Studio accepts one Hardware Capture projection mode");
  const selectedCaptureInput = options.twinAudit?.hardwareCapture ?? options.hardwareCapture;
  const captureMode = Boolean(selectedCaptureInput);
  if (captureMode && (options.run || options.replay || options.compareRun || options.compareReplay || options.researchReview || options.researchTimeline)) {
    throw new Error("A device telemetry Studio snapshot cannot mix Hardware Capture and simulation Run selectors");
  }
  const runs = await selectedRun(project.rootDir, options.run, !captureMode);
  const comparison = options.compareRun ? await selectedRun(project.rootDir, options.compareRun) : { summaries: runs.summaries, selected: null };
  if (options.compareReplay && !options.compareRun) throw new Error("A comparison visual replay requires --compare-run");
  await verifyReplayForRun(options.replay, runs.selected, "primary");
  await verifyReplayForRun(options.compareReplay, comparison.selected, "comparison");
  const selectedResearchReview = options.researchReview
    ? { review: researchReviewSchema.parse(options.researchReview.review), reviewHash: options.researchReview.reviewHash }
    : null;
  if (selectedResearchReview && (
    hashJson(selectedResearchReview.review) !== selectedResearchReview.reviewHash
    || selectedResearchReview.review.accepted.id !== runs.selected?.id
    || selectedResearchReview.review.candidate.id !== comparison.selected?.id
    || selectedResearchReview.review.accepted.resultHash !== runs.selected?.manifest?.resultHash
    || selectedResearchReview.review.candidate.resultHash !== comparison.selected?.manifest?.resultHash
  )) throw new Error("Selected Research Review differs from its immutable Run pair");
  const researchTimelineEntries = [];
  if (options.researchTimeline) {
    if (!options.researchTimeline.entries.length) throw new Error("Research Timeline requires at least one available Review");
    for (const entry of options.researchTimeline.entries) {
      const review = researchReviewSchema.parse(entry.review);
      const reviewHash = entry.reviewHash;
      const key = `${review.lineage.sessionId}/${review.lineage.experimentId}`;
      if (
        hashJson(review) !== reviewHash
        || review.lineage.researchId !== options.researchTimeline.labId
        || (options.researchTimeline.sessionId && review.lineage.sessionId !== options.researchTimeline.sessionId)
        || (options.researchTimeline.experimentId && review.lineage.experimentId !== options.researchTimeline.experimentId)
      ) throw new Error(`Research Timeline Review '${key}' differs from its requested scope`);
      const accepted = await selectedRun(project.rootDir, review.accepted.id);
      const candidate = await selectedRun(project.rootDir, review.candidate.id);
      await verifyReplayForRun(entry.acceptedReplay, accepted.selected, `Research Timeline accepted '${key}'`);
      await verifyReplayForRun(entry.candidateReplay, candidate.selected, `Research Timeline candidate '${key}'`);
      if (
        accepted.selected?.manifest?.resultHash !== review.accepted.resultHash
        || candidate.selected?.manifest?.resultHash !== review.candidate.resultHash
      ) throw new Error(`Research Timeline Review '${key}' differs from its immutable Run pair`);
      researchTimelineEntries.push({
        key,
        review,
        reviewHash,
        acceptedRun: accepted.selected,
        candidateRun: candidate.selected,
        acceptedReplay: { ...entry.acceptedReplay.manifest, frameBase: `research-replays/${review.accepted.id}/frames` },
        candidateReplay: { ...entry.candidateReplay.manifest, frameBase: `research-replays/${review.candidate.id}/frames` },
      });
    }
    if (!researchTimelineEntries.some((entry) => entry.key === options.researchTimeline?.selectedKey)) {
      throw new Error(`Research Timeline selected iteration '${options.researchTimeline.selectedKey}' is unavailable`);
    }
    const duplicateKeys = researchTimelineEntries.map((entry) => entry.key);
    if (new Set(duplicateKeys).size !== duplicateKeys.length) throw new Error("Research Timeline contains duplicate Reviews");
    const selectedTimelineEntry = researchTimelineEntries.find((entry) => entry.key === options.researchTimeline?.selectedKey);
    if (
      !selectedResearchReview
      || selectedTimelineEntry?.reviewHash !== selectedResearchReview.reviewHash
      || selectedTimelineEntry.acceptedRun?.id !== runs.selected?.id
      || selectedTimelineEntry.candidateRun?.id !== comparison.selected?.id
    ) throw new Error("Research Timeline default selection differs from the selected Research Review");
  }
  const selectedHardwareCapture = selectedCaptureInput
    ? await validateHardwareCaptureInput(selectedCaptureInput)
    : null;
  const selectedTwinAudit = options.twinAudit && selectedHardwareCapture
    ? await validateTwinAuditInput(options.twinAudit, selectedHardwareCapture)
    : null;
  return {
    version: 8, kind: "mujica-studio-snapshot", renderer: { id: "mujica-studio-offline-v1", sourceHash: sha256(studioHtml.toString()) }, project: project.manifest,
    selectedAssembly: selectedHardwareCapture?.assembly ?? project.manifest.defaults.assembly, assemblies, components,
    runs: runs.summaries, selectedRun: runs.selected,
    selectedReplay: options.replay ? { ...options.replay.manifest, frameBase: "replay/frames" } : null,
    comparisonRun: comparison.selected,
    comparisonReplay: options.compareReplay ? { ...options.compareReplay.manifest, frameBase: "comparison-replay/frames" } : null,
    selectedResearchReview,
    researchTimeline: options.researchTimeline ? {
      labId: options.researchTimeline.labId,
      sessionId: options.researchTimeline.sessionId ?? null,
      experimentId: options.researchTimeline.experimentId ?? null,
      selectedKey: options.researchTimeline.selectedKey,
      entries: researchTimelineEntries,
    } : null,
    selectedHardwareCapture,
    selectedHardwareReplay: selectedCaptureInput ? { ...selectedCaptureInput.replay.manifest, frameBase: "hardware-replay/frames" } : null,
    selectedTwinAudit,
    selectedTwinReplay: options.twinAudit ? { ...options.twinAudit.predictionReplay.manifest, frameBase: "twin-replay/frames" } : null,
    policies: await artifactManifests(join(project.rootDir, "policies")),
    trainingRuns: await artifactManifests(join(project.rootDir, "training-runs")),
    hardwareBundles: await artifactManifests(join(project.rootDir, "hardware-bundles")),
    hardwareVerifications: await artifactManifests(join(project.rootDir, "hardware-verifications")),
    hardwareCaptures: await hardwareCaptureSummaries(join(project.rootDir, "hardware-captures")),
    humanObservations: await humanObservationManifests(join(project.rootDir, "human-observations")),
    researchBriefs: await artifactManifests(join(project.rootDir, "research-briefs")),
    benchmarks: await definitions(join(project.rootDir, "benchmarks"), ".benchmark.json"),
    candidates: await candidateDefinitions(join(project.rootDir, "candidates")),
    revisions: await artifactManifests(join(project.rootDir, "revisions")),
    policyRevisions: await artifactManifests(join(project.rootDir, "policy-revisions")),
    researchLabs: await researchLabDefinitions(join(project.rootDir, "research")),
    researchSessions: await researchSessions(join(project.rootDir, "research-runs")),
  };
}

function studioHtml(snapshot: Awaited<ReturnType<typeof buildStudioSnapshot>>): string {
  const data = JSON.stringify(snapshot).replaceAll("<", "\\u003c");
  const title = snapshot.project.name.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:">
<title>Mujica Studio — ${title}</title>
<style>
:root{color-scheme:dark;--bg:#0b1015;--panel:#121a22;--line:#263442;--muted:#8ea0af;--text:#edf4f8;--a:#65d6ad;--b:#efc66b;--bad:#ff7b72}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}header{padding:22px 28px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:20px}h1,h2,h3{margin:0 0 10px;font-weight:600}h1{font-size:20px}h2{font-size:15px;color:var(--a)}h3{font-size:13px}.muted{color:var(--muted)}main{display:grid;grid-template-columns:minmax(360px,1.3fr) minmax(320px,.7fr);gap:14px;padding:14px}.panel{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:14px;min-width:0}.wide{grid-column:1/-1}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px}.stat{border:1px solid var(--line);padding:10px;border-radius:6px}.stat strong{display:block;font-size:18px;color:var(--b)}select,input,button,textarea{font:inherit;color:var(--text);background:#0d151c;border:1px solid var(--line);border-radius:5px;padding:7px}button{cursor:pointer}button:hover{border-color:var(--a)}button:disabled{cursor:not-allowed;opacity:.5}textarea{width:100%;min-height:76px;resize:vertical}.field{display:grid;gap:4px}.form-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.form-grid .span-all{grid-column:1/-1}.source-chip{padding:9px;border:1px solid var(--line);border-radius:6px;background:#0d151c}.attention-row{display:grid;grid-template-columns:auto 1fr;gap:9px;padding:9px;border-bottom:1px solid var(--line);cursor:pointer}.attention-row:hover{background:#17232d}.severity-blocking{color:var(--bad);border-color:var(--bad)}.severity-investigate{color:var(--b);border-color:var(--b)}.severity-info{color:var(--a);border-color:var(--a)}.timeline-layout{display:grid;grid-template-columns:minmax(310px,.85fr) minmax(360px,1.15fr);gap:12px;margin-top:10px}.timeline-list{max-height:430px;overflow:auto}.iteration{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:start;padding:10px;border:1px solid var(--line);border-radius:6px;margin:7px 0;background:#0d151c}.iteration.active{border-color:var(--a);box-shadow:inset 3px 0 var(--a)}.iteration .sequence{font-size:18px;color:var(--b);min-width:32px}.iteration button{white-space:nowrap}.timeline-filters{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.timeline-detail{min-height:160px}.verdict-KEEP{color:var(--a)}.verdict-REVERT{color:var(--b)}.verdict-CRASH{color:var(--bad)}canvas{width:100%;height:300px;background:#090e12;border:1px solid var(--line);border-radius:6px}.controls{display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap}.controls input{flex:1;min-width:160px}.split,.comparison-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.replay-card{min-width:0}.replay-card h3 .tag{float:right}.list{max-height:340px;overflow:auto}.row{padding:7px 0;border-bottom:1px solid var(--line);word-break:break-word}.row.seek{cursor:pointer}.row.seek:hover{background:#17232d}.tag{display:inline-block;border:1px solid var(--line);border-radius:10px;padding:1px 7px;margin:2px;color:var(--muted)}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:5px;border-bottom:1px solid var(--line)}code{color:var(--b)}.replay-stage{position:relative;background:#05080b;border:1px solid var(--line);border-radius:7px;overflow:hidden;aspect-ratio:4/3;display:grid;place-items:center}.replay-stage img{display:block;width:100%;height:100%;object-fit:contain}.replay-stage .missing{padding:30px;text-align:center;color:var(--muted)}.live-badge{position:absolute;left:10px;top:10px;background:#07110dcc;border:1px solid var(--a);color:var(--a);border-radius:11px;padding:2px 8px}.telemetry{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.telemetry .cell{border:1px solid var(--line);border-radius:5px;padding:7px}.telemetry strong{display:block;color:var(--b);font-size:12px}.ok{color:var(--a)}.bad{color:var(--bad)}.delta-good{color:var(--a)}.delta-bad{color:var(--bad)}#copy-status,#observation-status{min-height:20px}@media(max-width:850px){main{grid-template-columns:1fr}.split,.comparison-grid,.form-grid,.timeline-layout,.timeline-filters{grid-template-columns:1fr}.form-grid .span-all,.wide{grid-column:1}}
</style></head><body><header><div><h1>Mujica Studio</h1><div>${title} · read-only evidence debugger</div></div><div class="muted">Source of truth: project files and immutable artifacts<br>No editing or evaluation occurs in Studio</div></header>
<main><section class="panel wide" id="research-cockpit" hidden><h2>Training Cockpit · Research Timeline</h2><div class="muted">Choose an iteration by outcome and training meaning. Reviewed iterations load synchronized accepted ↔ candidate MuJoCo evidence; legacy iterations remain metrics-only.</div><div class="stats" id="research-progress-stats"></div><div class="timeline-layout"><div><div class="timeline-filters"><label class="field">Session<select id="timeline-session"></select></label><label class="field">Outcome<select id="timeline-outcome"><option value="ALL">All outcomes</option><option>KEEP</option><option>REVERT</option><option>CRASH</option></select></label><label class="field">Sort<select id="timeline-sort"><option value="chronological">Chronological</option><option value="latest">Latest first</option><option value="score">Best score Δ</option><option value="violations">Fewest violations</option></select></label></div><div class="timeline-list" id="timeline-list"></div></div><div><h3>Selected iteration</h3><div class="source-chip timeline-detail" id="timeline-detail"></div><div class="muted" id="timeline-guidance">Selection changes only this read-only evidence view.</div></div></div></section>
<section class="panel wide" id="artifact-stats"><div class="stats" id="stats"></div></section>
<section class="panel wide"><h2>Attention queue</h2><div class="muted" id="attention-guidance">Measured failures first, then human hypotheses. Click a Run event to seek; click a Capture to bind an observation draft to its exact protocol event.</div><div class="list" id="attention"></div></section>
<section class="panel wide"><h2 id="replay-heading">Authoritative MuJoCo replay comparison</h2><div class="comparison-grid" id="replay-grid"><div class="replay-card"><h3 id="primary-heading">Baseline <span class="tag">A</span></h3><div class="replay-stage"><img id="replay-image" alt="Baseline MuJoCo robot replay"><div class="missing" id="replay-missing">No authoritative visual replay.</div><span class="live-badge" id="health">—</span></div><div id="frame-a">—</div><div class="telemetry" id="telemetry-a"></div></div><div class="replay-card" id="comparison-card"><h3 id="comparison-heading">Subject <span class="tag">B</span></h3><div class="replay-stage"><img id="comparison-image" alt="Subject MuJoCo robot replay"><div class="missing" id="comparison-missing">Choose --compare-run to add a subject.</div><span class="live-badge" id="comparison-health">—</span></div><div id="frame-b">—</div><div class="telemetry" id="telemetry-b"></div></div></div><div class="controls"><button id="previous" title="Previous shared time">◀</button><button id="play">Play</button><button id="next" title="Next shared time">▶</button><input id="scrub" type="range" min="0" value="0"><select id="speed" title="Playback speed"><option value=".25">0.25×</option><option value=".5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div><div id="frame">—</div><div class="muted" id="replay-status"></div><div class="controls"><button id="copy-frame">Copy comparison context for Agent</button></div><div class="muted" id="copy-status"></div></section>
<section class="panel wide" id="device-provenance" hidden><h2>Device telemetry projection boundary</h2><div class="source-chip" id="device-provenance-detail"></div><div class="muted">This view is reconstructed from device-reported kinematics through the exact frozen Hardware Bundle. It is not camera footage, motion capture, physical contact truth, or proof of calibration. Hardware verification and actuation authority do not change.</div></section>
<section class="panel wide" id="twin-residual" hidden><h2>Selected one-step residual</h2><div class="stats" id="twin-residual-stats"></div><div class="source-chip" id="twin-residual-detail"></div></section>
<section class="panel wide" id="research-review-provenance"><h2>Research Review provenance</h2><div id="selected-research-review" class="source-chip">This Run pair is not bound to a Research Review.</div><div class="controls"><button id="copy-selected-review">Copy complete Research Review context</button></div><div class="muted" id="selected-review-status">Visual interpretation remains a human hypothesis; the locked Judge verdict is unchanged.</div></section>
<section class="panel wide"><h2>Human observation → Agent hypothesis</h2><div class="muted">This records what a person sees; it never becomes measured evidence or a Judge verdict.</div><div class="source-chip" id="observation-source">Current Run frame</div><div class="controls"><button id="use-current-frame">Use current replay frame</button></div><div class="form-grid"><label class="field">Category<select id="observation-category"><option>motion</option><option>stability</option><option>contact</option><option>control</option><option>timing</option><option>safety</option><option>other</option></select></label><label class="field">Severity<select id="observation-severity"><option>investigate</option><option>info</option><option>blocking</option></select></label><label class="field">Confidence<select id="observation-confidence"><option>medium</option><option>low</option><option>high</option></select></label><label class="field span-all">Summary<input id="observation-summary" maxlength="240" placeholder="What did you see?"></label><label class="field span-all">Details<textarea id="observation-details" maxlength="2000" placeholder="Describe the visible pattern and when it begins."></textarea></label><label class="field span-all">Suggested next action<input id="observation-next" maxlength="500" placeholder="What should the Agent inspect before changing code?"></label></div><div class="controls"><button id="copy-observation">Copy observation draft</button><button id="download-observation">Download draft JSON</button></div><div class="muted" id="observation-status">Record with <code>mujica observation record . --input draft.json --observer NAME</code>.</div></section>
<section class="panel"><h2 id="evidence-heading">Run evidence</h2><div id="run"></div></section>
<section class="panel"><h2>Top-down path</h2><canvas id="trajectory" width="900" height="420"></canvas><div class="muted" id="sampling"></div></section>
<section class="panel"><h2 id="metrics-heading">Motion-quality deltas</h2><table id="metrics"></table><div class="muted" id="metrics-note">Delta is subject − baseline; lower is better for every quality burden.</div></section>
<section class="panel"><h2>Assembly and contracts</h2><select id="assembly"></select><div id="assembly-detail"></div></section>
<section class="panel"><h2>Event timeline</h2><div class="list" id="events"></div></section>
<section class="panel wide"><div class="split"><div><h2>Hardware Captures</h2><div class="list" id="captures"></div></div><div><h2>Human observations</h2><div class="list" id="human-observations"></div></div></div></section>
<section class="panel wide"><h2>Human hypothesis → governed Research Brief</h2><div class="muted">Select one recorded observation and one explicit Lab. This handoff only prioritizes investigation; the Lab source closure, budgets, regression Benchmarks, and locked Judge remain authoritative.</div><div class="form-grid"><label class="field">Recorded observation<select id="brief-observation"></select></label><label class="field">Research Lab<select id="brief-lab"></select></label><div class="field"><span>Headless handoff</span><button id="copy-research-brief">Copy Research Brief command</button></div></div><div class="source-chip" id="brief-source">Record a human observation before preparing a Research Brief.</div><div class="muted" id="brief-status">Studio copies an exact command; only the CLI publishes the immutable Brief.</div></section>
<section class="panel wide"><h2>Research Lab ledger</h2><div class="split"><div><h3>Source-governed Labs</h3><div class="list" id="research-labs"></div></div><div><h3>Immutable experiment Sessions</h3><div class="list" id="research-sessions"></div></div></div></section>
<section class="panel wide"><div class="split"><div><h2>Robot Revision lineage</h2><div class="list" id="revisions"></div></div><div><h2>Training and Policy artifacts</h2><div class="list" id="training"></div></div></div></section>
<section class="panel wide"><div class="split"><div><h2>Locked Benchmark definitions</h2><div class="list" id="benchmarks"></div></div><div><h2>Development Candidates</h2><div class="list" id="candidates"></div></div></div></section></main>
<script>const S=${data};const q=s=>document.querySelector(s), esc=v=>String(v??'—').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
if(false){const selected=S.selectedRun, replay=S.selectedReplay, trajectory=selected?.trajectory.rows??[], replayFrames=replay?.frameCount??trajectory.length;q('#stats').innerHTML=[['Assemblies',S.assemblies.length],['Components',S.components.length],['Runs',S.runs.length],['Rendered frames',replay?.frameCount??0],['Policies',S.policies.length],['Research Labs',S.researchLabs.length],['Experiments',S.researchSessions.reduce((n,s)=>n+s.experiments.length,0)],['Robot revisions',S.revisions.length]].map(x=>'<div class="stat"><strong>'+x[1]+'</strong>'+x[0]+'</div>').join('');
q('#run').innerHTML=selected?'<div class="row"><code>'+esc(selected.id)+'</code></div><div class="row">seed '+esc(selected.manifest?.seed)+' · result '+esc(selected.manifest?.resultHash?.slice?.(0,12))+'</div>'+(replay?'<div class="row">visual replay <code>'+esc(replay.id)+'</code></div>':''):'<div class="muted">No completed simulation run.</div>';const metric=selected?.metrics??{};q('#metrics').innerHTML=Object.entries(metric).filter(([,v])=>typeof v==='number'||typeof v==='string'||typeof v==='boolean').map(([k,v])=>'<tr><td>'+esc(k)+'</td><td>'+esc(typeof v==='number'?Number(v).toFixed(4):v)+'</td></tr>').join('');
const sel=q('#assembly');sel.innerHTML=S.assemblies.map(a=>'<option '+(a.id===S.selectedAssembly?'selected':'')+' value="'+esc(a.id)+'">'+esc(a.id)+'</option>').join('');function showAssembly(){const a=S.assemblies.find(x=>x.id===sel.value);q('#assembly-detail').innerHTML='<div class="row">hash <code>'+esc(a.hash.slice(0,16))+'</code><br>mass '+a.totalMassKg.toFixed(3)+' kg · component cost '+a.componentCost+'</div><h3>Components</h3><div>'+a.components.map(c=>'<div class="row"><span class="tag">'+esc(c.componentId)+'</span> <code>'+esc(JSON.stringify(c.config||{}))+'</code></div>').join('')+'</div><h3>Observation '+a.observationContract.size+'</h3><div>'+a.observationContract.channels.map(c=>'<span class="tag">'+esc(c.name)+' ['+c.size+']</span>').join('')+'</div><h3>Action '+a.actionContract.size+'</h3><div>'+a.actionContract.channels.map(c=>'<span class="tag">'+esc(c.name)+' ['+c.size+']</span>').join('')+'</div>'}sel.onchange=showAssembly;showAssembly();
q('#events').innerHTML=(selected?.events.rows??[]).map((e,i)=>'<div class="row seek" data-event-index="'+i+'" title="Seek replay to this Event"><code>'+Number(e.time??0).toFixed(3)+'s</code> '+esc(e.type)+'<div class="muted">'+esc(JSON.stringify(e))+'</div></div>').join('')||'<div class="muted">No events.</div>';q('#revisions').innerHTML=S.revisions.map(r=>'<div class="row"><code>'+esc(r.id)+'</code><br><span class="muted">'+esc(r.parent??'root')+' → score '+esc(Number(r.aggregateScore).toFixed(4))+'</span></div>').join('');q('#training').innerHTML=S.policyRevisions.map(r=>'<div class="row">Policy revision <code>'+esc(r.id)+'</code><br><span class="muted">'+esc(r.policyId)+'</span></div>').join('')+S.trainingRuns.slice(-8).map(r=>'<div class="row">Training <code>'+esc(r.id)+'</code><br><span class="muted">'+esc(r.policyId)+'</span></div>').join('');
q('#research-labs').innerHTML=S.researchLabs.map(l=>'<div class="row"><code>'+esc(l.id)+'</code> <span class="tag">'+esc(l.execution.kind)+'</span><br><span class="muted">'+esc(l.benchmark)+' · editable '+l.editable.paths.map(esc).join(', ')+'</span></div>').join('')||'<div class="muted">No Research Labs.</div>';q('#research-sessions').innerHTML=S.researchSessions.slice().reverse().map(s=>'<div class="row"><code>'+esc(s.id)+'</code> <span class="tag">'+esc(s.completed?'COMPLETE':'INCOMPLETE')+'</span><br><span class="muted">'+esc(s.researchId)+' · '+s.iterationsCompleted+'/'+s.iterationsRequested+' experiments · score '+Number(s.initialScore).toFixed(4)+' → '+Number(s.finalScore).toFixed(4)+'</span>'+s.experiments.map(e=>'<div class="row"><span class="tag" style="color:'+(e.verdict==='KEEP'?'var(--a)':e.verdict==='REVERT'?'var(--b)':'var(--bad)')+'">'+esc(e.verdict)+'</span> <code>'+esc(e.id)+'</code> Δ '+Number(e.delta??0).toFixed(4)+'<br><span class="muted">'+esc(e.proposal?.hypothesis??'No proposal')+(e.decision?.gateReasons?.length?' · '+e.decision.gateReasons.map(esc).join(' · '):'')+'</span></div>').join('')+'</div>').join('')||'<div class="muted">No completed research Sessions.</div>';
q('#benchmarks').innerHTML=S.benchmarks.map(b=>'<div class="row"><code>'+esc(b.id)+'</code><br><span class="muted">'+esc(b.objective)+' · '+b.cases.length+' fixed cases · baseline '+esc(b.baseline.assembly)+'/'+esc(b.baseline.controller)+'</span></div>').join('');q('#candidates').innerHTML=S.candidates.map(c=>'<div class="row"><code>'+esc(c.id)+'</code> <span class="tag">'+esc(c.kind)+'</span><br><span class="muted">'+esc(c.baseline.assembly)+'/'+esc(c.baseline.controller)+' → '+esc(c.proposed.assembly)+'/'+esc(c.proposed.controller)+'</span></div>').join('');
const canvas=q('#trajectory'),ctx=canvas.getContext('2d'),scrub=q('#scrub'),frame=q('#frame'),image=q('#replay-image'),missing=q('#replay-missing'),health=q('#health');scrub.max=Math.max(0,replayFrames-1);let timer=null,currentFrame=0;
const pad=i=>String(i).padStart(6,'0'), vector=v=>Array.isArray(v)?v.map(x=>Number(x).toFixed(3)).join(', '):'—', nearest=(values,time)=>{let best=0,delta=Infinity;values.forEach((value,index)=>{const next=Math.abs(Number(value)-time);if(next<delta){delta=next;best=index}});return best}, frameTime=i=>replay?.frameTimes?.[i]??trajectory[i]?.time??0, trajectoryIndex=i=>trajectory.length?nearest(trajectory.map(row=>row.time),frameTime(i)):0, eventFrame=time=>replay?.frameTimes?.length?nearest(replay.frameTimes,Number(time)):trajectory.length?nearest(trajectory.map(row=>row.time),Number(time)):0;
function drawPath(index){ctx.clearRect(0,0,canvas.width,canvas.height);if(!trajectory.length){ctx.fillStyle='#8ea0af';ctx.fillText('No trajectory selected',30,40);return}const pts=trajectory.map(r=>[r.qpos?.[0]??0,r.qpos?.[1]??0]),xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys),span=Math.max(maxX-minX,maxY-minY,.25),map=p=>[60+(p[0]-minX)/span*(canvas.width-120),canvas.height-60-(p[1]-minY)/span*(canvas.height-120)];ctx.strokeStyle='#263442';ctx.lineWidth=1;for(let n=0;n<9;n++){let p=60+n*(canvas.width-120)/8;ctx.beginPath();ctx.moveTo(p,40);ctx.lineTo(p,canvas.height-40);ctx.stroke()}ctx.strokeStyle='#334756';ctx.lineWidth=2;ctx.beginPath();pts.forEach((p,n)=>{let m=map(p);n?ctx.lineTo(...m):ctx.moveTo(...m)});ctx.stroke();ctx.strokeStyle='#65d6ad';ctx.lineWidth=4;ctx.beginPath();pts.slice(0,index+1).forEach((p,n)=>{let m=map(p);n?ctx.lineTo(...m):ctx.moveTo(...m)});ctx.stroke();let m=map(pts[index]);ctx.fillStyle=trajectory[index].healthy===false?'#ff7b72':'#efc66b';ctx.beginPath();ctx.arc(...m,8,0,Math.PI*2);ctx.fill()}
function telemetry(row){const peak=Math.max(0,...(row?.action??[]).map(x=>Math.abs(Number(x))));const cells=[['Simulation time',Number(row?.time??0).toFixed(3)+' s'],['Step',row?.step??'—'],['Pitch',Number(row?.pitchRad??0).toFixed(3)+' rad'],['Body tilt',Number(row?.bodyTiltRad??0).toFixed(3)+' rad'],['Command',vector(row?.motionCommand)],['Measured motion',vector(row?.measuredMotion)],['Foot contact force',vector(row?.footContactForce)],['Peak applied action',peak.toFixed(3)]];q('#frame-telemetry').innerHTML=cells.map(x=>'<div class="cell"><strong>'+esc(x[0])+'</strong>'+esc(x[1])+'</div>').join('');health.textContent=row?.healthy===false?'UNHEALTHY':'HEALTHY';health.className='live-badge '+(row?.healthy===false?'bad':'ok')}
function render(i){currentFrame=Math.max(0,Math.min(replayFrames-1,Number(i)||0));const rowIndex=trajectoryIndex(currentFrame),row=trajectory[rowIndex];if(replay){image.hidden=false;missing.hidden=true;image.src=replay.frameBase+'/'+pad(currentFrame)+'.png';const preload=new Image();preload.src=replay.frameBase+'/'+pad(Math.min(replayFrames-1,currentFrame+1))+'.png'}else{image.hidden=true;missing.hidden=false}scrub.value=String(currentFrame);frame.textContent='rendered frame '+(currentFrame+1)+' / '+replayFrames+' · simulation step '+esc(row?.step)+' · '+Number(frameTime(currentFrame)).toFixed(3)+'s';telemetry(row);drawPath(rowIndex)}
function pause(){if(timer){clearTimeout(timer);timer=null}q('#play').textContent='Play'}function advance(){if(currentFrame>=replayFrames-1){pause();return}const from=frameTime(currentFrame),to=frameTime(currentFrame+1),speed=Number(q('#speed').value)||1;render(currentFrame+1);timer=setTimeout(advance,Math.max(8,1000*Math.max(.001,to-from)/speed))}q('#play').onclick=()=>{if(timer){pause();return}q('#play').textContent='Pause';advance()};q('#previous').onclick=()=>{pause();render(currentFrame-1)};q('#next').onclick=()=>{pause();render(currentFrame+1)};scrub.oninput=()=>{pause();render(Number(scrub.value))};
document.querySelectorAll('[data-event-index]').forEach(node=>node.onclick=()=>{pause();const event=selected.events.rows[Number(node.dataset.eventIndex)];render(eventFrame(event.time??0))});document.addEventListener('keydown',event=>{if(event.target?.matches?.('input,select,textarea'))return;if(event.key==='ArrowLeft'){event.preventDefault();q('#previous').click()}else if(event.key==='ArrowRight'){event.preventDefault();q('#next').click()}else if(event.key===' '){event.preventDefault();q('#play').click()}});
q('#copy-frame').onclick=async()=>{const row=trajectory[trajectoryIndex(currentFrame)]??null,events=(selected?.events.rows??[]).filter(event=>Math.abs(Number(event.time??0)-Number(row?.time??0))<=.011),context={kind:'mujica-frame-context',runId:selected?.id,resultHash:selected?.manifest?.resultHash,replayId:replay?.id??null,replayFrame:currentFrame,simulationStep:row?.step??null,timeSeconds:row?.time??null,healthy:row?.healthy??null,pitchRad:row?.pitchRad??null,bodyTiltRad:row?.bodyTiltRad??null,motionCommand:row?.motionCommand??null,measuredMotion:row?.measuredMotion??null,footContactForce:row?.footContactForce??null,action:row?.action??null,events};const text=JSON.stringify(context,null,2);try{await navigator.clipboard.writeText(text);q('#copy-status').textContent='Copied exact Run/frame context. Paste it to your Coding Agent.'}catch{const area=document.createElement('textarea');area.value=text;document.body.appendChild(area);area.select();document.execCommand('copy');area.remove();q('#copy-status').textContent='Copied frame context.'}};
q('#replay-status').textContent=replay?replay.renderer+' · MuJoCo '+replay.mujocoVersion+' · '+replay.frameCount+' exact qpos frames · '+replay.settings.width+'×'+replay.settings.height:'Generate this Run again with mujica studio to add an authoritative MuJoCo replay.';q('#sampling').textContent=selected?'trajectory '+selected.trajectory.total+' rows · displayed '+trajectory.length+' · stride '+selected.trajectory.stride:'';render(0);}

const RT=S.researchTimeline??null,timelineEntries=RT?.entries??[],timelineParams=new URLSearchParams(location.hash.slice(1));
const activeTimelineEntry=timelineEntries.find(entry=>entry.key===timelineParams.get('iteration'))??timelineEntries.find(entry=>entry.key===RT?.selectedKey)??null;
const H=S.selectedHardwareCapture??null,T=S.selectedTwinAudit??null;
const A=H
  ? {run:null,hardware:H,replay:S.selectedHardwareReplay,trajectory:H.trajectory.rows}
  : activeTimelineEntry
  ? {run:activeTimelineEntry.acceptedRun,hardware:null,replay:activeTimelineEntry.acceptedReplay}
  : {run:S.selectedRun,hardware:null,replay:S.selectedReplay};
const B=T
  ? {run:null,hardware:null,twin:T,replay:S.selectedTwinReplay,trajectory:T.prediction.rows}
  : activeTimelineEntry
  ? {run:activeTimelineEntry.candidateRun,hardware:null,twin:null,replay:activeTimelineEntry.candidateReplay}
  : {run:S.comparisonRun,hardware:null,twin:null,replay:S.comparisonReplay};
const selectedReview=activeTimelineEntry?.review??S.selectedResearchReview?.review??null;
const researchReviewEntries=S.researchSessions.flatMap(session=>session.experiments.map(experiment=>({session,experiment,review:experiment.visualReview}))).filter(item=>item.review);
if(RT){
  q('#research-cockpit').hidden=false;
  q('#artifact-stats').hidden=true;
  const labSessions=S.researchSessions.filter(session=>session.researchId===RT.labId).sort((a,b)=>String(a.startedAt??'').localeCompare(String(b.startedAt??'')));
  const rows=labSessions.flatMap(session=>session.experiments.map(experiment=>({
    key:session.id+'/'+experiment.id,
    session,
    experiment,
    reviewEntry:timelineEntries.find(entry=>entry.key===session.id+'/'+experiment.id)??null,
  })));
  const keep=rows.filter(row=>row.experiment.verdict==='KEEP').length,revert=rows.filter(row=>row.experiment.verdict==='REVERT').length,crash=rows.filter(row=>!['KEEP','REVERT'].includes(row.experiment.verdict)).length;
  const latestSession=labSessions.at(-1);
  q('#research-progress-stats').innerHTML=[['Iterations',rows.length],['KEEP',keep],['REVERT',revert],['CRASH',crash],['Visual reviews',timelineEntries.length+'/'+rows.length],['Latest accepted score',Number(latestSession?.finalScore??0).toFixed(3)]].map(x=>'<div class="stat"><strong>'+esc(x[1])+'</strong>'+esc(x[0])+'</div>').join('');
  const sessionSelect=q('#timeline-session');
  sessionSelect.innerHTML='<option value="ALL">All sessions</option>'+labSessions.slice().reverse().map((session,index)=>'<option value="'+esc(session.id)+'">'+esc(new Date(session.startedAt).toLocaleString())+' · '+session.iterationsCompleted+' iteration'+(session.iterationsCompleted===1?'':'s')+'</option>').join('');
  if(RT.sessionId)sessionSelect.value=RT.sessionId;
  const renderTimeline=()=>{
    const sessionValue=sessionSelect.value,outcome=q('#timeline-outcome').value,sort=q('#timeline-sort').value;
    const visible=rows.filter(row=>(sessionValue==='ALL'||row.session.id===sessionValue)&&(outcome==='ALL'||row.experiment.verdict===outcome));
    visible.sort((a,b)=>sort==='latest'?Number(b.experiment.sequence??0)-Number(a.experiment.sequence??0)||String(b.session.startedAt).localeCompare(String(a.session.startedAt)):sort==='score'?Number(b.experiment.delta??-Infinity)-Number(a.experiment.delta??-Infinity):sort==='violations'?Number(a.experiment.decision?.candidateViolationCount??Infinity)-Number(b.experiment.decision?.candidateViolationCount??Infinity):String(a.session.startedAt).localeCompare(String(b.session.startedAt))||Number(a.experiment.sequence??0)-Number(b.experiment.sequence??0));
    q('#timeline-list').innerHTML=visible.map(row=>{const experiment=row.experiment,active=row.key===activeTimelineEntry?.key,reviewed=Boolean(row.reviewEntry),sequence=Number(experiment.sequence??row.session.experiments.indexOf(experiment)+1);return '<div class="iteration '+(active?'active':'')+'"><div class="sequence">#'+sequence+'</div><div><span class="tag verdict-'+esc(experiment.verdict)+'">'+esc(experiment.verdict??'CRASH')+'</span> <strong>'+esc(experiment.proposal?.strategy??'failed experiment')+'</strong><br><span class="'+(Number(experiment.delta??0)>=0?'delta-good':'delta-bad')+'">score Δ '+(Number(experiment.delta??0)>=0?'+':'')+Number(experiment.delta??0).toFixed(4)+'</span> · gates '+esc(experiment.decision?.previousViolationCount??'—')+' → '+esc(experiment.decision?.candidateViolationCount??'—')+'<br><span class="muted">'+esc(experiment.proposal?.hypothesis??experiment.error??'No hypothesis recorded')+'</span></div><button data-timeline-key="'+esc(row.key)+'" '+(reviewed?'':'disabled')+'>'+(active?'Viewing':reviewed?'Compare':'Metrics only')+'</button></div>'}).join('')||'<div class="muted">No iterations match these filters.</div>';
  };
  const selectedExperiment=rows.find(row=>row.key===activeTimelineEntry?.key)?.experiment;
  q('#timeline-detail').innerHTML=activeTimelineEntry&&selectedExperiment
    ? '<span class="tag verdict-'+esc(selectedReview?.judge.verdict)+'">'+esc(selectedReview?.judge.verdict)+'</span> Iteration #'+esc(selectedExperiment.sequence)+' · '+esc(selectedReview?.proposal.strategy)+'<br><strong>'+esc(selectedReview?.proposal.hypothesis)+'</strong><br>accepted score '+Number(selectedReview?.accepted.score).toFixed(4)+' → candidate '+Number(selectedReview?.candidate.score).toFixed(4)+' · witness Δ '+(Number(selectedReview?.selectedCase.candidateScoreDelta)>=0?'+':'')+Number(selectedReview?.selectedCase.candidateScoreDelta).toFixed(4)+'<br><span class="muted">Gate decision: '+esc(selectedReview?.judge.decision.selectionReason)+' · witness case '+esc(selectedReview?.selectedCase.id)+'</span>'
    : 'No reviewed iteration is selected.';
  q('#timeline-list').onclick=event=>{const button=event.target.closest?.('[data-timeline-key]');if(!button||button.disabled)return;const params=new URLSearchParams(location.hash.slice(1));params.set('iteration',button.dataset.timelineKey);location.hash=params.toString();location.reload()};
  sessionSelect.onchange=renderTimeline;q('#timeline-outcome').onchange=renderTimeline;q('#timeline-sort').onchange=renderTimeline;renderTimeline();
}
q('#copy-selected-review').disabled=!selectedReview;
q('#selected-research-review').innerHTML=selectedReview
  ? '<span class="tag" style="color:'+(selectedReview.judge.verdict==='KEEP'?'var(--a)':'var(--b)')+'">'+esc(selectedReview.judge.verdict)+'</span> <code>'+esc(selectedReview.lineage.experimentId)+'</code> · '+esc(selectedReview.lineage.researchId)
    +'<br><strong>'+esc(selectedReview.proposal.hypothesis)+'</strong>'
    +'<br><span class="muted">Brief '+esc(selectedReview.lineage.researchBriefId??'none')+' · observations '+esc(selectedReview.lineage.observationIds.join(', ')||'none')+'</span>'
    +'<br>Witness case <code>'+esc(selectedReview.selectedCase.id)+'</code> · '+esc(selectedReview.selectedCase.selectionPolicy)+' · Δ '+Number(selectedReview.selectedCase.candidateScoreDelta).toFixed(4)
    +'<br><span class="muted">'+esc(selectedReview.selectedCase.selectionReason)+'</span>'
    +'<br><code>'+esc(selectedReview.accepted.id)+'</code> accepted → <code>'+esc(selectedReview.candidate.id)+'</code> candidate'
    +(selectedReview.judge.decision.gateReasons.length?'<br><span class="bad">'+selectedReview.judge.decision.gateReasons.map(esc).join(' · ')+'</span>':'')
  : 'This Run pair is not bound to a Research Review. Open one with <code>mujica studio . --research-lab ID --session ID --experiment ID</code>.';
A.trajectory=A.trajectory??A.run?.trajectory.rows??[];B.trajectory=B.trajectory??B.run?.trajectory.rows??[];
const pad=i=>String(i).padStart(6,'0'),vector=v=>Array.isArray(v)?v.map(x=>Number(x).toFixed(3)).join(', '):'—';
const timesFor=side=>side.replay?.frameTimes?.length?side.replay.frameTimes.map(Number):side.trajectory.map(row=>Number(row.time??0));
A.times=timesFor(A);B.times=timesFor(B);
const clockTimes=[...new Set([...A.times,...B.times].map(time=>Number(time).toFixed(9)))].map(Number).sort((a,b)=>a-b);
if(!clockTimes.length)clockTimes.push(0);
const atOrBefore=(times,time)=>{let found=0;for(let i=0;i<times.length;i++){if(Number(times[i])<=time+1e-9)found=i;else break}return found};
const rowAt=(side,time)=>side.trajectory[atOrBefore(side.trajectory.map(row=>Number(row.time??0)),time)]??null;
const sideFrame=(side,time)=>side.times.length?atOrBefore(side.times,time):0;
q('#stats').innerHTML=[['Assemblies',S.assemblies.length],['Runs',S.runs.length],['Compared Runs',B.run?2:A.run?1:0],['Rendered frames',(A.replay?.frameCount??0)+(B.replay?.frameCount??0)],['Device replay',H?1:0],['Twin audit',T?1:0],['Hardware Captures',S.hardwareCaptures.length],['Human observations',S.humanObservations.length],['Research Briefs',S.researchBriefs.length],['Research Reviews',researchReviewEntries.length],['Policies',S.policies.length],['Robot revisions',S.revisions.length]].map(x=>'<div class="stat"><strong>'+x[1]+'</strong>'+x[0]+'</div>').join('');
const runEvidence=(label,side)=>side.run?'<div class="row"><span class="tag">'+label+'</span> <code>'+esc(side.run.id)+'</code></div><div class="row">seed '+esc(side.run.manifest?.seed)+' · result '+esc(side.run.manifest?.resultHash?.slice?.(0,12))+'</div>'+(side.replay?'<div class="row">replay <code>'+esc(side.replay.id)+'</code> · '+side.replay.frameCount+' frames</div>':''):side.hardware?'<div class="row"><span class="tag">'+esc(side.hardware.mode)+'</span> <code>'+esc(side.hardware.id)+'</code></div><div class="row">episode <code>'+esc(side.hardware.episode.id)+'</code><br>capture '+esc(side.hardware.captureHash.slice(0,12))+' · episode '+esc(side.hardware.episode.hash.slice(0,12))+'</div><div class="row">bundle <code>'+esc(side.hardware.bundle.id)+'</code><br>'+esc(side.hardware.bundleHash.slice(0,12))+' · '+esc(side.hardware.environment)+'</div><div class="row">replay <code>'+esc(side.replay?.id)+'</code> · '+esc(side.replay?.frameCount)+' frames</div>':side.twin?'<div class="row"><span class="tag">derived model-fit evidence</span> <code>'+esc(side.twin.id)+'</code></div><div class="row">audit '+esc(side.twin.auditHash.slice(0,12))+' · '+esc(side.twin.summary.transitionCount)+' one-step transitions</div><div class="row">replay <code>'+esc(side.replay?.id)+'</code> · '+esc(side.replay?.frameCount)+' frames</div>':'<div class="muted">'+label+' not selected.</div>';
q('#run').innerHTML=H?runEvidence('device telemetry',A)+runEvidence('frozen twin',B):runEvidence('baseline',A)+runEvidence('subject',B);
const qualityKeys=['meanJointJerkRadPerSec3','meanBodyAngularJerkRadPerSec3','meanActionSlewRatePerSec','actuatorSaturationRate','meanFootSlipSpeedMps','peakFootContactImpactNPerSec','totalFootSlipDistanceM'];
q('#metrics').innerHTML=T
  ? '<tr><th>Residual metric</th><th>RMSE</th><th>Maximum</th><th>Worst transition</th></tr>'+Object.entries(T.summary.metrics).map(([key,value])=>'<tr><td>'+esc(key)+'</td><td>'+Number(value.rmse).toPrecision(4)+'</td><td>'+Number(value.maximumMagnitude).toPrecision(4)+'</td><td>'+esc(value.worstTransition)+'</td></tr>').join('')+'<tr><td>Worst named joint position</td><td>'+esc(T.summary.perJoint?.worstPosition?.name??'—')+'</td><td>'+Number(T.summary.perJoint?.worstPosition?.positionRmse??0).toPrecision(4)+'</td><td>State ABI</td></tr><tr><td>Worst named joint velocity</td><td>'+esc(T.summary.perJoint?.worstVelocity?.name??'—')+'</td><td>'+Number(T.summary.perJoint?.worstVelocity?.velocityRmse??0).toPrecision(4)+'</td><td>State ABI</td></tr>'
  : H
  ? [['Capture mode',H.mode],['Actuation authorized',String(H.actuationAuthorized)],['Kinematics','device-reported'],['Geometry','frozen digital twin'],['Visual ground truth','false'],['Contact truth','reported telemetry only'],['Hardware verification','unchanged']].map(item=>'<tr><td>'+esc(item[0])+'</td><td>'+esc(item[1])+'</td></tr>').join('')
  : '<tr><th>Metric</th><th>A</th><th>B</th><th>Δ</th></tr>'+qualityKeys.map(key=>{const a=Number(A.run?.metrics?.[key]),b=Number(B.run?.metrics?.[key]),hasA=Number.isFinite(a),hasB=Number.isFinite(b),delta=b-a;return '<tr><td>'+esc(key)+'</td><td>'+esc(hasA?a.toFixed(4):'—')+'</td><td>'+esc(hasB?b.toFixed(4):'—')+'</td><td class="'+(hasA&&hasB?(delta<=0?'delta-good':'delta-bad'):'')+'">'+esc(hasA&&hasB?(delta>=0?'+':'')+delta.toFixed(4):'—')+'</td></tr>'}).join('');
if(H){
  q('#replay-heading').textContent=T?'Device telemetry ↔ one-step frozen MuJoCo prediction':'Device telemetry → frozen MuJoCo digital twin';
  q('#primary-heading').innerHTML='Device telemetry <span class="tag">'+esc(H.mode)+'</span>';
  q('#comparison-card').hidden=!T;q('#replay-grid').style.gridTemplateColumns=T?'1fr 1fr':'1fr';
  if(T)q('#comparison-heading').innerHTML='Frozen twin prediction <span class="tag">one-step</span>';
  q('#copy-frame').textContent=T?'Copy exact residual transition for Agent':'Copy exact device frame context for Agent';
  q('#evidence-heading').textContent='Capture evidence';
  q('#metrics-heading').textContent=T?'Digital twin residual summary':'Authority boundary';q('#metrics-note').textContent=T?'Every prediction resets from the previous device state; residuals do not accumulate rollout drift.':'Projection aids diagnosis; it grants no additional evidence or control authority.';
  q('#device-provenance').hidden=false;
  q('#twin-residual').hidden=!T;
  q('#research-review-provenance').hidden=true;
  q('#attention-guidance').textContent='Only faults and recorded human hypotheses associated with this selected device episode belong in the focused queue.';
  q('#device-provenance-detail').innerHTML='<code>'+esc(H.id)+'</code> / <code>'+esc(H.episode.id)+'</code><br>device-reported qpos/qvel → State ABI <code>'+esc(H.bundle.stateContractHash.slice(0,12))+'</code> → Bundle <code>'+esc(H.bundle.id)+'</code> → MuJoCo frames'+(T?'<br>Audit <code>'+esc(T.id)+'</code> compares the next device state with one frozen-twin step using device <code>appliedAction</code>.':'')+'<br><span class="muted">State ABI '+esc(H.bundle.stateContractAuthority)+' · source '+esc(H.bundle.sourceKind)+' · maximum bundle mode '+esc(H.bundle.maximumCaptureMode)+'</span>';
}else if(RT&&activeTimelineEntry){
  q('#replay-heading').textContent='Selected training iteration · accepted ↔ candidate';
  q('#primary-heading').innerHTML='Accepted baseline <span class="tag">A</span>';
  q('#comparison-heading').innerHTML='Candidate change <span class="tag">B</span>';
  q('#copy-frame').textContent='Copy selected iteration + frame for Agent';
  q('#evidence-heading').textContent='Selected iteration evidence';
  q('#attention-guidance').textContent='Focused failures from the selected accepted/candidate Run pair, followed by recorded human hypotheses.';
}
const sel=q('#assembly');sel.innerHTML=S.assemblies.map(a=>'<option '+(a.id===S.selectedAssembly?'selected':'')+' value="'+esc(a.id)+'">'+esc(a.id)+'</option>').join('');
function showAssembly(){const a=S.assemblies.find(x=>x.id===sel.value);q('#assembly-detail').innerHTML='<div class="row">hash <code>'+esc(a.hash.slice(0,16))+'</code><br>mass '+a.totalMassKg.toFixed(3)+' kg · component cost '+a.componentCost+'</div><h3>Components</h3><div>'+a.components.map(c=>'<div class="row"><span class="tag">'+esc(c.componentId)+'</span> <code>'+esc(JSON.stringify(c.config||{}))+'</code></div>').join('')+'</div><h3>Observation '+a.observationContract.size+'</h3><div>'+a.observationContract.channels.map(c=>'<span class="tag">'+esc(c.name)+' ['+c.size+']</span>').join('')+'</div><h3>Action '+a.actionContract.size+'</h3><div>'+a.actionContract.channels.map(c=>'<span class="tag">'+esc(c.name)+' ['+c.size+']</span>').join('')+'</div>'}sel.onchange=showAssembly;showAssembly();
const eventRows=[...(A.run?.events.rows??[]).map(event=>({side:'A',event})),...(B.run?.events.rows??[]).map(event=>({side:'B',event}))].sort((a,b)=>Number(a.event.time??0)-Number(b.event.time??0));
q('#events').innerHTML=eventRows.map((item,index)=>'<div class="row seek" data-event-index="'+index+'"><span class="tag">'+item.side+'</span> <code>'+Number(item.event.time??0).toFixed(3)+'s</code> '+esc(item.event.type)+'<div class="muted">'+esc(JSON.stringify(item.event))+'</div></div>').join('')||'<div class="muted">No events.</div>';
const captureRows=(S.hardwareCaptures??[]).slice().sort((a,b)=>String(b.endedAt??'').localeCompare(String(a.endedAt??'')));
q('#captures').innerHTML=captureRows.map((capture,index)=>'<div class="row seek" data-capture-index="'+index+'"><span class="tag '+(capture.status==='ABORTED'?'severity-blocking':'severity-info')+'">'+esc(capture.status)+'</span> <code>'+esc(capture.id)+'</code><br><span class="muted">'+esc(capture.mode)+' · '+esc(capture.environment)+' · event '+esc(capture.attentionEventIndex)+'/'+esc(capture.transcriptLength)+(capture.reasons?.length?' · '+capture.reasons.map(esc).join(' · '):'')+'</span></div>').join('')||'<div class="muted">No Hardware Captures.</div>';
const humanObservations=(S.humanObservations??[]).slice().sort((a,b)=>String(b.recordedAt??'').localeCompare(String(a.recordedAt??'')));
q('#human-observations').innerHTML=humanObservations.map(observation=>'<div class="row"><span class="tag severity-'+esc(observation.assessment?.severity??'info')+'">'+esc(observation.assessment?.severity)+'</span> <code>'+esc(observation.id)+'</code><br>'+esc(observation.assessment?.summary)+'<br><span class="muted">human hypothesis · '+esc(observation.observer)+' · context '+esc(observation.contextHash?.slice?.(0,12))+'</span></div>').join('')||'<div class="muted">No recorded human observations.</div>';
const briefObservationSelect=q('#brief-observation'),briefLabSelect=q('#brief-lab'),briefButton=q('#copy-research-brief');
briefObservationSelect.innerHTML=humanObservations.map(observation=>'<option value="'+esc(observation.id)+'">'+esc(observation.assessment?.summary)+' · '+esc(observation.id)+'</option>').join('');
briefLabSelect.innerHTML=S.researchLabs.map(l=>'<option value="'+esc(l.id)+'">'+esc(l.name)+' · '+esc(l.execution.kind)+' · '+esc(l.benchmark)+'</option>').join('');
briefObservationSelect.disabled=!humanObservations.length;briefLabSelect.disabled=!S.researchLabs.length;briefButton.disabled=!humanObservations.length||!S.researchLabs.length;
function selectedBriefObservation(){return humanObservations.find(item=>item.id===briefObservationSelect.value)??null}
function selectedBriefLab(){return S.researchLabs.find(item=>item.id===briefLabSelect.value)??null}
function updateBriefSource(){const observation=selectedBriefObservation(),lab=selectedBriefLab();q('#brief-source').innerHTML=observation&&lab?'Human hypothesis <code>'+esc(observation.id)+'</code> → <code>'+esc(lab.id)+'</code><br><span class="muted">Benchmark '+esc(lab.benchmark)+' · '+esc(lab.editable.paths.length)+' explicit editable path(s) · promotion '+esc(lab.promotion)+'</span>':'Record a human observation and select a Research Lab before preparing a Brief.'}
briefObservationSelect.onchange=updateBriefSource;briefLabSelect.onchange=updateBriefSource;updateBriefSource();
const runAttention=eventRows.filter(item=>String(item.event.type??'').includes('fall')||item.event.healthy===false||String(item.event.type??'').includes('failed')).map(item=>({kind:'run',severity:'blocking',title:item.side+' · '+item.event.type,detail:'Run '+(item.side==='A'?A.run?.id:B.run?.id)+' at '+Number(item.event.time??0).toFixed(3)+'s',time:Number(item.event.time??0),sortTime:Number.MAX_SAFE_INTEGER}));
const captureAttention=(H?captureRows.filter(capture=>capture.id===H.id):RT?[]:captureRows).filter(capture=>capture.status==='ABORTED'||Number(capture.interventions??0)>0).map(capture=>({kind:'capture',severity:capture.status==='ABORTED'?'blocking':'investigate',title:capture.status+' · '+capture.id,detail:(capture.reasons?.join(' · ')||capture.interventions+' safety interventions')+' · protocol event '+capture.attentionEventIndex,capture,sortTime:Date.parse(capture.endedAt??'')||0}));
const observationAttention=humanObservations.map(observation=>({kind:'observation',severity:observation.assessment?.severity??'info',title:'Human · '+observation.assessment?.summary,detail:observation.id+' · hypothesis only',sortTime:Date.parse(observation.recordedAt??'')||0}));
const attentionRank={blocking:0,investigate:1,info:2},attentionRows=[...runAttention,...captureAttention,...observationAttention].sort((a,b)=>attentionRank[a.severity]-attentionRank[b.severity]||b.sortTime-a.sortTime||String(a.title).localeCompare(String(b.title)));
q('#attention').innerHTML=attentionRows.map((item,index)=>'<div class="attention-row" data-attention-index="'+index+'"><span class="tag severity-'+esc(item.severity)+'">'+esc(item.severity)+'</span><div><strong>'+esc(item.title)+'</strong><div class="muted">'+esc(item.detail)+'</div></div></div>').join('')||'<div class="muted">No anomalies or human hypotheses in this snapshot.</div>';
q('#revisions').innerHTML=S.revisions.map(r=>'<div class="row"><code>'+esc(r.id)+'</code><br><span class="muted">'+esc(r.parent??'root')+' → score '+esc(Number(r.aggregateScore).toFixed(4))+'</span></div>').join('');
q('#training').innerHTML=S.policyRevisions.map(r=>'<div class="row">Policy revision <code>'+esc(r.id)+'</code><br><span class="muted">'+esc(r.policyId)+'</span></div>').join('')+S.trainingRuns.slice(-8).map(r=>'<div class="row">Training <code>'+esc(r.id)+'</code><br><span class="muted">'+esc(r.policyId)+'</span></div>').join('');
q('#research-labs').innerHTML=S.researchLabs.map(l=>'<div class="row"><code>'+esc(l.id)+'</code> <span class="tag">'+esc(l.execution.kind)+'</span><br><span class="muted">'+esc(l.benchmark)+' · editable '+l.editable.paths.map(esc).join(', ')+'</span></div>').join('')||'<div class="muted">No Research Labs.</div>';
q('#research-sessions').innerHTML=S.researchSessions.slice().reverse().map(s=>'<div class="row"><code>'+esc(s.id)+'</code> <span class="tag">'+esc(s.completed?'COMPLETE':'INCOMPLETE')+'</span><br><span class="muted">'+esc(s.researchId)+' · '+s.iterationsCompleted+'/'+s.iterationsRequested+' experiments · score '+Number(s.initialScore).toFixed(4)+' → '+Number(s.finalScore).toFixed(4)+(s.researchBriefId?' · brief '+esc(s.researchBriefId):'')+' · reviews '+esc(s.reviewCount??0)+'</span>'
  +s.experiments.map(e=>{const review=e.visualReview,index=review?researchReviewEntries.findIndex(item=>item.session.id===s.id&&item.experiment.id===e.id):-1;return '<div class="row"><span class="tag" style="color:'+(e.verdict==='KEEP'?'var(--a)':e.verdict==='REVERT'?'var(--b)':'var(--bad)')+'">'+esc(e.verdict)+'</span> <code>'+esc(e.id)+'</code> Δ '+Number(e.delta??0).toFixed(4)
    +'<br>'+esc(e.proposal?.hypothesis??e.error??'No proposal')
    +(e.decision?.gateReasons?.length?'<br><span class="bad">'+e.decision.gateReasons.map(esc).join(' · ')+'</span>':'')
    +(review?'<br><span class="muted">visual witness <code>'+esc(review.selectedCase.id)+'</code> · '+esc(review.selectedCase.selectionPolicy)+' · <code>'+esc(review.accepted.id)+'</code> → <code>'+esc(review.candidate.id)+'</code></span><br><button data-research-review-index="'+index+'">Copy exact visual-review command</button>':'<br><span class="muted">Review '+esc(e.review?.status??'legacy-unavailable')+(e.review?.error?' · '+esc(e.review.error):'')+'</span>')
    +'</div>'}).join('')+'</div>').join('')||'<div class="muted">No completed research Sessions.</div>';
q('#benchmarks').innerHTML=S.benchmarks.map(b=>'<div class="row"><code>'+esc(b.id)+'</code><br><span class="muted">'+esc(b.objective)+' · '+b.cases.length+' fixed cases · baseline '+esc(b.baseline.assembly)+'/'+esc(b.baseline.controller)+'</span></div>').join('');
q('#candidates').innerHTML=S.candidates.map(c=>'<div class="row"><code>'+esc(c.id)+'</code> <span class="tag">'+esc(c.kind)+'</span><br><span class="muted">'+esc(c.baseline.assembly)+'/'+esc(c.baseline.controller)+' → '+esc(c.proposed.assembly)+'/'+esc(c.proposed.controller)+'</span></div>').join('');
const canvas=q('#trajectory'),ctx=canvas.getContext('2d'),scrub=q('#scrub');scrub.max=String(Math.max(0,clockTimes.length-1));let timer=null,currentClock=0,selectedCapture=null;
function drawPath(time){ctx.clearRect(0,0,canvas.width,canvas.height);const series=[{side:A,color:'#65d6ad'},{side:B,color:'#efc66b'}].filter(item=>item.side.trajectory.length);if(!series.length){ctx.fillStyle='#8ea0af';ctx.fillText('No trajectory selected',30,40);return}const all=series.flatMap(item=>item.side.trajectory.map(row=>[row.qpos?.[0]??0,row.qpos?.[1]??0])),xs=all.map(p=>p[0]),ys=all.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys),span=Math.max(maxX-minX,maxY-minY,.25),map=p=>[60+(p[0]-minX)/span*(canvas.width-120),canvas.height-60-(p[1]-minY)/span*(canvas.height-120)];for(const item of series){const pts=item.side.trajectory.map(r=>[r.qpos?.[0]??0,r.qpos?.[1]??0]),index=atOrBefore(item.side.trajectory.map(row=>Number(row.time??0)),time);ctx.strokeStyle=item.color+'55';ctx.lineWidth=2;ctx.beginPath();pts.forEach((p,n)=>{const m=map(p);n?ctx.lineTo(...m):ctx.moveTo(...m)});ctx.stroke();ctx.strokeStyle=item.color;ctx.lineWidth=4;ctx.beginPath();pts.slice(0,index+1).forEach((p,n)=>{const m=map(p);n?ctx.lineTo(...m):ctx.moveTo(...m)});ctx.stroke();const m=map(pts[index]);ctx.fillStyle=item.color;ctx.beginPath();ctx.arc(...m,7,0,Math.PI*2);ctx.fill()}}
function telemetry(side,row,target,health){const peak=values=>Array.isArray(values)?Math.max(0,...values.map(x=>Math.abs(Number(x)))):null,difference=(a,b)=>Array.isArray(a)&&Array.isArray(b)?Math.max(0,...a.map((value,index)=>Math.abs(Number(value)-Number(b[index]??0)))):null;let cells,unhealthy=false,label='—';if(side.hardware){const state=row?.deviceHealth??{},states=state.actuatorStates??[],faults=state.faults??[];unhealthy=Boolean(row&&(faults.length||state.estopEngaged===true||state.watchdogHealthy===false||states.some(value=>value!=='ready')));label=row?(unhealthy?'DEVICE FAULT':'DEVICE HEALTHY'):'—';cells=[['Device time',Number(row?.time??0).toFixed(3)+' s'],['Step',row?.step??'—'],['Base XYZ',vector(row?.qpos?.slice?.(0,3))],['Bus voltage',Number.isFinite(Number(state.busVoltageV))?Number(state.busVoltageV).toFixed(2)+' V':'—'],['Proposed peak',peak(row?.proposedAction)?.toFixed(3)??'—'],['Commanded peak',peak(row?.commandedAction)?.toFixed(3)??'—'],['Applied peak',peak(row?.appliedAction)?.toFixed(3)??'—'],['Proposed ↔ applied Δ',difference(row?.proposedAction,row?.appliedAction)?.toFixed(3)??'—'],['Watchdog',state.watchdogHealthy===true?'healthy':state.watchdogHealthy===false?'unhealthy':'—'],['E-stop',state.estopEngaged===true?'ENGAGED':state.estopEngaged===false?'clear':'—'],['Faults',faults.join(', ')||'none'],['Actuators',states.length?states.reduce((summary,value)=>(summary[value]=(summary[value]??0)+1,summary),{}):'—']]}else if(side.twin){const transition=row?.transitionIndex===undefined?null:side.twin.transitions[row.transitionIndex];label=row?'FROZEN TWIN':'—';cells=[['Prediction time',Number(row?.time??0).toFixed(3)+' s'],['Step',row?.step??'—'],['Kind',row?.predictionKind??'—'],['Base XYZ',vector(row?.qpos?.slice?.(0,3))],['Transition',transition?.index??'initial'],['Base position Δ',transition?Number(transition.residual.basePositionNormM).toPrecision(4)+' m':'—'],['Orientation Δ',transition?Number(transition.residual.baseOrientationAngleRad).toPrecision(4)+' rad':'—'],['Joint position Δ',transition?Number(transition.residual.jointPositionNormRad).toPrecision(4)+' rad':'—'],['Joint velocity Δ',transition?Number(transition.residual.jointVelocityNormRadPerSec).toPrecision(4)+' rad/s':'—'],['Input','device appliedAction']]}else{const quality=row?.motionQuality??{};unhealthy=row?.healthy===false;label=row?(unhealthy?'UNHEALTHY':'HEALTHY'):'—';cells=[['Time',Number(row?.time??0).toFixed(3)+' s'],['Step',row?.step??'—'],['Pitch',Number(row?.pitchRad??0).toFixed(3)+' rad'],['Body tilt',Number(row?.bodyTiltRad??0).toFixed(3)+' rad'],['Command',vector(row?.motionCommand)],['Measured',vector(row?.measuredMotion)],['Action slew peak',peak(quality.actionSlewRatePerSec)?.toFixed(2)??'—'],['Joint jerk peak',peak(quality.jointJerkRadPerSec3)?.toFixed(2)??'—'],['Foot slip peak',peak(quality.footSlipSpeedMps)?.toFixed(3)??'—'],['Contact impact peak',peak(quality.footContactImpactNPerSec)?.toFixed(1)??'—']]}q(target).innerHTML=cells.map(x=>'<div class="cell"><strong>'+esc(x[0])+'</strong>'+esc(typeof x[1]==='object'?JSON.stringify(x[1]):x[1])+'</div>').join('');q(health).textContent=label;q(health).className='live-badge '+(unhealthy?'bad':'ok')}
function renderSide(side,time,imageId,missingId,frameId,telemetryId,healthId){const image=q(imageId),missing=q(missingId),frameIndex=sideFrame(side,time),row=rowAt(side,time);if(side.replay){image.hidden=false;missing.hidden=true;image.src=side.replay.frameBase+'/'+pad(frameIndex)+'.png';const preload=new Image();preload.src=side.replay.frameBase+'/'+pad(Math.min(side.replay.frameCount-1,frameIndex+1))+'.png'}else{image.hidden=true;missing.hidden=false}q(frameId).textContent=side.run||side.hardware||side.twin?'frame '+(frameIndex+1)+' / '+Math.max(1,side.times.length)+' · mapped '+Number(side.times[frameIndex]??row?.time??0).toFixed(3)+'s':'No source selected';telemetry(side,row,telemetryId,healthId);return {frameIndex,row}}
function render(index){currentClock=Math.max(0,Math.min(clockTimes.length-1,Number(index)||0));const time=clockTimes[currentClock],a=renderSide(A,time,'#replay-image','#replay-missing','#frame-a','#telemetry-a','#health'),b=renderSide(B,time,'#comparison-image','#comparison-missing','#frame-b','#telemetry-b','#comparison-health');scrub.value=String(currentClock);q('#frame').textContent=(H?'device telemetry time ':'shared simulation time ')+time.toFixed(3)+'s · '+(currentClock+1)+' / '+clockTimes.length;if(T){const transition=b.row?.transitionIndex===undefined?null:T.transitions[b.row.transitionIndex],worst=transition?.residual?.joints?.slice?.().sort((x,y)=>Math.max(Math.abs(y.position),Math.abs(y.velocity))-Math.max(Math.abs(x.position),Math.abs(x.velocity))).slice(0,3)??[];q('#twin-residual-stats').innerHTML=transition?[['Transition',transition.index],['Base position',Number(transition.residual.basePositionNormM).toPrecision(4)+' m'],['Orientation',Number(transition.residual.baseOrientationAngleRad).toPrecision(4)+' rad'],['Joint position',Number(transition.residual.jointPositionNormRad).toPrecision(4)+' rad'],['Joint velocity',Number(transition.residual.jointVelocityNormRadPerSec).toPrecision(4)+' rad/s']].map(x=>'<div class="stat"><strong>'+esc(x[1])+'</strong>'+esc(x[0])+'</div>').join(''):'<div class="muted">Frame 0 is the shared measured initial state; choose the next frame for a one-step residual.</div>';q('#twin-residual-detail').innerHTML=transition?'<code>'+esc(T.id)+'</code> transition '+transition.index+' · '+Number(transition.fromTime).toFixed(3)+'s → '+Number(transition.toTime).toFixed(3)+'s<br>'+worst.map(item=>'<span class="tag">'+esc(item.name)+' · Δq '+Number(item.position).toPrecision(3)+' · Δv '+Number(item.velocity).toPrecision(3)+'</span>').join('')+'<br><span class="muted">Named by the frozen Hardware State ABI. Each prediction starts from device qpos/qvel at the previous frame and applies device <code>appliedAction</code>.</span>':'No transition selected.'}drawPath(time);updateObservationSource();return {time,a,b}}
function pause(){if(timer){clearTimeout(timer);timer=null}q('#play').textContent='Play'}function advance(){if(currentClock>=clockTimes.length-1){pause();return}const from=clockTimes[currentClock],to=clockTimes[currentClock+1],speed=Number(q('#speed').value)||1;render(currentClock+1);timer=setTimeout(advance,Math.max(8,1000*Math.max(.001,to-from)/speed))}
q('#play').onclick=()=>{if(timer){pause();return}q('#play').textContent='Pause';advance()};q('#previous').onclick=()=>{pause();render(currentClock-1)};q('#next').onclick=()=>{pause();render(currentClock+1)};scrub.oninput=()=>{pause();render(Number(scrub.value))};
document.querySelectorAll('[data-event-index]').forEach(node=>node.onclick=()=>{pause();const time=Number(eventRows[Number(node.dataset.eventIndex)].event.time??0);render(atOrBefore(clockTimes,time))});document.addEventListener('keydown',event=>{if(event.target?.matches?.('input,select,textarea'))return;if(event.key==='ArrowLeft'){event.preventDefault();q('#previous').click()}else if(event.key==='ArrowRight'){event.preventDefault();q('#next').click()}else if(event.key===' '){event.preventDefault();q('#play').click()}});
document.querySelectorAll('[data-capture-index]').forEach(node=>node.onclick=()=>{selectedCapture=captureRows[Number(node.dataset.captureIndex)];updateObservationSource()});
document.querySelectorAll('[data-attention-index]').forEach(node=>node.onclick=()=>{const item=attentionRows[Number(node.dataset.attentionIndex)];if(item.kind==='run'){selectedCapture=null;pause();render(atOrBefore(clockTimes,item.time))}else if(item.kind==='capture'){selectedCapture=item.capture;updateObservationSource()}});
const sideContext=(side,time)=>{const frameIndex=sideFrame(side,time),row=rowAt(side,time);if(side.hardware)return{captureId:side.hardware.id,captureHash:side.hardware.captureHash,bundleId:side.hardware.bundle.id,bundleHash:side.hardware.bundleHash,episodeId:side.hardware.episode.id,episodeHash:side.hardware.episode.hash,replayId:side.replay?.id??null,replayFrame:frameIndex,mappedFrameTimeSeconds:side.times[frameIndex]??null,deviceStep:row?.step??null,rowTimeSeconds:row?.time??null,qpos:row?.qpos??null,qvel:row?.qvel??null,proposedAction:row?.proposedAction??null,commandedAction:row?.commandedAction??null,appliedAction:row?.appliedAction??null,deviceHealth:row?.deviceHealth??null,authorityBoundary:side.hardware.authorityBoundary};if(side.twin)return{auditId:side.twin.id,auditHash:side.twin.auditHash,replayId:side.replay?.id??null,replayFrame:frameIndex,mappedFrameTimeSeconds:side.times[frameIndex]??null,predictionStep:row?.step??null,transitionIndex:row?.transitionIndex??null,qpos:row?.qpos??null,qvel:row?.qvel??null,authorityBoundary:side.twin.authorityBoundary};return side.run?{runId:side.run.id,resultHash:side.run.manifest?.resultHash,replayId:side.replay?.id??null,replayFrame:frameIndex,mappedFrameTimeSeconds:side.times[frameIndex]??null,simulationStep:row?.step??null,rowTimeSeconds:row?.time??null,healthy:row?.healthy??null,pitchRad:row?.pitchRad??null,bodyTiltRad:row?.bodyTiltRad??null,motionCommand:row?.motionCommand??null,measuredMotion:row?.measuredMotion??null,footContactForce:row?.footContactForce??null,motionQuality:row?.motionQuality??null,action:row?.action??null}:null};
q('#copy-frame').onclick=async()=>{const time=clockTimes[currentClock];let context;if(T){const prediction=rowAt(B,time),transition=prediction?.transitionIndex===undefined?null:T.transitions[prediction.transitionIndex];context={kind:'mujica-digital-twin-residual-selector',authority:'derived-model-fit-evidence',headlessArgv:transition?['twin','inspect','.', '--audit',T.id,'--transition',String(transition.index)]:['twin','inspect','.', '--audit',T.id],audit:{id:T.id,auditHash:T.auditHash},capture:sideContext(A,time),prediction:sideContext(B,time),transition,authorityBoundary:T.authorityBoundary}}else if(H){context={kind:'mujica-hardware-capture-frame-selector',authority:'immutable-device-telemetry',headlessArgv:['evidence','inspect','.', '--capture',H.id,'--episode',H.episode.id,'--time',String(time)],capture:sideContext(A,time),projectionBoundary:H.authorityBoundary}}else{const deltas=Object.fromEntries(qualityKeys.map(key=>[key,B.run&&A.run?Number(B.run.metrics?.[key]??0)-Number(A.run.metrics?.[key]??0):null]));context={kind:B.run?'mujica-run-comparison-context':'mujica-frame-context',authority:'immutable-evidence-selector',headlessArgv:['evidence','inspect','.', '--run',A.run.id,'--time',String(time),...(B.run?['--compare-run',B.run.id]:[])],sharedTimeSeconds:time,baseline:sideContext(A,time),subject:sideContext(B,time),motionQualityDeltaSubjectMinusBaseline:deltas,researchReview:selectedReview?{lineage:selectedReview.lineage,judge:selectedReview.judge,selectedCase:selectedReview.selectedCase,authorityBoundary:selectedReview.authorityBoundary}:null}}const text=JSON.stringify(context,null,2);try{await navigator.clipboard.writeText(text);q('#copy-status').textContent=T?'Copied exact residual and twin inspect command.':H?'Copied exact device telemetry selector and headless reproduction command.':'Copied exact evidence selector and headless reproduction command.'}catch{const area=document.createElement('textarea');area.value=text;document.body.appendChild(area);area.select();document.execCommand('copy');area.remove();q('#copy-status').textContent=T?'Copied exact residual selector.':H?'Copied exact device telemetry selector.':'Copied exact frame context.'}};
function observationSource(){if(selectedCapture)return{kind:'hardware-capture-event',captureId:selectedCapture.id,captureHash:selectedCapture.captureHash,eventIndex:selectedCapture.attentionEventIndex};const time=clockTimes[currentClock];if(T){const prediction=rowAt(B,time),transitionIndex=prediction?.transitionIndex;return transitionIndex===undefined?{kind:'hardware-capture-frame',captureId:H.id,captureHash:H.captureHash,bundleHash:H.bundleHash,episodeId:H.episode.id,episodeHash:H.episode.hash,timeSeconds:time}:{kind:'digital-twin-audit-transition',auditId:T.id,auditHash:T.auditHash,captureId:H.id,captureHash:H.captureHash,bundleHash:H.bundleHash,episodeId:H.episode.id,episodeHash:H.episode.hash,transitionIndex}}if(H)return{kind:'hardware-capture-frame',captureId:H.id,captureHash:H.captureHash,bundleHash:H.bundleHash,episodeId:H.episode.id,episodeHash:H.episode.hash,timeSeconds:time};return{kind:'run-frame',runId:A.run.id,resultHash:A.run.manifest.resultHash,timeSeconds:time,...(B.run?{comparisonRunId:B.run.id,comparisonResultHash:B.run.manifest.resultHash}:{})}}
function updateObservationSource(){const source=observationSource();q('#observation-source').innerHTML=source.kind==='run-frame'?'Run frame · <code>'+esc(source.runId)+'</code> at '+Number(source.timeSeconds).toFixed(3)+'s'+(source.comparisonRunId?' compared with <code>'+esc(source.comparisonRunId)+'</code>':''):source.kind==='digital-twin-audit-transition'?'Twin audit · <code>'+esc(source.auditId)+'</code> · transition '+source.transitionIndex:source.kind==='hardware-capture-frame'?'Device telemetry frame · <code>'+esc(source.captureId)+'</code> / <code>'+esc(source.episodeId)+'</code> at '+Number(source.timeSeconds).toFixed(3)+'s':'Hardware Capture · <code>'+esc(source.captureId)+'</code> · transcript event '+source.eventIndex}
function observationDraft(){const summary=q('#observation-summary').value.trim();if(!summary)throw new Error('Summary is required.');const details=q('#observation-details').value.trim(),next=q('#observation-next').value.trim();return{version:1,kind:'mujica-human-observation-draft',source:observationSource(),assessment:{category:q('#observation-category').value,severity:q('#observation-severity').value,confidence:q('#observation-confidence').value,summary,...(details?{details}:{}),...(next?{suggestedNextAction:next}:{})}}}
async function copyText(text){try{await navigator.clipboard.writeText(text)}catch{const area=document.createElement('textarea');area.value=text;document.body.appendChild(area);area.select();document.execCommand('copy');area.remove()}}
const reviewHandoff=review=>({kind:'mujica-research-review-selector',authority:'derived-human-review',claimKind:'visual-witness',research:{lab:review.lineage.researchId,session:review.lineage.sessionId,experiment:review.lineage.experimentId,brief:review.lineage.researchBriefId,observations:review.lineage.observationIds},judge:{verdict:review.judge.verdict,decisionHash:review.judge.decisionHash},selectedCase:review.selectedCase,accepted:review.accepted,candidate:review.candidate,headlessArgv:['studio','.', '--research-lab',review.lineage.researchId,'--session',review.lineage.sessionId,'--experiment',review.lineage.experimentId],authorityBoundary:review.authorityBoundary});
q('#copy-selected-review').onclick=async()=>{if(!selectedReview)return;await copyText(JSON.stringify(reviewHandoff(selectedReview),null,2));q('#selected-review-status').textContent='Copied complete Review lineage and exact Studio reproduction command. Human interpretation remains hypothesis-only.'};
document.querySelectorAll('[data-research-review-index]').forEach(node=>node.onclick=async()=>{const item=researchReviewEntries[Number(node.dataset.researchReviewIndex)];if(!item?.review)return;await copyText(JSON.stringify(reviewHandoff(item.review),null,2));q('#selected-review-status').textContent='Copied exact visual-review command for '+item.experiment.id+'. Run it to load the immutable accepted/candidate pair.'});
q('#copy-research-brief').onclick=async()=>{const observation=selectedBriefObservation(),lab=selectedBriefLab();if(!observation||!lab){q('#brief-status').textContent='Record a human observation and select a Lab first.';return}const handoff={kind:'mujica-research-brief-selector',authority:'human-selected-handoff',claimKind:'research-prioritization',observation:{id:observation.id,observationHash:observation.observationHash,contextHash:observation.contextHash},lab:{id:lab.id,benchmark:lab.benchmark,executionKind:lab.execution.kind},headlessArgv:['research','brief','.', '--lab',lab.id,'--observation',observation.id],authorityBoundary:{humanInput:'hypothesis-only',promotion:'locked-judge-only'}};await copyText(JSON.stringify(handoff,null,2));q('#brief-status').textContent='Copied exact Research Brief command. Run it to publish the immutable handoff, then use its research.run next action.'};
q('#use-current-frame').onclick=()=>{selectedCapture=null;updateObservationSource()};
q('#copy-observation').onclick=async()=>{try{await copyText(JSON.stringify(observationDraft(),null,2));q('#observation-status').textContent='Copied schema-valid human hypothesis draft. Record it explicitly with mujica observation record.'}catch(error){q('#observation-status').textContent=error.message}};
q('#download-observation').onclick=()=>{try{const text=JSON.stringify(observationDraft(),null,2)+'\\n',blob=new Blob([text],{type:'application/json'}),link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='mujica-observation-draft.json';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),0);q('#observation-status').textContent='Downloaded draft. Recording it remains an explicit CLI artifact action.'}catch(error){q('#observation-status').textContent=error.message}};
q('#replay-status').textContent=T?'A device-reported qpos · B frozen-twin one-step prediction · '+A.replay.frameCount+' synchronized frames · geometry from Bundle '+H.bundle.id:H?'Device-reported qpos · '+A.replay.frameCount+' frames · geometry from frozen Bundle '+H.bundle.id+' · not visual ground truth':[A.replay&&('A '+A.replay.renderer+' · '+A.replay.frameCount+' exact qpos frames'),B.replay&&('B '+B.replay.renderer+' · '+B.replay.frameCount+' exact qpos frames')].filter(Boolean).join(' · ')||'Generate a Run with mujica studio to add an authoritative MuJoCo replay.';
q('#sampling').textContent=T?'immutable audit window '+Number(clockTimes.at(-1)-clockTimes[0]).toFixed(3)+' s · '+H.trajectory.total+' state frames · '+T.summary.transitionCount+' one-step transitions':H?'immutable episode '+H.trajectory.total+' rows · displayed '+H.trajectory.rows.length+' · stride '+H.trajectory.stride:[A.run&&('A trajectory '+A.run.trajectory.total+' rows'),B.run&&('B trajectory '+B.run.trajectory.total+' rows')].filter(Boolean).join(' · ');
render(0);
</script></body></html>`;
}

export async function writeStudioSnapshot(projectDirectory: string, options: StudioSnapshotOptions = {}) {
  const project = await loadProject(projectDirectory); const snapshot = await buildStudioSnapshot(project.rootDir, options); const snapshotHash = hashJson(snapshot);
  const id = `studio-${snapshotHash.slice(0, 16)}`; const target = join(project.rootDir, ".mujica", "studio", id);
  if (!(await exists(join(target, "snapshot.json")))) await atomicDirectory(target, async (directory) => {
    await writeJson(join(directory, "snapshot.json"), snapshot);
    if (options.replay) await cp(options.replay.path, join(directory, "replay"), { recursive: true });
    if (options.compareReplay) await cp(options.compareReplay.path, join(directory, "comparison-replay"), { recursive: true });
    if (options.researchTimeline) {
      const replayByRun = new Map<string, ReplayInput>();
      for (const entry of options.researchTimeline.entries) {
        replayByRun.set(entry.review.accepted.id, entry.acceptedReplay);
        replayByRun.set(entry.review.candidate.id, entry.candidateReplay);
      }
      for (const [runId, replay] of replayByRun) await cp(replay.path, join(directory, "research-replays", runId), { recursive: true });
    }
    const captureReplay = options.twinAudit?.hardwareCapture.replay ?? options.hardwareCapture?.replay;
    if (captureReplay) await cp(captureReplay.path, join(directory, "hardware-replay"), { recursive: true });
    if (options.twinAudit) await cp(options.twinAudit.predictionReplay.path, join(directory, "twin-replay"), { recursive: true });
    await Bun.write(join(directory, "index.html"), studioHtml(snapshot));
  });
  return { id, snapshotHash, path: target, indexPath: join(target, "index.html"), selectedRun: snapshot.selectedRun?.id ?? null, comparisonRun: snapshot.comparisonRun?.id ?? null, snapshot };
}
