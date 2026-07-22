import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { assemblySchema, componentSchema, robotSchema } from "./schemas";
import type { ActionContract, AssemblyComparison, AssemblyManifest, CompiledAssembly, CompiledComponent, ComponentManifest, ContractChannel, ObservationContract, ProjectContext, RobotManifest } from "./types";
import { MujicaValidationError } from "./types";
import { confined, hashDirectory, hashJson, readJson, readText, sha256, stableJson, writeJson } from "./utils";
import { loadProject } from "./workspace";

const COMPONENT_MARKER = "<!-- MUJICA_COMPONENTS -->";

function assertUnique<T>(items: T[], key: (item: T) => string, path: string): void {
  const seen = new Set<string>();
  for (const item of items) { const id = key(item); if (seen.has(id)) throw new MujicaValidationError([{ path, code: "duplicate.id", message: `duplicate id '${id}'` }]); seen.add(id); }
}

type ComponentConfigValue = number | string | boolean;
type ComponentConfigProperty = { type?: unknown; default?: unknown; minimum?: unknown; maximum?: unknown; enum?: unknown };

function configError(path: string, code: string, message: string): never { throw new MujicaValidationError([{ path, code, message }]); }

function validateConfigValue(value: unknown, property: ComponentConfigProperty, path: string): ComponentConfigValue {
  const type = property.type;
  if (!(["number", "integer", "string", "boolean"] as unknown[]).includes(type)) configError(path, "component.config.schema", "configuration property type must be number, integer, string, or boolean");
  if ((type === "number" || type === "integer") && (typeof value !== "number" || !Number.isFinite(value))) configError(path, "component.config.type", `expected finite ${type}`);
  if (type === "integer" && !Number.isInteger(value)) configError(path, "component.config.type", "expected integer");
  if (type === "string" && typeof value !== "string") configError(path, "component.config.type", "expected string");
  if (type === "boolean" && typeof value !== "boolean") configError(path, "component.config.type", "expected boolean");
  if (typeof value === "number") {
    if (property.minimum !== undefined && (typeof property.minimum !== "number" || !Number.isFinite(property.minimum))) configError(path, "component.config.schema", "minimum must be a finite number");
    if (property.maximum !== undefined && (typeof property.maximum !== "number" || !Number.isFinite(property.maximum))) configError(path, "component.config.schema", "maximum must be a finite number");
    if (typeof property.minimum === "number" && value < property.minimum) configError(path, "component.config.minimum", `value must be at least ${property.minimum}`);
    if (typeof property.maximum === "number" && value > property.maximum) configError(path, "component.config.maximum", `value must be at most ${property.maximum}`);
  }
  if (property.enum !== undefined) {
    if (!Array.isArray(property.enum) || property.enum.length === 0) configError(path, "component.config.schema", "enum must be a non-empty array");
    if (!property.enum.some((candidate) => candidate === value)) configError(path, "component.config.enum", "value is not in the allowed enum");
  }
  return value as ComponentConfigValue;
}

function validateComponentConfig(component: ComponentManifest, config: Record<string, unknown>, path: string): Record<string, ComponentConfigValue> {
  const schema = component.configSchema as { type?: unknown; properties?: unknown; required?: unknown; additionalProperties?: unknown };
  if (schema.type !== "object" || schema.additionalProperties !== false || !schema.properties || typeof schema.properties !== "object" || Array.isArray(schema.properties)) configError(path, "component.config.schema", "configSchema must be a closed object schema with properties and additionalProperties=false");
  if (schema.required !== undefined && (!Array.isArray(schema.required) || !schema.required.every((item) => typeof item === "string"))) configError(path, "component.config.schema", "required must be an array of property names");
  const properties = schema.properties as Record<string, ComponentConfigProperty>; const required = new Set((schema.required ?? []) as string[]); const resolved: Record<string, ComponentConfigValue> = {};
  for (const key of Object.keys(config)) if (!Object.hasOwn(properties, key)) configError(`${path}/${key}`, "component.config.unknown", `unknown configuration property '${key}'`);
  for (const [key, property] of Object.entries(properties)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(key) || !property || typeof property !== "object" || Array.isArray(property)) configError(`${path}/${key}`, "component.config.schema", "configuration property must have a template-safe name and object schema");
    const supplied = Object.hasOwn(config, key); const hasDefault = Object.hasOwn(property, "default");
    if (!supplied && !hasDefault) { if (required.has(key)) configError(`${path}/${key}`, "component.config.required", `missing required configuration property '${key}'`); continue; }
    resolved[key] = validateConfigValue(supplied ? config[key] : property.default, property, `${path}/${key}`);
  }
  for (const key of required) if (!Object.hasOwn(properties, key)) configError(`${path}/${key}`, "component.config.schema", `required property '${key}' is not declared`);
  return resolved;
}

function renderComponentFragment(fragment: string, config: Record<string, ComponentConfigValue>, path: string): string {
  const used = new Set<string>();
  const rendered = fragment.replace(/\{\{config\.([A-Za-z][A-Za-z0-9_-]*)\}\}/g, (_token, key: string) => {
    if (!Object.hasOwn(config, key)) configError(path, "component.config.unresolved", `MJCF template requires configuration property '${key}'`);
    used.add(key); const value = config[key]!;
    return typeof value === "string" ? value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("'", "&apos;").replaceAll("<", "&lt;").replaceAll(">", "&gt;") : String(value);
  });
  const unresolved = rendered.match(/\{\{[^}]*\}\}/)?.[0]; if (unresolved) configError(path, "component.config.template", `invalid or unresolved MJCF template '${unresolved}'`);
  for (const key of Object.keys(config)) if (!used.has(key)) configError(path, "component.config.unused", `configuration property '${key}' is not bound in the MJCF fragment`);
  return rendered;
}

function contractDiff(from: ContractChannel[], to: ContractChannel[]): { added: ContractChannel[]; removed: ContractChannel[]; changed: Array<{ from: ContractChannel; to: ContractChannel }> } {
  const a = new Map(from.map((channel) => [channel.name, channel]));
  const b = new Map(to.map((channel) => [channel.name, channel]));
  return {
    added: to.filter((channel) => !a.has(channel.name)),
    removed: from.filter((channel) => !b.has(channel.name)),
    changed: from.flatMap((channel) => { const next = b.get(channel.name); return next && stableJson(channel) !== stableJson(next) ? [{ from: channel, to: next }] : []; }),
  };
}

export async function listComponentIds(projectDir: string): Promise<string[]> {
  const directory = join(resolve(projectDir), "components");
  const entries = await readdir(directory, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith(".")).map((entry) => entry.name).sort();
}

export async function loadComponent(projectDir: string, id: string): Promise<{ manifest: ComponentManifest; rootDir: string; hash: string }> {
  const rootDir = confined(resolve(projectDir), `components/${id}`);
  const manifest = await readJson(join(rootDir, "component.json"), componentSchema) as ComponentManifest;
  if (manifest.id !== id) throw new MujicaValidationError([{ path: join(rootDir, "component.json/id"), code: "component.directory-id", message: `component id '${manifest.id}' must match directory '${id}'` }]);
  confined(rootDir, manifest.fragment);
  return { manifest, rootDir, hash: await hashDirectory(rootDir) };
}

export async function loadAssembly(projectDir: string, id: string): Promise<AssemblyManifest> {
  const path = confined(resolve(projectDir), `assemblies/${id}.robot.json`);
  const manifest = await readJson(path, assemblySchema) as AssemblyManifest;
  if (manifest.id !== id) throw new MujicaValidationError([{ path: `${path}/id`, code: "assembly.filename-id", message: `assembly id '${manifest.id}' must match filename '${id}'` }]);
  return manifest;
}

async function loadBase(projectDir: string, id: string): Promise<{ manifest: RobotManifest; rootDir: string; hash: string }> {
  const rootDir = confined(resolve(projectDir), `robots/${id}`);
  const manifest = await readJson(join(rootDir, "robot.json"), robotSchema) as RobotManifest;
  if (manifest.id !== id) throw new MujicaValidationError([{ path: join(rootDir, "robot.json/id"), code: "robot.directory-id", message: `robot id '${manifest.id}' must match directory '${id}'` }]);
  return { manifest, rootDir, hash: await hashDirectory(rootDir) };
}

export async function compileAssembly(projectDir: string, assemblyId: string): Promise<CompiledAssembly> {
  const project = await loadProject(projectDir);
  const assembly = await loadAssembly(project.rootDir, assemblyId);
  const base = await loadBase(project.rootDir, assembly.base);
  assertUnique(base.manifest.mounts, (mount) => mount.id, `robots/${assembly.base}/robot.json/mounts`);
  assertUnique(base.manifest.observations, (channel) => channel.name, `robots/${assembly.base}/robot.json/observations`);
  assertUnique(base.manifest.actions, (channel) => channel.name, `robots/${assembly.base}/robot.json/actions`);
  assertUnique(assembly.components, (component) => component.id, `assemblies/${assemblyId}.robot.json/components`);

  const mounts = new Map(base.manifest.mounts.map((mount) => [mount.id, mount]));
  const occupied = new Set<string>();
  const resolved: Array<{ manifest: ComponentManifest; rootDir: string; compiled: CompiledComponent }> = [];
  const selectedIds = new Set(assembly.components.map((item) => item.component));
  for (const instance of assembly.components) {
    const component = await loadComponent(project.rootDir, instance.component);
    const config = validateComponentConfig(component.manifest, instance.config ?? {}, `assemblies/${assemblyId}.robot.json/components/${instance.id}/config`);
    const inventories: Array<Array<{ name: string }>> = [component.manifest.geometry, component.manifest.joints, component.manifest.actuators, component.manifest.sensors];
    for (const inventory of inventories) assertUnique(inventory, (item) => item.name, `components/${instance.component}/component.json/hardware-inventory`);
    const mount = mounts.get(instance.mount);
    if (!mount) throw new MujicaValidationError([{ path: `assemblies/${assemblyId}.robot.json/components/${instance.id}/mount`, code: "mount.unknown", message: `unknown mount '${instance.mount}'` }]);
    if (!component.manifest.compatibleMounts.includes(mount.type)) throw new MujicaValidationError([{ path: `assemblies/${assemblyId}.robot.json/components/${instance.id}/mount`, code: "mount.incompatible", message: `component '${instance.component}' does not accept mount type '${mount.type}'` }]);
    if (mount.exclusive && occupied.has(mount.id)) throw new MujicaValidationError([{ path: `assemblies/${assemblyId}.robot.json/components/${instance.id}/mount`, code: "mount.occupied", message: `exclusive mount '${mount.id}' is already occupied` }]);
    for (const dependency of component.manifest.dependencies) if (!selectedIds.has(dependency)) throw new MujicaValidationError([{ path: `components/${instance.component}/component.json/dependencies`, code: "component.dependency", message: `missing dependency '${dependency}'` }]);
    occupied.add(mount.id);
    for (const provided of component.manifest.providesMounts) {
      const id = `${instance.id}.${provided.id}`;
      if (mounts.has(id)) throw new MujicaValidationError([{ path: `components/${instance.component}/component.json/providesMounts`, code: "mount.duplicate", message: `provided mount '${id}' already exists` }]);
      mounts.set(id, { ...provided, id });
    }
    resolved.push({ manifest: component.manifest, rootDir: component.rootDir, compiled: { instanceId: instance.id, componentId: instance.component, mount: instance.mount, config, hash: component.hash, massKg: component.manifest.massKg, cost: component.manifest.cost, physical: component.manifest.physical, geometry: component.manifest.geometry, joints: component.manifest.joints, actuators: component.manifest.actuators, sensors: component.manifest.sensors } });
  }

  const observations = [...base.manifest.observations, ...resolved.flatMap((component) => component.manifest.observations)];
  const actions = [...base.manifest.actions, ...resolved.flatMap((component) => component.manifest.actions)];
  assertUnique(observations, (channel) => channel.name, `assemblies/${assemblyId}.robot.json/observation-contract`);
  assertUnique(actions, (channel) => channel.name, `assemblies/${assemblyId}.robot.json/action-contract`);
  const observationContract: ObservationContract = { version: 1, assembly: assembly.id, channels: observations, size: observations.reduce((sum, channel) => sum + channel.size, 0) };
  const actionContract: ActionContract = { version: 1, assembly: assembly.id, channels: actions, size: actions.reduce((sum, channel) => sum + channel.size, 0) };

  const baseModelPath = confined(base.rootDir, base.manifest.mjcf);
  const baseXml = await readText(baseModelPath);
  if (baseXml.split(COMPONENT_MARKER).length !== 2) throw new MujicaValidationError([{ path: baseModelPath, code: "mjcf.component-marker", message: `base MJCF must contain exactly one ${COMPONENT_MARKER}` }]);
  const fragments: string[] = [];
  for (const component of resolved) {
    const fragmentPath = confined(component.rootDir, component.manifest.fragment); const fragment = renderComponentFragment(await readText(fragmentPath), component.compiled.config, `components/${component.manifest.id}/${component.manifest.fragment}`);
    for (const sensor of component.manifest.sensors) {
      if (!component.manifest.observations.some((channel) => channel.name === sensor.name || channel.source.includes(sensor.name))) throw new MujicaValidationError([{ path: `components/${component.manifest.id}/component.json/sensors/${sensor.name}`, code: "component.sensor.channel", message: `sensor '${sensor.name}' is not represented by an Observation channel` }]);
      if (sensor.source === "mjcf" && !fragment.includes(`name="${sensor.name}"`)) throw new MujicaValidationError([{ path: `components/${component.manifest.id}/${component.manifest.fragment}`, code: "component.sensor.mjcf", message: `declared MJCF sensor '${sensor.name}' is missing from fragment` }]);
    }
    for (const item of [...component.manifest.geometry, ...component.manifest.joints, ...component.manifest.actuators]) if (!fragment.includes(`name="${item.name}"`)) throw new MujicaValidationError([{ path: `components/${component.manifest.id}/${component.manifest.fragment}`, code: "component.inventory.mjcf", message: `declared hardware '${item.name}' is missing from fragment` }]);
    fragments.push(fragment);
  }
  const composedXml = baseXml.replace(COMPONENT_MARKER, fragments.join("\n"));
  const assemblySource = await readText(join(project.rootDir, "assemblies", `${assembly.id}.robot.json`));
  const modelHash = sha256(composedXml); const executionHash = hashJson({ modelHash, observationContract, actionContract });
  const catalogHash = hashJson({ base: base.hash, components: resolved.map((item) => ({ id: item.compiled.componentId, hash: item.compiled.hash })) });
  const assemblyHash = sha256([project.manifest.id, assemblySource, base.hash, ...resolved.map((item) => `${item.compiled.instanceId}:${item.compiled.hash}`), hashJson(observationContract), hashJson(actionContract), modelHash].join("\n"));
  const artifactDir = join(project.rootDir, ".mujica", "cache", "assemblies", assemblyHash);
  await mkdir(artifactDir, { recursive: true });
  const modelPath = join(artifactDir, "model.xml");
  await writeFile(modelPath, composedXml);
  await writeJson(join(artifactDir, "observation-contract.json"), observationContract);
  await writeJson(join(artifactDir, "action-contract.json"), actionContract);
  const sourceFiles = [relative(project.rootDir, join(project.rootDir, "assemblies", `${assembly.id}.robot.json`)), relative(project.rootDir, join(base.rootDir, "robot.json")), relative(project.rootDir, baseModelPath), ...resolved.flatMap((item) => [relative(project.rootDir, join(item.rootDir, "component.json")), relative(project.rootDir, confined(item.rootDir, item.manifest.fragment))])];
  const result: CompiledAssembly = {
    version: 1, id: assembly.id, name: assembly.name, projectId: project.manifest.id, rootDir: project.rootDir, artifactDir, modelPath,
    assemblyHash, executionHash, modelHash, baseHash: base.hash, catalogHash, totalMassKg: base.manifest.massKg + resolved.reduce((sum, item) => sum + item.manifest.massKg, 0),
    componentCost: resolved.reduce((sum, item) => sum + item.manifest.cost, 0), components: resolved.map((item) => item.compiled), observationContract, actionContract, sourceFiles,
  };
  await writeJson(join(artifactDir, "compiled-assembly.json"), { ...result, rootDir: undefined, artifactDir: undefined, modelPath: "model.xml" });
  return result;
}

export async function compareAssemblies(projectDir: string, fromId: string, toId: string): Promise<AssemblyComparison> {
  const [from, to] = await Promise.all([compileAssembly(projectDir, fromId), compileAssembly(projectDir, toId)]);
  const a = new Map(from.components.map((item) => [item.instanceId, item])); const b = new Map(to.components.map((item) => [item.instanceId, item]));
  return {
    from, to,
    components: { added: to.components.filter((item) => !a.has(item.instanceId)), removed: from.components.filter((item) => !b.has(item.instanceId)), changed: from.components.flatMap((item) => { const next = b.get(item.instanceId); return next && stableJson(item) !== stableJson(next) ? [{ from: item, to: next }] : []; }) },
    observations: contractDiff(from.observationContract.channels, to.observationContract.channels), actions: contractDiff(from.actionContract.channels, to.actionContract.channels),
    massDeltaKg: to.totalMassKg - from.totalMassKg, costDelta: to.componentCost - from.componentCost,
  };
}

export async function listAssemblyIds(projectDir: string): Promise<string[]> {
  const entries = await readdir(join(resolve(projectDir), "assemblies"), { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".robot.json")).map((entry) => entry.name.slice(0, -".robot.json".length)).sort();
}

export async function validateProject(projectDir: string): Promise<{ project: ProjectContext; assemblies: CompiledAssembly[]; components: string[] }> {
  const project = await loadProject(projectDir); const ids = await listAssemblyIds(project.rootDir); const assemblies: CompiledAssembly[] = [];
  for (const id of ids) assemblies.push(await compileAssembly(project.rootDir, id));
  const defaults = project.manifest.defaults;
  if (!ids.includes(defaults.assembly)) throw new MujicaValidationError([{ path: "mujica.json/defaults/assembly", code: "reference.assembly", message: `unknown default assembly '${defaults.assembly}'` }]);
  return { project, assemblies, components: await listComponentIds(project.rootDir) };
}
