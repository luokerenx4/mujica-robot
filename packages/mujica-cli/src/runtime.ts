import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { CompiledAssembly } from "@mujica/core";
import { hashDirectory, hashJson, sha256 } from "@mujica/core";

const runtimeRoot = resolve(import.meta.dir, "../../../runtime");
export const runtimeVersion = "0.2.0";
let sourceHashPromise: Promise<string> | undefined;
let harnessHashPromise: Promise<string> | undefined;
let harnessDependencyHashPromise: Promise<string> | undefined;

export function runtimeSourceHash(): Promise<string> {
  sourceHashPromise ??= hashDirectory(join(runtimeRoot, "src", "mujica_runtime"));
  return sourceHashPromise;
}

async function productionTreeHash(root: string): Promise<string> {
  const chunks: string[] = [];
  async function walk(directory: string, prefix: string): Promise<void> {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.includes(".test.") || entry.name === "__pycache__" || entry.name === ".DS_Store") continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name; const absolute = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Harness source contains a symlink: ${absolute}`);
      if (entry.isDirectory()) await walk(absolute, relative); else if (entry.isFile()) chunks.push(`${relative}\0${sha256(await readFile(absolute))}`);
    }
  }
  await walk(root, ""); return sha256(chunks.join("\n"));
}

export function harnessSourceHash(): Promise<string> {
  harnessHashPromise ??= Promise.all([
    runtimeSourceHash(), productionTreeHash(resolve(runtimeRoot, "../packages/mujica-core/src")), productionTreeHash(resolve(runtimeRoot, "../packages/mujica-cli/src")),
  ]).then(([runtime, core, cli]) => hashJson({ runtime, core, cli }));
  return harnessHashPromise;
}

export function harnessDependencyLockHash(): Promise<string> {
  harnessDependencyHashPromise ??= Promise.all([dependencyLockHash(), readFile(resolve(runtimeRoot, "../bun.lock"))]).then(([python, bun]) => hashJson({ python, bun: sha256(bun) }));
  return harnessDependencyHashPromise;
}

export function runtimeCompiled(assembly: CompiledAssembly): Record<string, unknown> {
  const actionLow = assembly.actionContract.channels.flatMap((channel) => Array(channel.size).fill(channel.low ?? -1));
  const actionHigh = assembly.actionContract.channels.flatMap((channel) => Array(channel.size).fill(channel.high ?? 1));
  return {
    version: assembly.version, id: assembly.id, assemblyHash: assembly.assemblyHash, executionHash: assembly.executionHash, modelHash: assembly.modelHash, plantHash: assembly.plantHash, baseHash: assembly.baseHash, catalogHash: assembly.catalogHash,
    totalMassKg: assembly.totalMassKg, componentCost: assembly.componentCost, components: assembly.components,
    observationContract: assembly.observationContract, actionContract: assembly.actionContract,
    observationContractHash: hashJson(assembly.observationContract), actionContractHash: hashJson(assembly.actionContract),
    actionLow, actionHigh, sensorChannelCount: assembly.observationContract.channels.filter((channel) => channel.kind === "sensor").reduce((sum, channel) => sum + channel.size, 0),
  };
}

export async function invokeRuntime(operation: "validate" | "simulate" | "evaluate-case" | "train" | "calibrate" | "hardware-capture" | "render-replay" | "audit-twin", request: Record<string, unknown>, timeoutMs?: number): Promise<any> {
  const directory = await mkdtemp(join(tmpdir(), "mujica-request-"));
  const requestPath = join(directory, "request.json");
  await writeFile(requestPath, JSON.stringify(request));
  try {
    const child = Bun.spawnSync(["uv", "run", "--project", runtimeRoot, "python", "-m", "mujica_runtime.cli", operation, "--request", requestPath], {
      cwd: resolve(runtimeRoot, ".."), stdout: "pipe", stderr: "pipe", env: { ...process.env, PYTHONPATH: join(runtimeRoot, "src") },
      ...(timeoutMs === undefined ? {} : { timeout: Math.max(1, Math.floor(timeoutMs)) }),
    });
    const stdout = child.stdout.toString(); const stderr = child.stderr.toString();
    if (child.exitCode !== 0) throw new Error(`Python Runtime ${operation} failed${child.signalCode ? ` (${child.signalCode})` : ""}${stderr ? `:\n${stderr.trim()}` : ""}`);
    try { return JSON.parse(stdout); }
    catch { throw new Error(`Python Runtime returned invalid JSON: ${stdout.slice(0, 500)}`); }
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export async function dependencyLockHash(): Promise<string> {
  const { sha256 } = await import("@mujica/core");
  const lock = join(runtimeRoot, "uv.lock");
  return sha256(await readFile(await Bun.file(lock).exists() ? lock : join(runtimeRoot, "pyproject.toml")));
}

export function getRuntimeRoot(): string { return runtimeRoot; }
