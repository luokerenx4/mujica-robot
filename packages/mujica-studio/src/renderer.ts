import { cp, readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { atomicDirectory, hashJson, sha256, writeJson } from "@mujica/core";

const UI_ROOT = resolve(import.meta.dir, "../ui");
const UI_BUILD_VERSION = 1;
const UI_ASSETS = ["assets/studio.css", "assets/studio.js"] as const;

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function sourceFiles(root: string, directory = root): Promise<Array<{ path: string; hash: string }>> {
  const values: Array<{ path: string; hash: string }> = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "dist" || entry.name === "node_modules") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) values.push(...await sourceFiles(root, path));
    else if (entry.isFile()) values.push({ path: relative(root, path), hash: sha256(await readFile(path)) });
  }
  return values.sort((a, b) => a.path.localeCompare(b.path));
}

export async function studioRendererSourceHash(legacyRendererSource: string): Promise<string> {
  return hashJson({
    version: UI_BUILD_VERSION,
    kind: "mujica-studio-react-renderer-source",
    ui: await sourceFiles(UI_ROOT),
    shell: sha256(reactStudioHtml.toString()),
    legacy: sha256(legacyRendererSource),
  });
}

async function bundleManifest(directory: string, sourceHash: string): Promise<Record<string, unknown>> {
  return {
    version: UI_BUILD_VERSION,
    kind: "mujica-studio-react-renderer-bundle",
    sourceHash,
    assets: Object.fromEntries(await Promise.all(UI_ASSETS.map(async (path) => [
      path,
      sha256(await readFile(join(directory, path))),
    ]))),
  };
}

async function validateBundle(directory: string, sourceHash: string): Promise<void> {
  const manifestPath = join(directory, "bundle-manifest.json");
  if (!(await exists(manifestPath))) throw new Error("Studio renderer bundle manifest is missing");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    sourceHash?: string;
    assets?: Record<string, string>;
  };
  if (manifest.sourceHash !== sourceHash) throw new Error("Studio renderer bundle source identity changed");
  for (const path of UI_ASSETS) {
    if (manifest.assets?.[path] !== sha256(await readFile(join(directory, path)))) {
      throw new Error(`Studio renderer bundle asset '${path}' changed`);
    }
  }
}

export async function ensureStudioRendererBundle(projectRoot: string, sourceHash: string): Promise<string> {
  const target = join(projectRoot, ".mujica", "cache", "studio-ui", sourceHash);
  if (!(await exists(join(target, "bundle-manifest.json")))) {
    await atomicDirectory(target, async (directory) => {
      const viteCli = join(UI_ROOT, "node_modules", "vite", "bin", "vite.js");
      if (!(await exists(viteCli))) {
        throw new Error("Studio UI dependencies are missing; run the repository install command");
      }
      const child = Bun.spawn([
        "node",
        viteCli,
        "build",
        UI_ROOT,
        "--config",
        join(UI_ROOT, "vite.config.ts"),
        "--outDir",
        directory,
        "--emptyOutDir",
        "--logLevel",
        "silent",
      ], { stdout: "pipe", stderr: "pipe" });
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      if (exitCode !== 0) {
        throw new Error(`Vite Studio renderer build failed${stderr || stdout ? `:\n${(stderr || stdout).trim()}` : ""}`);
      }
      for (const asset of UI_ASSETS) {
        if (!(await exists(join(directory, asset)))) throw new Error(`Vite did not produce '${asset}'`);
      }
      await writeJson(join(directory, "bundle-manifest.json"), await bundleManifest(directory, sourceHash));
    });
  }
  await validateBundle(target, sourceHash);
  return target;
}

export async function copyStudioRendererBundle(bundle: string, target: string): Promise<void> {
  await cp(join(bundle, "assets"), join(target, "assets"), { recursive: true });
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function reactStudioHtml(snapshot: {
  project: { name: string };
}): string {
  const data = JSON.stringify(snapshot)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-src 'self';">
  <title>Mujica Studio — ${escapeHtml(snapshot.project.name)}</title>
  <link rel="stylesheet" href="./assets/studio.css">
</head>
<body>
  <div id="root"></div>
  <script id="mujica-studio-snapshot" type="application/json">${data}</script>
  <script defer src="./assets/studio.js"></script>
</body>
</html>`;
}
