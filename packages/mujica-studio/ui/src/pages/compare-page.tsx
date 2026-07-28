import * as React from "react";
import { GitCompareArrows, PackageOpen } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { ReplayWorkbench } from "@/components/replay-workbench";
import { PageHeading, RouteError, RouteLoading } from "@/components/page-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useRouteData } from "@/data";
import type { CompareRouteData, RunRouteData, StudioRouteManifest } from "@/types";

export function ComparePage({ manifest }: { manifest: StudioRouteManifest }): React.JSX.Element {
  const comparison = useRouteData<CompareRouteData>(manifest.paths.compare);
  const leftRun = useRouteData<RunRouteData>(comparison.data?.runs.left.path ?? null);
  const rightRun = useRouteData<RunRouteData>(comparison.data?.runs.right.path ?? null);
  const [searchParams, setSearchParams] = useSearchParams();
  React.useEffect(() => {
    if (!searchParams.has("left") && comparison.data) {
      setSearchParams({
        left: comparison.data.runs.left.id,
        right: comparison.data.runs.right.id,
      }, { replace: true });
    }
  }, [comparison.data, searchParams, setSearchParams]);

  if (!manifest.paths.compare) {
    return (
      <>
        <PageHeading
          eyebrow="A/B workspace"
          title="No comparison was packaged"
          description="Generate Studio with both a baseline and subject Run to inspect them on one simulation clock."
        />
        <Card className="grid min-h-[360px] place-items-center">
          <CardContent className="max-w-xl p-10 text-center">
            <PackageOpen className="mx-auto mb-5 size-10 text-slate-500" />
            <code className="block rounded-xl border border-white/[0.08] bg-black/30 p-4 text-left text-xs">
              mujica studio . --run BASELINE --compare-run SUBJECT
            </code>
          </CardContent>
        </Card>
      </>
    );
  }
  const error = comparison.error ?? leftRun.error ?? rightRun.error;
  if (error) return <RouteError error={error} />;
  if (
    comparison.loading
    || leftRun.loading
    || rightRun.loading
    || !comparison.data
    || !leftRun.data
    || !rightRun.data
  ) return <RouteLoading label="Loading A/B evidence" />;

  const left = searchParams.get("left") ?? comparison.data.runs.left.id;
  const right = searchParams.get("right") ?? comparison.data.runs.right.id;
  const exactPair = left === comparison.data.runs.left.id && right === comparison.data.runs.right.id;
  const swappedPair = left === comparison.data.runs.right.id && right === comparison.data.runs.left.id;
  const selection = swappedPair
    ? {
        selectedRun: rightRun.data.run,
        selectedReplay: rightRun.data.replay,
        comparisonRun: leftRun.data.run,
        comparisonReplay: leftRun.data.replay,
      }
    : {
        selectedRun: leftRun.data.run,
        selectedReplay: leftRun.data.replay,
        comparisonRun: rightRun.data.run,
        comparisonReplay: rightRun.data.replay,
      };

  return (
    <>
      <PageHeading
        eyebrow="A/B workspace"
        title="Synchronized Run comparison"
        description="The URL names the exact baseline and subject. Both immutable qpos replays advance on one typed simulation clock."
        aside={<Badge><GitCompareArrows className="size-3" /> deep-linked pair</Badge>}
      />
      {!exactPair && !swappedPair ? (
        <Card className="mb-5 border-amber-300/20">
          <CardContent className="p-4 text-sm text-amber-100">
            This Studio only packages {comparison.data.runs.left.id} and {comparison.data.runs.right.id}; showing that frozen pair.
          </CardContent>
        </Card>
      ) : null}
      <ReplayWorkbench selection={selection} />
    </>
  );
}
