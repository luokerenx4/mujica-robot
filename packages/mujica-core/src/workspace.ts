import { lstat, readdir } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import { manifestSchema, workspaceSchema } from "./schemas";
import type { MujicaManifest, MujicaWorkspace, ProjectContext, WorkspaceContext } from "./types";
import { readJson } from "./utils";

export const PROJECT_MANIFEST = "mujica.json";
export const WORKSPACE_MANIFEST = "mujica-workspace.json";

async function exists(path: string): Promise<boolean> { return Bun.file(path).exists(); }

export async function loadProject(root: string): Promise<ProjectContext> {
  const rootDir = resolve(root);
  return { rootDir, manifest: await readJson(join(rootDir, PROJECT_MANIFEST), manifestSchema) as MujicaManifest };
}

export async function loadWorkspace(root: string): Promise<WorkspaceContext> {
  const rootDir = resolve(root);
  if (await exists(join(rootDir, PROJECT_MANIFEST))) throw new Error(`Mujica Workspace cannot also be a project: ${rootDir}`);
  const manifest = await readJson(join(rootDir, WORKSPACE_MANIFEST), workspaceSchema) as MujicaWorkspace;
  const projectsDir = resolve(rootDir, manifest.projectsDirectory);
  if (projectsDir !== rootDir && !projectsDir.startsWith(`${rootDir}${sep}`)) throw new Error("Workspace projectsDirectory escapes workspace");
  const projectsStat = await lstat(projectsDir);
  if (!projectsStat.isDirectory() || projectsStat.isSymbolicLink()) throw new Error("Workspace projectsDirectory must be a real directory");
  return { rootDir, projectsDir, manifest };
}

export async function listWorkspaceProjects(root: string): Promise<Array<ProjectContext & { isDefault: boolean }>> {
  const workspace = await loadWorkspace(root);
  const entries = await readdir(workspace.projectsDir, { withFileTypes: true });
  const projects: Array<ProjectContext & { isDefault: boolean }> = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".") || !entry.isDirectory() || entry.isSymbolicLink()) continue;
    const directory = join(workspace.projectsDir, entry.name);
    if (!(await exists(join(directory, PROJECT_MANIFEST)))) continue;
    const project = await loadProject(directory);
    if (project.manifest.id !== entry.name) throw new Error(`Project id '${project.manifest.id}' must match directory '${entry.name}'`);
    projects.push({ ...project, isDefault: workspace.manifest.defaultProject === project.manifest.id });
  }
  if (workspace.manifest.defaultProject && !projects.some((project) => project.isDefault)) {
    throw new Error(`Workspace default project '${workspace.manifest.defaultProject}' does not exist`);
  }
  return projects;
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
  const workspace = await loadWorkspace(root);
  const projectsDir = workspace.projectsDir;
  const selected = projectId ?? workspace.manifest.defaultProject;
  if (!selected) throw new Error("Workspace has no default project; pass --project ID");
  const entries = await readdir(projectsDir, { withFileTypes: true });
  const entry = entries.find((item) => item.name === selected);
  if (!entry || !entry.isDirectory() || entry.isSymbolicLink()) throw new Error(`Unknown or unsafe workspace project '${selected}'`);
  const project = await loadProject(join(projectsDir, selected));
  if (project.manifest.id !== basename(project.rootDir)) throw new Error(`Project id '${project.manifest.id}' must match directory '${basename(project.rootDir)}'`);
  return project.rootDir;
}
