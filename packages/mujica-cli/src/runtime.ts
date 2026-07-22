import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { CompiledAssembly } from "@mujica/core";
import { hashJson } from "@mujica/core";

const runtimeRoot = resolve(import.meta.dir, "../../../runtime");
export const runtimeVersion = "0.1.0";

export function runtimeCompiled(assembly: CompiledAssembly): Record<string, unknown> {
  const actionLow = assembly.actionContract.channels.flatMap((channel) => Array(channel.size).fill(channel.low ?? -1));
  const actionHigh = assembly.actionContract.channels.flatMap((channel) => Array(channel.size).fill(channel.high ?? 1));
  return {
    version: assembly.version, id: assembly.id, assemblyHash: assembly.assemblyHash, baseHash: assembly.baseHash, catalogHash: assembly.catalogHash,
    totalMassKg: assembly.totalMassKg, componentCost: assembly.componentCost, components: assembly.components,
    observationContract: assembly.observationContract, actionContract: assembly.actionContract,
    observationContractHash: hashJson(assembly.observationContract), actionContractHash: hashJson(assembly.actionContract),
    actionLow, actionHigh, sensorChannelCount: assembly.observationContract.channels.filter((channel) => channel.kind === "sensor").reduce((sum, channel) => sum + channel.size, 0),
  };
}

export async function invokeRuntime(operation: "validate" | "simulate" | "evaluate-case" | "train", request: Record<string, unknown>): Promise<any> {
  const directory = await mkdtemp(join(tmpdir(), "mujica-request-"));
  const requestPath = join(directory, "request.json");
  await writeFile(requestPath, JSON.stringify(request));
  try {
    const child = Bun.spawnSync(["uv", "run", "--project", runtimeRoot, "python", "-m", "mujica_runtime.cli", operation, "--request", requestPath], {
      cwd: resolve(runtimeRoot, ".."), stdout: "pipe", stderr: "pipe", env: { ...process.env, PYTHONPATH: join(runtimeRoot, "src") },
    });
    const stdout = child.stdout.toString(); const stderr = child.stderr.toString();
    if (child.exitCode !== 0) throw new Error(`Python Runtime ${operation} failed${stderr ? `:\n${stderr.trim()}` : ""}`);
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
