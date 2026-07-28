import * as React from "react";
import {
  Activity,
  Box,
  CheckCircle2,
  GitCommitHorizontal,
  Scale,
  ShieldAlert,
  Waypoints,
} from "lucide-react";
import { PageHeading, RouteError, RouteLoading } from "@/components/page-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useRouteData } from "@/data";
import type { DesignRouteData, StudioRouteManifest } from "@/types";

function text(value: unknown, fallback = "—"): string {
  return typeof value === "string" && value ? value : fallback;
}

export function DesignsPage({ manifest }: { manifest: StudioRouteManifest }): React.JSX.Element {
  const { data, error, loading } = useRouteData<DesignRouteData>(manifest.paths.designs);
  if (loading || !data && !error) return <RouteLoading label="Loading embodiment lineage" />;
  if (error) return <RouteError error={error} />;
  if (!data) return <RouteLoading />;

  const study = data.currentDesignStudy?.result;
  const studyCandidates = Array.isArray(study?.candidates) ? study.candidates : [];
  const revisions = [...data.revisions].reverse();

  return (
    <>
      <PageHeading
        eyebrow="Embodiment workspace"
        title="Robot designs and lineage"
        description="Assemblies are physical programs. This page keeps morphology hypotheses, screened candidates, and promoted Robot Revisions away from Controller and Policy iteration noise."
        aside={<Badge><Waypoints className="size-3" /> {data.assemblies.length} Assembly variants</Badge>}
      />

      {study ? (
        <section className="mb-8">
          <div className="mb-4 flex flex-col justify-between gap-3 md:flex-row md:items-end">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-violet-200/65">Current Design Study</p>
              <h2 className="mt-2 font-display text-2xl font-semibold text-white">{text(study.question, text(study.study))}</h2>
            </div>
            <Badge variant={String(study.outcome).includes("SUPPORTED") ? "success" : "warning"}>
              {text(study.outcome, "screened")}
            </Badge>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            {studyCandidates.map((candidate: Record<string, any>) => {
              const supported = String(candidate.verdict).includes("SUPPORTED");
              const posePasses = Array.isArray(candidate.restingPoses)
                ? candidate.restingPoses.filter((pose: Record<string, unknown>) => pose.passed === true).length
                : 0;
              return (
                <Card key={text(candidate.id)} className={supported ? "border-emerald-300/15" : ""}>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="mb-2 flex flex-wrap gap-2">
                          <Badge variant={candidate.role === "baseline" ? "secondary" : "default"}>{text(candidate.role)}</Badge>
                          <Badge variant={supported ? "success" : "destructive"}>{text(candidate.verdict)}</Badge>
                        </div>
                        <CardTitle>{text(candidate.id)}</CardTitle>
                        <CardDescription className="font-mono text-xs">{text(candidate.assembly)}</CardDescription>
                      </div>
                      {supported ? <CheckCircle2 className="size-5 text-emerald-300" /> : <ShieldAlert className="size-5 text-rose-300" />}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm leading-6 text-slate-300">{text(candidate.hypothesis, "No physical hypothesis recorded.")}</p>
                    <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-lg bg-white/[0.035] p-3">
                        <div className="text-slate-500">Home support</div>
                        <div className="mt-1 font-mono text-slate-200">
                          {candidate.homeSupport?.actual ?? "—"} / {candidate.homeSupport?.minimum ?? "—"} contacts
                        </div>
                      </div>
                      <div className="rounded-lg bg-white/[0.035] p-3">
                        <div className="text-slate-500">Resting poses</div>
                        <div className="mt-1 font-mono text-slate-200">{posePasses} / {candidate.restingPoses?.length ?? 0} screened</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="mb-8">
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200/65">Assembly catalogue</p>
          <h2 className="mt-2 font-display text-2xl font-semibold text-white">Compiled robot variants</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {data.assemblies.map((assembly) => {
            const selected = assembly.id === data.selectedAssembly;
            return (
              <Card key={assembly.id} className={selected ? "border-cyan-300/25 bg-cyan-300/[0.035]" : ""}>
                <CardHeader>
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <Badge variant={selected ? "default" : "secondary"}>{selected ? "project default" : "variant"}</Badge>
                    <span className="font-mono text-[10px] text-slate-600">{assembly.hash?.slice(0, 10)}</span>
                  </div>
                  <CardTitle>{assembly.name ?? assembly.id}</CardTitle>
                  <CardDescription className="font-mono text-xs">{assembly.id}</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-white/[0.035] p-3 text-xs">
                    <Scale className="mb-2 size-4 text-cyan-200" />
                    <div className="font-mono text-slate-200">{assembly.totalMassKg?.toFixed(2) ?? "—"} kg</div>
                    <div className="mt-1 text-slate-500">total mass</div>
                  </div>
                  <div className="rounded-lg bg-white/[0.035] p-3 text-xs">
                    <Box className="mb-2 size-4 text-violet-200" />
                    <div className="font-mono text-slate-200">{assembly.components?.length ?? 0}</div>
                    <div className="mt-1 text-slate-500">components</div>
                  </div>
                  <div className="rounded-lg bg-white/[0.035] p-3 text-xs">
                    <Activity className="mb-2 size-4 text-amber-200" />
                    <div className="font-mono text-slate-200">{assembly.observationContract?.size ?? "—"}</div>
                    <div className="mt-1 text-slate-500">observations</div>
                  </div>
                  <div className="rounded-lg bg-white/[0.035] p-3 text-xs">
                    <GitCommitHorizontal className="mb-2 size-4 text-emerald-200" />
                    <div className="font-mono text-slate-200">{assembly.actionContract?.size ?? "—"}</div>
                    <div className="mt-1 text-slate-500">actions</div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section>
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-200/65">Kept development lineage</p>
          <h2 className="mt-2 font-display text-2xl font-semibold text-white">Robot Revisions</h2>
        </div>
        <Card>
          <CardContent className="divide-y divide-white/[0.06] p-0">
            {revisions.map((revision, index) => (
              <div key={text(revision.id, String(index))} className="grid gap-3 px-5 py-4 md:grid-cols-[1fr_1fr_auto] md:items-center">
                <div className="min-w-0">
                  <div className="truncate font-mono text-xs text-slate-200">{text(revision.id)}</div>
                  <div className="mt-1 truncate text-xs text-slate-500">parent {text(revision.parent, "root")}</div>
                </div>
                <div className="min-w-0 text-xs">
                  <div className="truncate text-slate-300">{text(revision.assembly)} · {text(revision.controller)}</div>
                  <div className="mt-1 truncate text-slate-500">{text(revision.benchmarkId)} · {text(revision.selectionReason, "kept evidence")}</div>
                </div>
                <div className="flex items-center gap-2 md:justify-end">
                  <Badge variant="success">kept</Badge>
                  <span className="font-mono text-xs text-cyan-200">{Number(revision.aggregateScore ?? 0).toFixed(3)}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    </>
  );
}
