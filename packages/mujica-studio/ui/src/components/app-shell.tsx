import * as React from "react";
import {
  Bot,
  Braces,
  GitCompareArrows,
  LayoutDashboard,
  LockKeyhole,
  Orbit,
  PlaySquare,
  ScrollText,
  Shapes,
} from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { StudioRouteManifest } from "@/types";

const navigation = [
  { to: "/overview", label: "Overview", icon: LayoutDashboard },
  { to: "/designs", label: "Designs", icon: Shapes },
  { to: "/runs", label: "Runs", icon: PlaySquare },
  { to: "/compare", label: "Compare", icon: GitCompareArrows },
  { to: "/evidence", label: "Evidence", icon: ScrollText },
] as const;

export function AppShell({ manifest }: { manifest: StudioRouteManifest }): React.JSX.Element {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-[#070b10]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1680px] flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3 md:px-8">
          <NavLink to="/overview" className="mr-auto flex min-w-0 items-center gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-200">
              <Orbit className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="font-display text-lg font-semibold tracking-tight text-white">Mujica Studio</div>
              <div className="max-w-[44vw] truncate text-xs text-slate-500">{manifest.project.name}</div>
            </div>
          </NavLink>

          <nav aria-label="Studio sections" className="order-3 flex w-full gap-1 overflow-x-auto rounded-xl border border-white/[0.07] bg-white/[0.025] p-1 lg:order-none lg:w-auto">
            {navigation.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) => cn(
                  "inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-xs font-medium text-slate-400 transition-colors hover:bg-white/[0.05] hover:text-slate-100",
                  isActive && "bg-cyan-300/10 text-cyan-100 shadow-sm",
                )}
              >
                <Icon className="size-3.5" />
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Badge variant="success"><LockKeyhole className="size-3" /> Read only</Badge>
            <Badge variant="secondary" className="hidden sm:inline-flex"><Braces className="size-3" /> TS</Badge>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1680px] px-5 py-7 md:px-8 md:py-9">
        <Outlet />
      </main>

      <footer className="mx-auto flex max-w-[1680px] flex-col gap-2 border-t border-white/[0.06] px-5 py-5 text-[11px] text-slate-600 md:flex-row md:items-center md:justify-between md:px-8">
        <span className="inline-flex items-center gap-2"><Bot className="size-3" /> {manifest.project.id} · immutable local projection</span>
        <span className="font-mono">renderer {manifest.renderer.sourceHash.slice(0, 12)}</span>
      </footer>
    </div>
  );
}
