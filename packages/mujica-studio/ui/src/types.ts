export type JsonScalar = string | number | boolean | null;

export interface StudioReplay {
  id: string;
  renderer?: string;
  mujocoVersion?: string;
  frameBase: string;
  frameCount: number;
  frameTimes?: number[];
  settings?: {
    width?: number;
    height?: number;
  };
}

export interface MotionQuality {
  actionSlewRatePerSec?: number[];
  jointJerkRadPerSec3?: number[];
  footSlipSpeedMps?: number[];
  footContactImpactNPerSec?: number[];
  [key: string]: unknown;
}

export interface ControllerTelemetry {
  mode?: string;
  phase?: string;
  fallenPose?: string;
  recoveryPose?: string;
  supportFeet?: number;
  targetStreakSteps?: number;
  transitionReason?: string;
  recoveryCompleted?: boolean;
  [key: string]: unknown;
}

export interface TrajectoryRow {
  time?: number;
  step?: number;
  qpos?: number[];
  healthy?: boolean;
  pitchRad?: number;
  bodyTiltRad?: number;
  motionCommand?: number[];
  measuredMotion?: number[];
  footContactForce?: number[];
  action?: number[];
  motionQuality?: MotionQuality;
  missionStage?: string;
  controllerPhase?: string;
  controllerTelemetry?: ControllerTelemetry;
  recoveryTargetSatisfied?: boolean;
  recoveryStableProgress?: number;
  recoveryStableLatched?: boolean;
  recoveryStableAtSeconds?: number;
  recoveryDeadlineExpired?: boolean;
  recoveryDeadlineExpiredAtSeconds?: number;
  jointLimitMarginRad?: number;
  disallowedSelfContact?: boolean;
  [key: string]: unknown;
}

export interface RunEvent {
  time?: number;
  type?: string;
  healthy?: boolean;
  [key: string]: unknown;
}

export interface StudioRun {
  id: string;
  manifest?: {
    resultHash?: string;
    seed?: number;
  };
  subject?: {
    assembly?: string;
    controller?: string;
    policy?: string;
  };
  inputs?: {
    task?: { id?: string; [key: string]: unknown };
    scenario?: { id?: string; [key: string]: unknown };
  };
  trajectory: {
    total: number;
    stride?: number;
    rows: TrajectoryRow[];
  };
  events?: {
    total?: number;
    rows?: RunEvent[];
  };
  metrics?: Record<string, unknown>;
}

export interface CapabilityStage {
  id: string;
  name?: string;
  question?: string;
  status: string;
  evidenceScopes?: Array<{
    assembly: string;
    controller: string;
    benchmark: string;
    revision?: string;
  }>;
  scenarios?: Array<Record<string, unknown>>;
  exitCriteria?: string[];
}

export interface StudioReplaySelection {
  selectedRun: StudioRun | null;
  selectedReplay: StudioReplay | null;
  comparisonRun: StudioRun | null;
  comparisonReplay: StudioReplay | null;
}

export interface StudioSnapshot extends StudioReplaySelection {
  version: number;
  kind: "mujica-studio-snapshot";
  renderer: {
    id: string;
    sourceHash: string;
  };
  project: {
    id: string;
    name: string;
  };
  charter: {
    title: string;
    proposition: string;
    capabilityStages: CapabilityStage[];
    northStar: {
      statement: string;
      stage?: string;
      benchmark?: string;
    };
  };
  currentDesignStudy?: {
    result?: {
      outcome?: string;
    };
  } | null;
  currentDesignProbe?: {
    result?: {
      outcome?: string;
      gatePassed?: boolean;
      nextDevelopmentEmphasis?: string;
    };
  } | null;
  selectedRun: StudioRun | null;
  selectedReplay: StudioReplay | null;
  comparisonRun: StudioRun | null;
  comparisonReplay: StudioReplay | null;
  selectedResearchReview?: {
    review?: Record<string, unknown>;
  } | null;
  runs: Array<Record<string, unknown>>;
  policies: Array<Record<string, unknown>>;
  researchSessions: Array<{
    experiments?: unknown[];
  }>;
}

export interface StudioRouteManifest {
  version: 1;
  kind: "mujica-studio-route-manifest";
  renderer: StudioSnapshot["renderer"];
  project: StudioSnapshot["project"];
  defaultRoute: string;
  paths: {
    project: string;
    designs: string;
    runs: string;
    compare: string | null;
  };
  packagedRuns: Array<{
    id: string;
    path: string;
    hasReplay: boolean;
    role: "selected" | "comparison";
  }>;
}

export interface ProjectRouteData {
  version: 1;
  kind: "mujica-studio-project-route";
  project: StudioSnapshot["project"];
  charter: StudioSnapshot["charter"];
  renderer: StudioSnapshot["renderer"];
  developmentReview: Record<string, unknown> | null;
  developmentWorkOrder: Record<string, unknown> | null;
  currentDesignProbe: StudioSnapshot["currentDesignProbe"];
  counts: {
    assemblies: number;
    runs: number;
    policies: number;
    researchSessions: number;
    researchExperiments: number;
    revisions: number;
  };
  selectedRunId: string | null;
  comparisonRunId: string | null;
}

export interface StudioAssembly {
  id: string;
  name?: string;
  hash?: string;
  totalMassKg?: number;
  componentCost?: number;
  components?: Array<Record<string, unknown>>;
  observationContract?: { size?: number; [key: string]: unknown };
  actionContract?: { size?: number; [key: string]: unknown };
}

export interface DesignRouteData {
  version: 1;
  kind: "mujica-studio-design-route";
  selectedAssembly: string;
  assemblies: StudioAssembly[];
  components: Array<Record<string, unknown>>;
  revisions: Array<Record<string, unknown>>;
  currentDesignStudy: Record<string, any> | null;
  currentDesignProbe: Record<string, any> | null;
  capabilityStages: CapabilityStage[];
}

export interface RunSummary {
  id: string;
  seed?: number;
  completed?: boolean;
  resultHash?: string;
  assemblyHash?: string;
  controllerHash?: string;
  modelHash?: string;
  trainingSteps?: number;
  mujocoVersion?: string;
  [key: string]: unknown;
}

export interface RunsRouteData {
  version: 1;
  kind: "mujica-studio-runs-route";
  runs: RunSummary[];
  packagedRuns: StudioRouteManifest["packagedRuns"];
}

export interface RunRouteData {
  version: 1;
  kind: "mujica-studio-run-route";
  run: StudioRun;
  replay: StudioReplay | null;
  role: "selected" | "comparison";
}

export interface CompareRouteData {
  version: 1;
  kind: "mujica-studio-compare-route";
  runs: {
    left: { id: string; path: string };
    right: { id: string; path: string };
  };
  selectedResearchReview: Record<string, unknown> | null;
  authorityCounterfactual: Record<string, unknown> | null;
  researchTimeline: Record<string, unknown> | null;
}

export interface ReplaySide {
  key: "A" | "B";
  run: StudioRun;
  replay: StudioReplay | null;
}

export interface MappedReplayFrame {
  frameIndex: number;
  frameTime: number;
  rowIndex: number;
  row: TrajectoryRow | null;
}
