import * as React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/app-shell";
import { ComparePage } from "@/pages/compare-page";
import { DesignsPage } from "@/pages/designs-page";
import { EvidencePage } from "@/pages/evidence-page";
import { NotFoundPage } from "@/pages/not-found-page";
import { OverviewPage } from "@/pages/overview-page";
import { RunDetailPage } from "@/pages/run-detail-page";
import { RunsPage } from "@/pages/runs-page";
import type { StudioRouteManifest } from "@/types";

export function App({ manifest }: { manifest: StudioRouteManifest }): React.JSX.Element {
  return (
    <Routes>
      <Route element={<AppShell manifest={manifest} />}>
        <Route index element={<Navigate replace to={manifest.defaultRoute} />} />
        <Route path="overview" element={<OverviewPage manifest={manifest} />} />
        <Route path="designs" element={<DesignsPage manifest={manifest} />} />
        <Route path="runs" element={<RunsPage manifest={manifest} />} />
        <Route path="runs/:runId" element={<RunDetailPage manifest={manifest} />} />
        <Route path="compare" element={<ComparePage manifest={manifest} />} />
        <Route path="evidence" element={<EvidencePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
