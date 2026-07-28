import * as React from "react";
import {
  Bot,
  Braces,
  FlaskConical,
  LockKeyhole,
  MonitorPlay,
  Orbit,
  ScrollText,
} from "lucide-react";
import { ReplayWorkbench } from "@/components/replay-workbench";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { StudioSnapshot } from "@/types";

function countExperiments(snapshot: StudioSnapshot): number {
  return snapshot.researchSessions.reduce(
    (sum, session) => sum + (session.experiments?.length ?? 0),
    0,
  );
}

function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: React.ReactNode;
  detail: string;
}): React.JSX.Element {
  return (
    <Card className="bg-white/[0.025]">
      <CardContent className="p-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</div>
        <div className="mt-2 font-display text-xl font-semibold text-slate-100">{value}</div>
        <div className="mt-1 truncate text-xs text-slate-500" title={detail}>{detail}</div>
      </CardContent>
    </Card>
  );
}

export function App({ snapshot }: { snapshot: StudioSnapshot }): React.JSX.Element {
  const activeStage = snapshot.charter.capabilityStages.find((stage) => stage.status === "active");
  const probe = snapshot.currentDesignProbe?.result;
  return (
    <div className="min-h-screen">
      <header className="border-b border-white/[0.07] bg-[#070b10]/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1680px] items-center justify-between gap-6 px-5 py-4 md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-200">
              <Orbit className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="font-display text-lg font-semibold tracking-tight text-white">Mujica Studio</div>
              <div className="truncate text-xs text-slate-500">{snapshot.project.name}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="success"><LockKeyhole className="size-3" /> Read only</Badge>
            <Badge variant="secondary" className="hidden sm:inline-flex"><Braces className="size-3" /> TypeScript UI</Badge>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1680px] px-5 py-7 md:px-8 md:py-10">
        <section className="relative mb-8 overflow-hidden rounded-3xl border border-white/[0.08] bg-[radial-gradient(circle_at_15%_0%,rgba(34,211,238,0.15),transparent_36%),radial-gradient(circle_at_90%_20%,rgba(167,139,250,0.12),transparent_30%),rgba(15,23,42,0.52)] p-6 shadow-2xl md:p-8">
          <div className="relative z-10 grid gap-8 xl:grid-cols-[1.35fr_0.65fr] xl:items-end">
            <div>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <Badge><Bot className="size-3" /> {snapshot.project.id}</Badge>
                {activeStage ? <Badge variant="secondary">{activeStage.id} · {activeStage.status}</Badge> : null}
                {probe?.nextDevelopmentEmphasis ? <Badge variant="warning">{probe.nextDevelopmentEmphasis}</Badge> : null}
              </div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200/70">Development charter</p>
              <h1 className="font-display max-w-5xl text-3xl font-semibold tracking-[-0.025em] text-white md:text-5xl">
                {snapshot.charter.title}
              </h1>
              <p className="mt-5 max-w-4xl text-sm leading-7 text-slate-300 md:text-base">
                {snapshot.charter.proposition}
              </p>
            </div>
            <div className="rounded-2xl border border-white/[0.08] bg-black/20 p-5">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.13em] text-slate-500">
                <FlaskConical className="size-4 text-violet-300" /> North star
              </div>
              <p className="text-sm leading-6 text-slate-200">{snapshot.charter.northStar.statement}</p>
              <p className="mt-3 font-mono text-[11px] text-slate-500">
                {snapshot.charter.northStar.stage ?? "project"} · {snapshot.charter.northStar.benchmark ?? "declared capability"}
              </p>
            </div>
          </div>
        </section>

        <section className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            label="Selected evidence"
            value={snapshot.comparisonRun ? "2 Runs" : snapshot.selectedRun ? "1 Run" : "None"}
            detail={snapshot.selectedRun?.id ?? "Generate a simulation Run"}
          />
          <Stat
            label="Rendered frames"
            value={(snapshot.selectedReplay?.frameCount ?? 0) + (snapshot.comparisonReplay?.frameCount ?? 0)}
            detail="Locally generated MuJoCo images"
          />
          <Stat
            label="Frozen policies"
            value={snapshot.policies.length}
            detail="Training evidence, never promotion authority"
          />
          <Stat
            label="Research experiments"
            value={countExperiments(snapshot)}
            detail={`${snapshot.researchSessions.length} governed sessions`}
          />
        </section>

        <Tabs defaultValue="replay">
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
            <TabsList>
              <TabsTrigger value="replay" className="gap-2">
                <MonitorPlay className="size-4" /> Replay
              </TabsTrigger>
              <TabsTrigger value="evidence" className="gap-2">
                <ScrollText className="size-4" /> Complete evidence
              </TabsTrigger>
            </TabsList>
            <p className="text-xs text-slate-500">
              Snapshot <span className="font-mono">{snapshot.renderer.sourceHash.slice(0, 12)}</span> · no editing or evaluation in Studio
            </p>
          </div>
          <TabsContent value="replay">
            <ReplayWorkbench snapshot={snapshot} />
          </TabsContent>
          <TabsContent value="evidence">
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-4">
                <div>
                  <div className="font-display font-semibold text-slate-100">Complete evidence debugger</div>
                  <div className="mt-1 text-xs text-slate-500">Transitional view while panels migrate into typed React components.</div>
                </div>
                <Badge variant="secondary">immutable legacy projection</Badge>
              </div>
              <iframe
                title="Complete Mujica evidence debugger"
                src="./legacy.html"
                className="h-[calc(100vh-10rem)] min-h-[720px] w-full border-0 bg-[#0b1015]"
              />
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
