import type { MujicaValidationError, ProjectContext } from "@mujica/core";

export const CLI_SCHEMA_VERSION = 1 as const;
export interface Artifact { kind: "compiled-assembly" | "simulation-run" | "training-run" | "policy" | "benchmark-lock" | "research-experiment" | "training-research-experiment" | "policy-revision" | "revision" | "studio-snapshot" | "hardware-bundle" | "hardware-verification"; id: string; path: string; immutable: boolean }
export interface NextAction { id: string; description: string; argv: string[]; effect: "read-only" | "creates-artifact" | "mutates-project" }

export function success<T>(command: string, data: T, project?: ProjectContext, artifacts: Artifact[] = [], nextActions: NextAction[] = []) {
  return { schemaVersion: CLI_SCHEMA_VERSION, ok: true as const, command, context: project ? { scope: "project" as const, project: { id: project.manifest.id, name: project.manifest.name, rootDir: project.rootDir } } : { scope: "global" as const }, data, diagnostics: [], artifacts, nextActions };
}

export function failure(command: string, error: unknown) {
  const validation = error && typeof error === "object" && (error as { name?: string }).name === "MujicaValidationError" ? error as MujicaValidationError : undefined;
  return { schemaVersion: CLI_SCHEMA_VERSION, ok: false as const, command, context: { scope: "global" as const }, error: { code: validation ? "validation.failed" : "operation.failed", message: error instanceof Error ? error.message : String(error), retryable: false, issues: validation?.issues ?? [] } };
}
