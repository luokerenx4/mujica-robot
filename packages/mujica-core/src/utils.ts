import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { ZodType } from "zod";
import { MujicaValidationError, type ValidationIssue } from "./types";

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
export function hashJson(value: unknown): string { return sha256(stableJson(value)); }

export async function readText(path: string): Promise<string> { return readFile(path, "utf8"); }
export async function readJson<T>(path: string, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try { raw = JSON.parse(await readText(path)); }
  catch (error) { throw new MujicaValidationError([{ path, code: "json.read", message: error instanceof Error ? error.message : String(error) }]); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues: ValidationIssue[] = parsed.error.issues.map((issue) => ({ path: `${path}${issue.path.length ? `/${issue.path.join("/")}` : ""}`, code: `schema.${issue.code}`, message: issue.message }));
    throw new MujicaValidationError(issues);
  }
  return parsed.data;
}

export function confined(root: string, relative: string): string {
  const absolute = resolve(root, relative);
  const normalizedRoot = resolve(root);
  if (absolute !== normalizedRoot && !absolute.startsWith(`${normalizedRoot}${sep}`)) throw new MujicaValidationError([{ path: relative, code: "path.escape", message: "path escapes its owning directory" }]);
  return absolute;
}

export async function hashDirectory(root: string): Promise<string> {
  const chunks: string[] = [];
  async function walk(directory: string, prefix: string): Promise<void> {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name === ".DS_Store" || entry.name === "__pycache__") continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) throw new MujicaValidationError([{ path: absolute, code: "path.symlink", message: "package contents may not be symlinks" }]);
      if (entry.isDirectory()) await walk(absolute, relative);
      else if (entry.isFile()) chunks.push(`${relative}\0${sha256(await readFile(absolute))}`);
    }
  }
  await walk(root, "");
  return sha256(chunks.join("\n"));
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function atomicDirectory(target: string, writer: (temporary: string) => Promise<void>): Promise<void> {
  const temporary = `${target}.partial-${process.pid}-${Date.now()}`;
  await rm(temporary, { recursive: true, force: true });
  await mkdir(temporary, { recursive: true });
  try { await writer(temporary); await mkdir(dirname(target), { recursive: true }); await rename(temporary, target); }
  catch (error) { await rm(temporary, { recursive: true, force: true }); throw error; }
}

