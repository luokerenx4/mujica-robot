import * as React from "react";
import { ArrowLeft, Copy, PackageOpen } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { ReplayWorkbench } from "@/components/replay-workbench";
import { PageHeading, RouteError, RouteLoading } from "@/components/page-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useRouteData } from "@/data";
import type { RunRouteData, StudioRouteManifest } from "@/types";

export function RunDetailPage({ manifest }: { manifest: StudioRouteManifest }): React.JSX.Element {
  const { runId = "" } = useParams();
  const packaged = manifest.packagedRuns.find((run) => run.id === runId);
  const { data, error, loading } = useRouteData<RunRouteData>(packaged?.path ?? null);
  const [copied, setCopied] = React.useState(false);

  if (!packaged) {
    const command = `mujica studio . --run ${runId}`;
    return (
      <>
        <PageHeading
          eyebrow="Run detail"
          title="Run is not packaged in this Studio"
          description="The ledger knows this immutable id, but its full trajectory and rendered frames were intentionally not copied into this content-addressed Studio."
        />
        <Card className="grid min-h-[360px] place-items-center">
          <CardContent className="max-w-xl p-10 text-center">
            <PackageOpen className="mx-auto mb-5 size-10 text-slate-500" />
            <p className="font-mono text-sm text-slate-200">{runId}</p>
            <p className="mt-3 text-sm leading-6 text-slate-500">Generate a new Studio artifact with this Run selected:</p>
            <code className="mt-4 block rounded-xl border border-white/[0.08] bg-black/30 p-4 text-left text-xs">{command}</code>
            <div className="mt-5 flex justify-center gap-2">
              <Button asChild variant="outline"><Link to="/runs"><ArrowLeft className="size-4" /> Run ledger</Link></Button>
              <Button onClick={() => {
                void navigator.clipboard.writeText(command).then(() => setCopied(true));
              }}>
                <Copy className="size-4" /> {copied ? "Copied" : "Copy command"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </>
    );
  }

  if (loading || !data && !error) return <RouteLoading label={`Loading ${runId}`} />;
  if (error) return <RouteError error={error} />;
  if (!data) return <RouteLoading />;

  return (
    <>
      <PageHeading
        eyebrow="Run detail"
        title={data.run.subject?.assembly ?? data.run.id}
        description={`${data.run.id} · ${data.run.subject?.controller ?? "unknown controller"} · immutable ${data.role} evidence`}
        aside={(
          <div className="flex items-center gap-2">
            <Badge variant={data.replay ? "success" : "warning"}>{data.replay ? `${data.replay.frameCount} frames` : "no replay"}</Badge>
            <Button asChild size="sm" variant="outline"><Link to="/runs"><ArrowLeft className="size-3.5" /> Ledger</Link></Button>
          </div>
        )}
      />
      <ReplayWorkbench
        selection={{
          selectedRun: data.run,
          selectedReplay: data.replay,
          comparisonRun: null,
          comparisonReplay: null,
        }}
      />
    </>
  );
}
