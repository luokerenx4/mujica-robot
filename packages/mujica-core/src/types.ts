export type ChannelKind = "joint-position" | "joint-velocity" | "body-state" | "sensor" | "actuator";

export interface ContractChannel {
  name: string;
  kind: ChannelKind;
  size: number;
  source: string;
  unit: string;
  low?: number;
  high?: number;
}

export interface MountDefinition {
  id: string;
  type: string;
  site: string;
  exclusive: boolean;
}

export interface MujicaManifest {
  version: 1;
  id: string;
  name: string;
  defaults: { assembly: string; controller: string; task: string; scenario: string; objective: string; benchmark: string };
}

export interface RobotManifest {
  version: 1;
  id: string;
  name: string;
  mjcf: string;
  mounts: MountDefinition[];
  observations: ContractChannel[];
  actions: ContractChannel[];
  massKg: number;
  license: string;
  attribution: string;
}

export interface ComponentManifest {
  version: 1;
  id: string;
  name: string;
  type: string;
  fragment?: string;
  mountFragment?: string;
  compatibleMounts: string[];
  providesMounts: MountDefinition[];
  observations: ContractChannel[];
  actions: ContractChannel[];
  dependencies: string[];
  configSchema: Record<string, unknown>;
  physical: { centerOfMassM: [number, number, number]; inertiaDiagonalKgM2: [number, number, number] };
  geometry: Array<{ name: string; kind: "box" | "sphere" | "capsule" | "mesh"; collision: boolean }>;
  joints: Array<{ name: string; kind: "hinge" | "slide" | "ball" | "free"; axis?: [number, number, number] }>;
  actuators: Array<{ name: string; kind: "motor" | "position" | "velocity" | "general"; joint: string; controlRange: [number, number] }>;
  sensors: Array<{ name: string; kind: string; source: "mjcf" | "runtime" }>;
  massKg: number;
  cost: number;
  license: string;
  attribution: string;
}

export interface AssemblyComponent {
  id: string;
  component: string;
  mount: string;
  config?: Record<string, unknown>;
}

export interface AssemblyManifest {
  version: 1;
  id: string;
  name: string;
  base: string;
  components: AssemblyComponent[];
}

export interface ObservationContract { version: 1; assembly: string; channels: ContractChannel[]; size: number }
export interface ActionContract { version: 1; assembly: string; channels: ContractChannel[]; size: number }

export interface CompiledComponent {
  instanceId: string;
  componentId: string;
  mount: string;
  config: Record<string, number | string | boolean>;
  hash: string;
  massKg: number;
  cost: number;
  physical: ComponentManifest["physical"];
  geometry: ComponentManifest["geometry"];
  joints: ComponentManifest["joints"];
  actuators: ComponentManifest["actuators"];
  sensors: ComponentManifest["sensors"];
}

export interface CompiledAssembly {
  version: 1;
  id: string;
  name: string;
  projectId: string;
  rootDir: string;
  artifactDir: string;
  modelPath: string;
  assemblyHash: string;
  executionHash: string;
  modelHash: string;
  baseHash: string;
  catalogHash: string;
  totalMassKg: number;
  componentCost: number;
  components: CompiledComponent[];
  observationContract: ObservationContract;
  actionContract: ActionContract;
  sourceFiles: string[];
}

export interface AssemblyComparison {
  from: CompiledAssembly;
  to: CompiledAssembly;
  components: { added: CompiledComponent[]; removed: CompiledComponent[]; changed: Array<{ from: CompiledComponent; to: CompiledComponent }> };
  observations: { added: ContractChannel[]; removed: ContractChannel[]; changed: Array<{ from: ContractChannel; to: ContractChannel }> };
  actions: { added: ContractChannel[]; removed: ContractChannel[]; changed: Array<{ from: ContractChannel; to: ContractChannel }> };
  massDeltaKg: number;
  costDelta: number;
}

export interface ProjectContext { rootDir: string; manifest: MujicaManifest }

export interface ValidationIssue { path: string; code: string; message: string }

export class MujicaValidationError extends Error {
  constructor(public readonly issues: ValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
    this.name = "MujicaValidationError";
  }
}
