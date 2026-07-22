import { readdir } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import { manifestSchema, workspaceSchema } from "./schemas";
import type { MujicaManifest, ProjectContext } from "./types";
import { readJson } from "./utils";

export const PROJECT_MANIFEST = "mujica.json";
export const WORKSPACE_MANIFEST = "mujica-workspace.json";

async function exists(path: string): Promise<boolean> { return Bun.file(path).exists(); }

export async function loadProject(root: string): Promise<ProjectContext> {
  const rootDir = resolve(root);
  return { rootDir, manifest: await readJson(join(rootDir, PROJECT_MANIFEST), manifestSchema) as MujicaManifest };
}

export async function resolveProjectDirectory(input: string, projectId?: string): Promise<string> {
  const root = resolve(input);
  const isProject = await exists(join(root, PROJECT_MANIFEST));
  const isWorkspace = await exists(join(root, WORKSPACE_MANIFEST));
  if (isProject && isWorkspace) throw new Error(`Directory cannot be both a Mujica project and workspace: ${root}`);
  if (isProject) {
    if (projectId) throw new Error("--project cannot be used with a direct project directory");
    return root;
  }
  if (!isWorkspace) throw new Error(`Not a Mujica project or workspace: ${root}`);
  const workspace = await readJson(join(root, WORKSPACE_MANIFEST), workspaceSchema);
  const projectsDir = resolve(root, workspace.projectsDirectory);
  if (projectsDir !== root && !projectsDir.startsWith(`${root}${sep}`)) throw new Error("Workspace projectsDirectory escapes workspace");
  const selected = projectId ?? workspace.defaultProject;
  if (!selected) throw new Error("Workspace has no default project; pass --project ID");
  const entries = await readdir(projectsDir, { withFileTypes: true });
  const entry = entries.find((item) => item.name === selected);
  if (!entry || !entry.isDirectory() || entry.isSymbolicLink()) throw new Error(`Unknown or unsafe workspace project '${selected}'`);
  const project = await loadProject(join(projectsDir, selected));
  if (project.manifest.id !== basename(project.rootDir)) throw new Error(`Project id '${project.manifest.id}' must match directory '${basename(project.rootDir)}'`);
  return project.rootDir;
}

