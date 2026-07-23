import { createReadStream } from "node:fs";
import { lstat, readFile, readdir, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join, resolve } from "node:path";
import {
  atomicDirectory,
  confined,
  hashJson,
  humanObservationDraftSchema,
  loadProject,
  sha256,
  writeJson,
  type HumanObservationDraft,
} from "@mujica/core";
import { success, type Artifact } from "./contract";
import { verifyHardwareCaptureIntegrity } from "./hardware";

const qualityKeys = [
  "meanJointJerkRadPerSec3",
  "meanBodyAngularJerkRadPerSec3",
  "meanActionSlewRatePerSec",
  "actuatorSaturationRate",
  "meanFootSlipSpeedMps",
  "peakFootContactImpactNPerSec",
  "totalFootSlipDistanceM",
] as const;

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

async function readNdjson(path: string): Promise<Array<Record<string, any>>> {
  const input = createReadStream(path, { encoding: "utf8" });
  const reader = createInterface({ input, crlfDelay: Infinity });
  const rows: Array<Record<string, any>> = [];
  for await (const line of reader) if (line.trim()) rows.push(JSON.parse(line));
  return rows;
}

function atOrBefore(rows: Array<Record<string, any>>, timeSeconds: number): number {
  if (!rows.length) throw new Error("Evidence context requires at least one trajectory row");
  let index = 0;
  for (let candidate = 0; candidate < rows.length; candidate++) {
    if (Number(rows[candidate]?.time ?? 0) <= timeSeconds + 1e-9) index = candidate;
    else break;
  }
  return index;
}

function withContextHash<T extends Record<string, unknown>>(context: T): T & { contextHash: string } {
  return { ...context, contextHash: hashJson(context) };
}

async function runSide(projectRoot: string, runId: string, timeSeconds: number) {
  const root = confined(projectRoot, `runs/${runId}`);
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error(`Simulation Run '${runId}' is not a real artifact directory`);
  const manifestPath = join(root, "manifest.json");
  const trajectoryPath = join(root, "trajectory.ndjson");
  const eventsPath = join(root, "events.ndjson");
  const metricsPath = join(root, "metrics.json");
  const scorePath = join(root, "score.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.id !== runId || manifest.completed !== true || typeof manifest.resultHash !== "string") {
    throw new Error(`Simulation Run '${runId}' is incomplete or has invalid identity`);
  }
  const [trajectory, events, metrics, score] = await Promise.all([
    readNdjson(trajectoryPath),
    readNdjson(eventsPath),
    readFile(metricsPath, "utf8").then(JSON.parse),
    readFile(scorePath, "utf8").then(JSON.parse),
  ]);
  const rowIndex = atOrBefore(trajectory, timeSeconds);
  const row = trajectory[rowIndex]!;
  const rowTimeSeconds = Number(row.time ?? 0);
  const nearbyEvents = events
    .map((event, eventIndex) => ({ eventIndex, event }))
    .filter(({ event }) => Math.abs(Number(event.time ?? 0) - rowTimeSeconds) <= 0.011);
  return {
    runId,
    resultHash: manifest.resultHash,
    rowIndex,
    rowTimeSeconds,
    simulationStep: row.step ?? null,
    row,
    nearbyEvents,
    metrics,
    score,
    artifactHashes: {
      manifest: sha256(await readFile(manifestPath)),
      trajectory: sha256(await readFile(trajectoryPath)),
      events: sha256(await readFile(eventsPath)),
      metrics: sha256(await readFile(metricsPath)),
      score: sha256(await readFile(scorePath)),
    },
  };
}

export async function runEvidenceContext(projectRoot: string, runId: string, timeSeconds: number, comparisonRunId?: string) {
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0) throw new Error("Run evidence --time must be a finite non-negative number");
  const baseline = await runSide(projectRoot, runId, timeSeconds);
  const subject = comparisonRunId ? await runSide(projectRoot, comparisonRunId, timeSeconds) : null;
  const motionQualityDeltaSubjectMinusBaseline = Object.fromEntries(qualityKeys.map((key) => {
    const baselineValue = Number(baseline.metrics?.[key]);
    const subjectValue = Number(subject?.metrics?.[key]);
    return [key, subject && Number.isFinite(baselineValue) && Number.isFinite(subjectValue) ? subjectValue - baselineValue : null];
  }));
  return withContextHash({
    version: 1,
    kind: "mujica-run-frame-context",
    authority: "immutable-evidence",
    requestedTimeSeconds: timeSeconds,
    baseline,
    subject,
    motionQualityDeltaSubjectMinusBaseline,
  });
}

export async function captureEvidenceContext(projectRoot: string, captureId: string, eventIndex: number) {
  if (!Number.isInteger(eventIndex) || eventIndex < 0) throw new Error("Capture evidence --event must be a non-negative integer");
  const root = confined(projectRoot, `hardware-captures/${captureId}`);
  const manifest = await verifyHardwareCaptureIntegrity(root);
  const transcriptPath = join(root, "transcript.ndjson");
  const transcript = await readNdjson(transcriptPath);
  if (eventIndex >= transcript.length) throw new Error(`Hardware Capture '${captureId}' has no transcript event ${eventIndex}`);
  const start = Math.max(0, eventIndex - 2);
  const end = Math.min(transcript.length, eventIndex + 3);
  return withContextHash({
    version: 1,
    kind: "mujica-hardware-capture-event-context",
    authority: "immutable-evidence",
    capture: {
      id: manifest.id,
      captureHash: manifest.captureHash,
      status: manifest.status,
      environment: manifest.environment,
      mode: manifest.mode,
      reasons: manifest.reasons,
      transcriptHash: manifest.transcriptHash,
    },
    eventIndex,
    event: transcript[eventIndex],
    neighboringEvents: transcript.slice(start, end).map((event, offset) => ({ eventIndex: start + offset, event })),
    transcriptLength: transcript.length,
    transcriptBytesHash: sha256(await readFile(transcriptPath)),
  });
}

export async function captureEpisodeFrameContext(projectRoot: string, captureId: string, episodeId: string, timeSeconds: number) {
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0) throw new Error("Capture episode evidence --time must be a finite non-negative number");
  const root = confined(projectRoot, `hardware-captures/${captureId}`);
  const manifest = await verifyHardwareCaptureIntegrity(root);
  const episode = (manifest.episodes ?? []).find((item: any) => item.id === episodeId);
  if (!episode) throw new Error(`Hardware Capture '${captureId}' has no episode '${episodeId}'`);
  if (episode.completed !== true || typeof episode.path !== "string" || typeof episode.hash !== "string") {
    throw new Error(`Hardware Capture episode '${episodeId}' is not a completed immutable episode`);
  }
  const episodePath = confined(root, episode.path);
  const bytes = await readFile(episodePath);
  if (sha256(bytes) !== episode.hash) throw new Error(`Hardware Capture episode '${episodeId}' bytes changed`);
  const rows = await readNdjson(episodePath);
  if (!rows.length) throw new Error(`Hardware Capture episode '${episodeId}' has no telemetry rows`);
  for (const [index, row] of rows.entries()) {
    if (
      row.episode !== episodeId
      || !Number.isFinite(Number(row.time))
      || !Array.isArray(row.qpos)
      || !Array.isArray(row.qvel)
      || !row.deviceHealth
    ) throw new Error(`Hardware Capture episode '${episodeId}' row ${index} has an invalid telemetry contract`);
  }
  const rowIndex = atOrBefore(rows, timeSeconds);
  const start = Math.max(0, rowIndex - 2);
  const end = Math.min(rows.length, rowIndex + 3);
  const row = rows[rowIndex]!;
  return withContextHash({
    version: 1,
    kind: "mujica-hardware-capture-frame-context",
    authority: "immutable-device-telemetry",
    projectionBoundary: {
      kinematics: "device-reported",
      geometry: "bundle-frozen-digital-twin",
      visualGroundTruth: false,
      hardwareVerification: "unchanged",
    },
    capture: {
      id: manifest.id,
      captureHash: manifest.captureHash,
      bundleHash: manifest.bundleHash,
      status: manifest.status,
      environment: manifest.environment,
      mode: manifest.mode,
      target: manifest.target,
      device: manifest.device,
      operator: manifest.operator,
    },
    episode: {
      id: episode.id,
      hash: episode.hash,
      plannedSteps: episode.plannedSteps,
      steps: episode.steps,
      path: episode.path,
    },
    requestedTimeSeconds: timeSeconds,
    rowIndex,
    rowTimeSeconds: Number(row.time),
    deviceStep: row.step ?? null,
    row,
    neighboringRows: rows.slice(start, end).map((item, offset) => ({ rowIndex: start + offset, row: item })),
    artifactHashes: {
      manifest: sha256(await readFile(join(root, "manifest.json"))),
      episode: sha256(bytes),
    },
  });
}

export async function evidenceInspectCommand(
  projectDir: string,
  options: { run?: string; time?: number; compareRun?: string; capture?: string; event?: number; episode?: string },
) {
  const project = await loadProject(projectDir);
  if (Boolean(options.run) === Boolean(options.capture)) {
    throw new Error("Usage: mujica evidence inspect <project> (--run ID --time S [--compare-run ID] | --capture ID (--event N | --episode ID --time S))");
  }
  if (options.run) {
    if (options.time === undefined || options.event !== undefined || options.episode !== undefined) throw new Error("Run evidence requires --time and does not accept Capture selectors");
    return success("evidence.inspect", await runEvidenceContext(project.rootDir, options.run, options.time, options.compareRun), project);
  }
  if (options.compareRun !== undefined) throw new Error("Hardware Capture evidence does not accept --compare-run");
  const eventMode = options.event !== undefined;
  const episodeMode = options.episode !== undefined || options.time !== undefined;
  if (eventMode === episodeMode) {
    throw new Error("Hardware Capture evidence requires either --event N or --episode ID --time S");
  }
  if (eventMode) return success("evidence.inspect", await captureEvidenceContext(project.rootDir, options.capture!, options.event!), project);
  if (options.episode === undefined || options.time === undefined) throw new Error("Hardware Capture frame evidence requires --episode and --time together");
  return success("evidence.inspect", await captureEpisodeFrameContext(project.rootDir, options.capture!, options.episode, options.time), project);
}

async function observationDirectories(root: string): Promise<string[]> {
  if (!(await exists(root))) return [];
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && entry.name.startsWith("observation-"))
    .map((entry) => entry.name)
    .sort();
}

export async function verifyHumanObservation(root: string) {
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Human observation must be a real artifact directory");
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  const draft = humanObservationDraftSchema.parse(JSON.parse(await readFile(join(root, "draft.json"), "utf8")));
  const context = JSON.parse(await readFile(join(root, "context.json"), "utf8"));
  const { contextHash, ...contextBody } = context;
  if (typeof contextHash !== "string" || hashJson(contextBody) !== contextHash || contextHash !== manifest.contextHash) {
    throw new Error("Human observation context identity is invalid");
  }
  if (hashJson(draft) !== manifest.draftHash || hashJson(draft.source) !== hashJson(manifest.source) || hashJson(draft.assessment) !== hashJson(manifest.assessment)) {
    throw new Error("Human observation draft identity is invalid");
  }
  const identity = {
    version: manifest.version,
    kind: manifest.kind,
    authority: manifest.authority,
    claimKind: manifest.claimKind,
    observer: manifest.observer,
    recordedAt: manifest.recordedAt,
    source: manifest.source,
    assessment: manifest.assessment,
    contextHash: manifest.contextHash,
    draftHash: manifest.draftHash,
  };
  if (
    manifest.completed !== true
    || manifest.kind !== "mujica-human-observation"
    || manifest.authority !== "human"
    || manifest.claimKind !== "hypothesis"
    || hashJson(identity) !== manifest.observationHash
    || manifest.id !== `observation-${manifest.observationHash.slice(0, 16)}`
  ) {
    throw new Error("Human observation manifest identity is invalid");
  }
  return { manifest, draft, context };
}

async function contextForDraft(projectRoot: string, draft: HumanObservationDraft) {
  if (draft.source.kind === "run-frame") {
    const context = await runEvidenceContext(projectRoot, draft.source.runId, draft.source.timeSeconds, draft.source.comparisonRunId);
    if (
      context.baseline.resultHash !== draft.source.resultHash
      || (draft.source.comparisonResultHash !== undefined && context.subject?.resultHash !== draft.source.comparisonResultHash)
    ) {
      throw new Error("Human observation Run source identity differs from current immutable evidence");
    }
    return context;
  }
  if (draft.source.kind === "hardware-capture-frame") {
    const context = await captureEpisodeFrameContext(projectRoot, draft.source.captureId, draft.source.episodeId, draft.source.timeSeconds);
    if (
      context.capture.captureHash !== draft.source.captureHash
      || context.capture.bundleHash !== draft.source.bundleHash
      || context.episode.hash !== draft.source.episodeHash
    ) throw new Error("Human observation Capture frame source identity differs from current immutable evidence");
    return context;
  }
  const context = await captureEvidenceContext(projectRoot, draft.source.captureId, draft.source.eventIndex);
  if (context.capture.captureHash !== draft.source.captureHash) {
    throw new Error("Human observation Capture source identity differs from current immutable evidence");
  }
  return context;
}

export async function observationRecordCommand(projectDir: string, inputPath: string, observer: string) {
  const project = await loadProject(projectDir);
  const input = resolve(inputPath);
  const inputStat = await lstat(input);
  if (!inputStat.isFile() || inputStat.isSymbolicLink()) throw new Error("Human observation input must be a regular non-symlink JSON file");
  const draft = humanObservationDraftSchema.parse(JSON.parse(await readFile(input, "utf8")));
  const normalizedObserver = observer.trim();
  if (!normalizedObserver || normalizedObserver.length > 120) throw new Error("Human observation --observer must contain 1..120 characters");
  const context = await contextForDraft(project.rootDir, draft);
  const recordedAt = new Date().toISOString();
  const identity = {
    version: 1,
    kind: "mujica-human-observation",
    authority: "human",
    claimKind: "hypothesis",
    observer: normalizedObserver,
    recordedAt,
    source: draft.source,
    assessment: draft.assessment,
    contextHash: context.contextHash,
    draftHash: hashJson(draft),
  };
  const observationHash = hashJson(identity);
  const id = `observation-${observationHash.slice(0, 16)}`;
  const path = join(project.rootDir, "human-observations", id);
  const manifest = { ...identity, id, observationHash, completed: true };
  await atomicDirectory(path, async (directory) => {
    await writeJson(join(directory, "draft.json"), draft);
    await writeJson(join(directory, "context.json"), context);
    await writeJson(join(directory, "manifest.json"), manifest);
  });
  const artifact: Artifact = { kind: "human-observation", id, path, immutable: true };
  return success("observation.record", { id, observationHash, path, manifest, context }, project, [artifact], [
    { id: "inspect-observation", description: "Inspect the immutable human hypothesis and exact source evidence", argv: ["observation", "inspect", project.rootDir, "--observation", id], effect: "read-only" },
  ]);
}

export async function observationListCommand(projectDir: string) {
  const project = await loadProject(projectDir);
  const root = join(project.rootDir, "human-observations");
  const observations = [];
  for (const id of await observationDirectories(root)) observations.push((await verifyHumanObservation(join(root, id))).manifest);
  return success("observation.list", { observations }, project);
}

export async function observationInspectCommand(projectDir: string, id: string) {
  const project = await loadProject(projectDir);
  const path = confined(project.rootDir, `human-observations/${id}`);
  const observation = await verifyHumanObservation(path);
  return success("observation.inspect", { ...observation, path }, project);
}
