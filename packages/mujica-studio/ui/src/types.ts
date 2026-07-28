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
  status: string;
}

export interface StudioSnapshot {
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
