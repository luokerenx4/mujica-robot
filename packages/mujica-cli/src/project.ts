import { cp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  atomicDirectory,
  idSchema,
  listWorkspaceProjects,
  loadDevelopmentCharter,
  loadProject,
  loadWorkspace,
  resolveProjectDirectory,
  validateProject,
  validateProjectDefinitions,
} from "@mujica/core";
import { success } from "./contract";
import { writeWorkspaceStudioSnapshot } from "@mujica/studio";

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

export const PROJECT_TEMPLATES = [{
  id: "hexapod",
  name: "Six-legged walking robot",
  description: "Executable MuJoCo hexapod with a readable tripod gait, nominal capability stage, and contact evidence from six feet.",
}] as const;

export async function projectListCommand(workspaceDirectory: string) {
  const workspace = await loadWorkspace(workspaceDirectory);
  const projects = [];
  for (const project of await listWorkspaceProjects(workspace.rootDir)) {
    const charter = await loadDevelopmentCharter(project.rootDir);
    projects.push({
      id: project.manifest.id,
      name: project.manifest.name,
      rootDir: project.rootDir,
      isDefault: project.isDefault,
      proposition: charter.proposition,
      morphology: charter.morphology,
      capabilityStages: charter.capabilityStages.map((stage) => ({ id: stage.id, name: stage.name, status: stage.status })),
    });
  }
  return success("project.list", { workspace: workspace.manifest, projects, templates: PROJECT_TEMPLATES });
}

export async function projectInspectCommand(input: string, projectId?: string) {
  const projectDirectory = await resolveProjectDirectory(input, projectId);
  const project = await loadProject(projectDirectory);
  const charter = await loadDevelopmentCharter(project.rootDir);
  const validation = await validateProject(project.rootDir);
  const definitions = await validateProjectDefinitions(project.rootDir);
  return success("project.inspect", {
    project: project.manifest,
    charter,
    assemblies: validation.assemblies.map((assembly) => ({
      id: assembly.id,
      morphology: assembly.morphology,
      observationSize: assembly.observationContract.size,
      actionSize: assembly.actionContract.size,
    })),
    definitions,
  }, project);
}

async function copyTemplate(templateRoot: string, destination: string): Promise<void> {
  for (const entry of await readdir(templateRoot, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error(`Project template contains a symlink: ${entry.name}`);
    await cp(join(templateRoot, entry.name), join(destination, entry.name), { recursive: true });
  }
}

export async function projectCreateCommand(workspaceDirectory: string, input: { id: string; name: string; template: string }) {
  const id = idSchema.parse(input.id);
  const name = input.name.trim();
  if (!name) throw new Error("Project name must not be empty");
  const template = PROJECT_TEMPLATES.find((item) => item.id === input.template);
  if (!template) throw new Error(`Unknown project template '${input.template}'`);
  const workspace = await loadWorkspace(workspaceDirectory);
  const target = join(workspace.projectsDir, id);
  if (await exists(target)) throw new Error(`Workspace project '${id}' already exists`);
  const templateRoot = resolve(import.meta.dir, "..", "templates", template.id);
  if (!(await exists(join(templateRoot, "mujica.json")))) throw new Error(`Project template '${template.id}' is unavailable`);
  await atomicDirectory(target, async (temporary) => {
    await copyTemplate(templateRoot, temporary);
    for (const filename of ["mujica.json", "development-charter.json", "morphology.json"]) {
      const path = join(temporary, filename);
      const rendered = (await readFile(path, "utf8"))
        .replaceAll("__PROJECT_ID__", id)
        .replaceAll("__PROJECT_NAME__", name);
      await writeFile(path, rendered);
    }
    await validateProject(temporary);
    await validateProjectDefinitions(temporary);
  });
  const project = await loadProject(target);
  const charter = await loadDevelopmentCharter(target);
  return success("project.create", {
    project: project.manifest,
    charter,
    template: template.id,
    path: target,
  }, project, [], [
    { id: "benchmark.lock", description: "Freeze the starter capability benchmark before evaluation", argv: ["benchmark", "lock", target, "--benchmark", project.manifest.defaults.benchmark], effect: "mutates-project" },
    { id: "simulate", description: "Run the starter scenario", argv: ["simulate", target, "--assembly", project.manifest.defaults.assembly, "--controller", project.manifest.defaults.controller, "--task", project.manifest.defaults.task, "--scenario", project.manifest.defaults.scenario], effect: "creates-artifact" },
    { id: "studio.workspace", description: "Regenerate the Workspace Studio to include the project", argv: ["studio", workspace.rootDir], effect: "creates-artifact" },
  ]);
}

export async function workspaceStudioCommand(workspaceDirectory: string) {
  const workspace = await loadWorkspace(workspaceDirectory);
  const result = await writeWorkspaceStudioSnapshot(workspace.rootDir);
  return success("studio", {
    id: result.id,
    workspace: workspace.manifest,
    projects: result.snapshot.projects.map((project) => ({ id: project.id, name: project.name, studio: project.studio?.id ?? null })),
    indexPath: result.indexPath,
  }, undefined, [{ kind: "workspace-studio-snapshot", id: result.id, path: result.path, immutable: false }]);
}
