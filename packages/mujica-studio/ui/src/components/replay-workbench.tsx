import * as React from "react";
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  Check,
  Clipboard,
  Gauge,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import type {
  MappedReplayFrame,
  ReplaySide,
  StudioReplay,
  StudioRun,
  StudioSnapshot,
  TrajectoryRow,
} from "@/types";

const FRAME_DIGITS = 6;
const EPSILON_SECONDS = 1e-9;

function framePath(replay: StudioReplay, frame: number): string {
  return `${replay.frameBase}/${String(frame).padStart(FRAME_DIGITS, "0")}.png`;
}

function timesFor(run: StudioRun, replay: StudioReplay | null): number[] {
  if (replay?.frameTimes?.length) return replay.frameTimes.map(Number);
  return run.trajectory.rows.map((row) => Number(row.time ?? 0));
}

function atOrBefore(times: number[], time: number): number {
  let found = 0;
  for (let index = 0; index < times.length; index += 1) {
    if (Number(times[index]) <= time + EPSILON_SECONDS) found = index;
    else break;
  }
  return found;
}

function mappedFrame(side: ReplaySide, time: number): MappedReplayFrame {
  const frameTimes = timesFor(side.run, side.replay);
  const frameIndex = frameTimes.length ? atOrBefore(frameTimes, time) : 0;
  const rowTimes = side.run.trajectory.rows.map((row) => Number(row.time ?? 0));
  const rowIndex = rowTimes.length ? atOrBefore(rowTimes, time) : 0;
  return {
    frameIndex,
    frameTime: frameTimes[frameIndex] ?? Number(side.run.trajectory.rows[rowIndex]?.time ?? 0),
    rowIndex,
    row: side.run.trajectory.rows[rowIndex] ?? null,
  };
}

function vector(value: unknown): string {
  return Array.isArray(value)
    ? value.map((item) => Number(item).toFixed(3)).join(", ")
    : "—";
}

function peak(value: unknown): number | null {
  return Array.isArray(value)
    ? Math.max(0, ...value.map((item) => Math.abs(Number(item))))
    : null;
}

function numberMetric(run: StudioRun, key: string): number | null {
  const value = Number(run.metrics?.[key]);
  return Number.isFinite(value) ? value : null;
}

function isRecoveryRun(run: StudioRun): boolean {
  return Boolean(run.metrics?.selfRightingTask);
}

function recoveryLabel(run: StudioRun, row: TrajectoryRow | null): string {
  if (row?.recoveryStableLatched) return "Stable latched";
  if (row?.recoveryTargetSatisfied) return "Target holding";
  return Number(run.metrics?.selfRightingSuccess) === 1 ? "Recovered" : "Not recovered";
}

function evidenceStatus(run: StudioRun, row: TrajectoryRow | null): {
  label: string;
  variant: "success" | "destructive" | "warning";
} {
  if (isRecoveryRun(run)) {
    const recovered = Number(run.metrics?.selfRightingSuccess) === 1;
    return {
      label: recoveryLabel(run, row),
      variant: recovered ? "success" : "destructive",
    };
  }
  const healthy = row?.healthy !== false;
  return { label: healthy ? "Healthy" : "Unhealthy", variant: healthy ? "success" : "destructive" };
}

function telemetry(run: StudioRun, row: TrajectoryRow | null): Array<[string, string]> {
  const quality = row?.motionQuality;
  const cells: Array<[string, string]> = [
    ["Time", `${Number(row?.time ?? 0).toFixed(3)} s`],
    ["Step", row?.step === undefined ? "—" : String(row.step)],
    ["Mission stage", row?.missionStage ?? "atomic benchmark"],
    ["Pitch", `${Number(row?.pitchRad ?? 0).toFixed(3)} rad`],
    ["Body tilt", `${Number(row?.bodyTiltRad ?? 0).toFixed(3)} rad`],
    ["Command", vector(row?.motionCommand)],
    ["Measured", vector(row?.measuredMotion)],
    ["Action slew", peak(quality?.actionSlewRatePerSec)?.toFixed(2) ?? "—"],
    ["Joint jerk", peak(quality?.jointJerkRadPerSec3)?.toFixed(2) ?? "—"],
    ["Foot slip", peak(quality?.footSlipSpeedMps)?.toFixed(3) ?? "—"],
    ["Contact impact", peak(quality?.footContactImpactNPerSec)?.toFixed(1) ?? "—"],
  ];
  if (isRecoveryRun(run)) {
    cells.push(
      ["Fallen pose", row?.controllerTelemetry?.fallenPose ?? "unreported"],
      ["Recovery pose", row?.controllerTelemetry?.recoveryPose ?? "unreported"],
      ["Support feet", row?.controllerTelemetry?.supportFeet === undefined ? "unreported" : String(row.controllerTelemetry.supportFeet)],
      ["Recovery target", row?.recoveryTargetSatisfied ? "inside · holding" : "outside"],
      ["Stable dwell", Number.isFinite(Number(row?.recoveryStableProgress)) ? `${(100 * Number(row?.recoveryStableProgress)).toFixed(0)}%` : "not declared"],
      ["Joint-limit margin", `${Number(row?.jointLimitMarginRad ?? 0).toFixed(3)} rad`],
      ["Self-contact", row?.disallowedSelfContact ? "CONTACT" : "clear"],
    );
  }
  return cells;
}

function agentSideContext(side: ReplaySide, frame: MappedReplayFrame): Record<string, unknown> {
  return {
    runId: side.run.id,
    resultHash: side.run.manifest?.resultHash ?? null,
    replayId: side.replay?.id ?? null,
    replayFrame: frame.frameIndex,
    mappedFrameTimeSeconds: frame.frameTime,
    simulationStep: frame.row?.step ?? null,
    rowTimeSeconds: frame.row?.time ?? null,
    missionStage: frame.row?.missionStage ?? null,
    healthy: frame.row?.healthy ?? null,
    pitchRad: frame.row?.pitchRad ?? null,
    bodyTiltRad: frame.row?.bodyTiltRad ?? null,
    motionCommand: frame.row?.motionCommand ?? null,
    measuredMotion: frame.row?.measuredMotion ?? null,
    footContactForce: frame.row?.footContactForce ?? null,
    controller: {
      phase: frame.row?.controllerPhase ?? frame.row?.controllerTelemetry?.phase ?? null,
      telemetry: frame.row?.controllerTelemetry ?? null,
    },
    action: frame.row?.action ?? null,
  };
}

function RunReplayCard({
  side,
  time,
}: {
  side: ReplaySide;
  time: number;
}): React.JSX.Element {
  const mapped = mappedFrame(side, time);
  const status = evidenceStatus(side.run, mapped.row);
  const title = side.run.subject?.assembly ?? side.run.id;
  const details = telemetry(side.run, mapped.row);

  React.useEffect(() => {
    if (!side.replay) return;
    const preload = new Image();
    preload.src = framePath(
      side.replay,
      Math.min(side.replay.frameCount - 1, mapped.frameIndex + 1),
    );
  }, [mapped.frameIndex, side.replay]);

  return (
    <Card className="min-w-0 overflow-hidden bg-slate-950/70">
      <CardHeader className="border-b border-white/[0.07] pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2">
              <Badge>{side.key}</Badge>
              <Badge variant={status.variant}>{status.label}</Badge>
            </div>
            <CardTitle className="truncate text-lg">{title}</CardTitle>
            <CardDescription className="truncate">
              {side.run.subject?.controller ?? "unknown controller"} · seed {side.run.manifest?.seed ?? "—"}
            </CardDescription>
          </div>
          <span className="font-mono text-[11px] text-slate-500">
            {side.run.id.slice(0, 18)}
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="relative aspect-[4/3] overflow-hidden bg-[#04070a]">
          {side.replay ? (
            <img
              src={framePath(side.replay, mapped.frameIndex)}
              alt={`${side.key} ${title} MuJoCo replay`}
              className="size-full object-contain"
            />
          ) : (
            <div className="grid size-full place-items-center px-8 text-center text-sm text-slate-500">
              This immutable Run has no rendered replay.
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/90 to-transparent px-4 pb-3 pt-10 font-mono text-[11px] text-slate-300">
            <span>frame {mapped.frameIndex + 1} / {Math.max(1, side.replay?.frameCount ?? side.run.trajectory.total)}</span>
            <span>{mapped.frameTime.toFixed(3)} s · step {mapped.row?.step ?? "—"}</span>
          </div>
        </div>
        <details className="group border-t border-white/[0.07]">
          <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-sm font-medium text-slate-300 hover:bg-white/[0.03]">
            Frame telemetry
            <span className="text-xs text-slate-500 group-open:hidden">show {details.length} fields</span>
            <span className="hidden text-xs text-slate-500 group-open:inline">collapse</span>
          </summary>
          <div className="grid grid-cols-2 gap-px border-t border-white/[0.07] bg-white/[0.06] sm:grid-cols-3">
            {details.map(([label, value]) => (
              <div key={label} className="min-w-0 bg-slate-950/90 px-4 py-3">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</div>
                <div className="truncate font-mono text-xs text-slate-200" title={value}>{value}</div>
              </div>
            ))}
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

function OutcomeStrip({ sides }: { sides: ReplaySide[] }): React.JSX.Element {
  const recovery = sides.some((side) => isRecoveryRun(side.run));
  const keys = recovery
    ? ["selfRightingSuccess", "timeToStableStandSeconds", "finalBodyTiltRad", "minimumJointLimitMarginRad"]
    : ["meanJointJerkRadPerSec3", "meanActionSlewRatePerSec", "meanFootSlipSpeedMps", "totalFootSlipDistanceM"];
  return (
    <div className="grid gap-3 md:grid-cols-4">
      {keys.map((key) => (
        <Card key={key} className="bg-white/[0.025]">
          <CardContent className="p-4">
            <div className="mb-2 truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500" title={key}>
              {key.replaceAll(/([A-Z])/g, " $1")}
            </div>
            <div className="flex items-baseline gap-3 font-mono">
              <span className="text-lg text-cyan-200">{numberMetric(sides[0]!.run, key)?.toFixed(4) ?? "—"}</span>
              {sides[1] ? <span className="text-sm text-amber-200">→ {numberMetric(sides[1].run, key)?.toFixed(4) ?? "—"}</span> : null}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function ReplayWorkbench({ snapshot }: { snapshot: StudioSnapshot }): React.JSX.Element {
  const sides = React.useMemo<ReplaySide[]>(() => {
    const values: ReplaySide[] = [];
    if (snapshot.selectedRun) values.push({ key: "A", run: snapshot.selectedRun, replay: snapshot.selectedReplay });
    if (snapshot.comparisonRun) values.push({ key: "B", run: snapshot.comparisonRun, replay: snapshot.comparisonReplay });
    return values;
  }, [snapshot]);
  const clockTimes = React.useMemo(() => {
    const values = sides.flatMap((side) => timesFor(side.run, side.replay));
    const unique = [...new Set(values.map((value) => Number(value).toFixed(9)))].map(Number).sort((a, b) => a - b);
    return unique.length ? unique : [0];
  }, [sides]);
  const [clockIndex, setClockIndex] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [speed, setSpeed] = React.useState(1);
  const [copyStatus, setCopyStatus] = React.useState("Copying preserves exact Run and frame identity.");
  const time = clockTimes[Math.min(clockIndex, clockTimes.length - 1)] ?? 0;

  const seek = React.useCallback((index: number) => {
    setPlaying(false);
    setClockIndex(Math.max(0, Math.min(clockTimes.length - 1, index)));
  }, [clockTimes.length]);

  React.useEffect(() => {
    if (!playing) return undefined;
    if (clockIndex >= clockTimes.length - 1) {
      setPlaying(false);
      return undefined;
    }
    const from = clockTimes[clockIndex] ?? 0;
    const to = clockTimes[clockIndex + 1] ?? from;
    const timer = window.setTimeout(
      () => setClockIndex((value) => Math.min(clockTimes.length - 1, value + 1)),
      Math.max(8, (1_000 * Math.max(0.001, to - from)) / speed),
    );
    return () => window.clearTimeout(timer);
  }, [clockIndex, clockTimes, playing, speed]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.target as HTMLElement | null)?.matches("input,select,textarea,button")) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        seek(clockIndex - 1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        seek(clockIndex + 1);
      } else if (event.key === " ") {
        event.preventDefault();
        setPlaying((value) => !value);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [clockIndex, seek]);

  const copyContext = async (): Promise<void> => {
    if (!sides[0]) return;
    const baseline = sides[0];
    const subject = sides[1] ?? null;
    const baselineFrame = mappedFrame(baseline, time);
    const subjectFrame = subject ? mappedFrame(subject, time) : null;
    const context = {
      kind: subject ? "mujica-run-comparison-context" : "mujica-frame-context",
      authority: "immutable-evidence-selector",
      headlessArgv: [
        "evidence",
        "inspect",
        ".",
        "--run",
        baseline.run.id,
        "--time",
        String(time),
        ...(subject ? ["--compare-run", subject.run.id] : []),
      ],
      sharedTimeSeconds: time,
      baseline: agentSideContext(baseline, baselineFrame),
      subject: subject && subjectFrame ? agentSideContext(subject, subjectFrame) : null,
      authorityBoundary: {
        visualInput: "hypothesis-only",
        numericalEvidence: "immutable-run",
        promotion: "locked-judge-only",
      },
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(context, null, 2));
      setCopyStatus("Copied exact immutable Run selector and headless reproduction command.");
    } catch {
      setCopyStatus("Clipboard unavailable. Open Evidence for the legacy copy fallback.");
    }
  };

  if (!sides.length) {
    return (
      <Card className="grid min-h-[420px] place-items-center">
        <CardContent className="max-w-lg p-10 text-center">
          <RotateCcw className="mx-auto mb-5 size-10 text-cyan-200" />
          <h2 className="font-display text-2xl font-semibold">No Simulation Run selected</h2>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            Generate a Run, then use <code>mujica studio . --run ID</code> to create an authoritative replay.
          </p>
        </CardContent>
      </Card>
    );
  }

  const recovery = sides.some((side) => isRecoveryRun(side.run));
  const heading = recovery
    ? sides[1] ? "Self-righting morphology comparison" : "Self-righting robot replay"
    : sides[1] ? "Synchronized MuJoCo Run comparison" : "Authoritative MuJoCo robot replay";
  const events = sides
    .flatMap((side) => (side.run.events?.rows ?? []).map((event) => ({ side: side.key, event })))
    .filter((item) => item.event.time !== undefined)
    .sort((a, b) => Number(a.event.time) - Number(b.event.time))
    .slice(0, 12);

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Badge><Sparkles className="size-3" /> React replay</Badge>
            <Badge variant="secondary">{sides.length === 2 ? "A/B synchronized" : "single Run"}</Badge>
          </div>
          <h2 className="font-display text-2xl font-semibold tracking-tight text-white md:text-3xl">{heading}</h2>
          <p className="mt-2 text-sm text-slate-400">
            Exact rendered qpos frames on one typed simulation clock. Visual interpretation remains a hypothesis.
          </p>
        </div>
        <Button variant="outline" onClick={() => void copyContext()}>
          <Clipboard className="size-4" />
          Copy frame context
        </Button>
      </div>

      <Card className="sticky top-3 z-20 border-cyan-300/15 bg-[#0a1119]/95 shadow-[0_12px_45px_-18px_rgba(34,211,238,0.35)]">
        <CardContent className="flex flex-col gap-3 p-3 md:flex-row md:items-center">
          <div className="flex items-center gap-2">
            <Button aria-label="Previous frame" size="icon" variant="secondary" onClick={() => seek(clockIndex - 1)}>
              <ArrowLeftToLine className="size-4" />
            </Button>
            <Button
              aria-label={playing ? "Pause replay" : "Play replay"}
              className="min-w-24"
              onClick={() => setPlaying((value) => !value)}
            >
              {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
              {playing ? "Pause" : "Play"}
            </Button>
            <Button aria-label="Next frame" size="icon" variant="secondary" onClick={() => seek(clockIndex + 1)}>
              <ArrowRightToLine className="size-4" />
            </Button>
          </div>
          <Slider
            aria-label="Shared simulation time"
            className="min-w-0 flex-1"
            min={0}
            max={Math.max(0, clockTimes.length - 1)}
            step={1}
            value={[clockIndex]}
            onValueChange={([value]) => seek(value ?? 0)}
          />
          <div className="flex items-center justify-between gap-3 md:justify-start">
            <select
              aria-label="Playback speed"
              value={speed}
              onChange={(event) => setSpeed(Number(event.target.value))}
              className="h-10 rounded-lg border border-white/10 bg-white/[0.05] px-3 text-sm text-slate-200 outline-none focus:border-cyan-300/50"
            >
              <option value={0.25}>0.25×</option>
              <option value={0.5}>0.5×</option>
              <option value={1}>1×</option>
              <option value={2}>2×</option>
            </select>
            <div className="min-w-36 text-right font-mono text-xs text-slate-400">
              <div className="text-slate-200">{time.toFixed(3)} s</div>
              <div>{clockIndex + 1} / {clockTimes.length}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className={`grid gap-5 ${sides.length === 2 ? "md:grid-cols-2" : ""}`}>
        {sides.map((side) => <RunReplayCard key={side.key} side={side} time={time} />)}
      </div>

      <OutcomeStrip sides={sides} />

      {events.length ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2"><Gauge className="size-4 text-cyan-200" /> Evidence events</CardTitle>
            <CardDescription>Seek the shared clock without changing Run evidence.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {events.map(({ side, event }, index) => (
              <Button
                key={`${side}-${event.type}-${event.time}-${index}`}
                size="sm"
                variant="secondary"
                onClick={() => seek(atOrBefore(clockTimes, Number(event.time)))}
              >
                <Badge variant="secondary" className="px-1.5 py-0">{side}</Badge>
                {Number(event.time).toFixed(2)}s · {event.type ?? "event"}
              </Button>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="flex items-center gap-2 text-xs text-slate-500">
        {copyStatus.startsWith("Copied") ? <Check className="size-3.5 text-emerald-300" /> : <Clipboard className="size-3.5" />}
        {copyStatus}
      </div>
    </div>
  );
}
