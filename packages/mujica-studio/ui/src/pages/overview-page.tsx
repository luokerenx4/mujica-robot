import * as React from "react";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  CircleDot,
  FlaskConical,
  GitBranch,
  PlaySquare,
  Shapes,
} from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeading, RouteError, RouteLoading } from "@/components/page-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useRouteData } from "@/data";
import type { ProjectRouteData, StudioRouteManifest } from "@/types";

function Stat({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  detail: string;
}): React.JSX.Element {
  return (
    <Card className="bg-white/[0.025]">
      <CardContent className="p-4">
        <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          {label}<Icon className="size-4 text-cyan-200/70" />
        </div>
        <div className="mt-2 font-display text-2xl font-semibold text-slate-100">{value}</div>
        <div className="mt-1 text-xs text-slate-500">{detail}</div>
      </CardContent>
    </Card>
  );
}

export function OverviewPage({ manifest }: { manifest: StudioRouteManifest }): React.JSX.Element {
  const { data, error, loading } = useRouteData<ProjectRouteData>(manifest.paths.project);
  if (loading || !data && !error) return <RouteLoading label="Loading project charter" />;
  if (error) return <RouteError error={error} />;
  if (!data) return <RouteLoading />;

  const activeStages = data.charter.capabilityStages.filter((stage) => stage.status === "active");
  const emphasis = data.currentDesignProbe?.result?.nextDevelopmentEmphasis;
  return (
    <>
      <PageHeading
        eyebrow="Project overview"
        title={data.charter.title}
        description={data.charter.proposition}
        aside={(
          <div className="flex flex-wrap gap-2">
            <Badge><Bot className="size-3" /> {data.project.id}</Badge>
            {emphasis ? <Badge variant="warning">{emphasis}</Badge> : null}
          </div>
        )}
      />

      <section className="mb-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={Shapes} label="Assemblies" value={data.counts.assemblies} detail="Compiled embodiment variants" />
        <Stat icon={PlaySquare} label="Runs" value={data.counts.runs} detail="Immutable simulation evidence" />
        <Stat icon={FlaskConical} label="Experiments" value={data.counts.researchExperiments} detail={`${data.counts.researchSessions} governed sessions`} />
        <Stat icon={GitBranch} label="Revisions" value={data.counts.revisions} detail="Kept robot lineage" />
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="overflow-hidden bg-[radial-gradient(circle_at_10%_0%,rgba(34,211,238,0.12),transparent_42%),rgba(2,6,23,0.62)]">
          <CardHeader>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-violet-200/70">
              <FlaskConical className="size-4" /> North star
            </div>
            <CardTitle className="text-2xl leading-8">{data.charter.northStar.statement}</CardTitle>
            <CardDescription>
              {data.charter.northStar.stage ?? "project"} · {data.charter.northStar.benchmark ?? "declared capability"}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 pt-1">
            {data.selectedRunId ? (
              <Button asChild>
                <Link to={`/runs/${encodeURIComponent(data.selectedRunId)}`}>
                  Open selected Run <ArrowRight className="size-4" />
                </Link>
              </Button>
            ) : null}
            {data.comparisonRunId ? (
              <Button asChild variant="outline">
                <Link to="/compare">Open A/B comparison</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Capability stages</CardTitle>
            <CardDescription>Charter-defined questions, separated from individual optimization Runs.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.charter.capabilityStages.map((stage) => {
              const active = stage.status === "active";
              const accepted = stage.status === "accepted";
              return (
                <div key={stage.id} className="flex gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                  {accepted
                    ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-300" />
                    : <CircleDot className={`mt-0.5 size-4 shrink-0 ${active ? "text-cyan-200" : "text-slate-600"}`} />}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-sm font-semibold text-slate-200">{stage.name ?? stage.id}</span>
                      <Badge variant={accepted ? "success" : active ? "default" : "secondary"}>{stage.status}</Badge>
                    </div>
                    {stage.question ? <p className="mt-1 text-xs leading-5 text-slate-500">{stage.question}</p> : null}
                  </div>
                </div>
              );
            })}
            {activeStages.length === 0 ? <p className="text-sm text-slate-500">No active stage is declared.</p> : null}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
