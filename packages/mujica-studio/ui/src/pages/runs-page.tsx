import * as React from "react";
import { ArrowRight, GitCompareArrows, PlaySquare, Search } from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeading, RouteError, RouteLoading } from "@/components/page-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useRouteData } from "@/data";
import type { RunsRouteData, StudioRouteManifest } from "@/types";

export function RunsPage({ manifest }: { manifest: StudioRouteManifest }): React.JSX.Element {
  const { data, error, loading } = useRouteData<RunsRouteData>(manifest.paths.runs);
  const [query, setQuery] = React.useState("");
  if (loading || !data && !error) return <RouteLoading label="Loading immutable Run ledger" />;
  if (error) return <RouteError error={error} />;
  if (!data) return <RouteLoading />;

  const packaged = new Map(data.packagedRuns.map((run) => [run.id, run]));
  const filtered = data.runs
    .filter((run) => run.id.toLowerCase().includes(query.trim().toLowerCase()))
    .reverse();

  return (
    <>
      <PageHeading
        eyebrow="Iteration ledger"
        title="Simulation and evaluation Runs"
        description="Browse completed evidence without mounting every replay at once. Runs selected when this Studio was generated are marked playable; the rest remain immutable ledger entries."
        aside={manifest.paths.compare ? (
          <Button asChild variant="outline">
            <Link to="/compare"><GitCompareArrows className="size-4" /> Open packaged comparison</Link>
          </Button>
        ) : undefined}
      />

      <div className="mb-4 flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.025] px-4">
        <Search className="size-4 text-slate-500" />
        <input
          aria-label="Filter Runs"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by immutable Run id…"
          className="h-12 w-full bg-transparent text-sm text-slate-200 outline-none placeholder:text-slate-600"
        />
        <Badge variant="secondary">{filtered.length} / {data.runs.length}</Badge>
      </div>

      <Card className="overflow-hidden">
        <CardContent className="divide-y divide-white/[0.06] p-0">
          {filtered.map((run) => {
            const packagedRun = packaged.get(run.id);
            return (
              <div key={run.id} className="grid gap-3 px-5 py-4 lg:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(7rem,0.5fr))_auto] lg:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-mono text-xs text-slate-200">{run.id}</span>
                    {packagedRun ? <Badge variant="success">{packagedRun.role} · playable</Badge> : <Badge variant="secondary">ledger only</Badge>}
                  </div>
                  <div className="mt-1 truncate font-mono text-[10px] text-slate-600">{run.resultHash ?? "no result hash"}</div>
                </div>
                <div className="text-xs">
                  <div className="text-slate-500">Seed</div>
                  <div className="mt-1 font-mono text-slate-300">{run.seed ?? "—"}</div>
                </div>
                <div className="text-xs">
                  <div className="text-slate-500">Training steps</div>
                  <div className="mt-1 font-mono text-slate-300">{run.trainingSteps ?? 0}</div>
                </div>
                <div className="text-xs">
                  <div className="text-slate-500">MuJoCo</div>
                  <div className="mt-1 font-mono text-slate-300">{run.mujocoVersion ?? "—"}</div>
                </div>
                {packagedRun ? (
                  <Button asChild size="sm">
                    <Link to={`/runs/${encodeURIComponent(run.id)}`}>
                      <PlaySquare className="size-3.5" /> Open <ArrowRight className="size-3.5" />
                    </Link>
                  </Button>
                ) : (
                  <span className="text-right text-[11px] text-slate-600">regenerate Studio to inspect</span>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </>
  );
}
