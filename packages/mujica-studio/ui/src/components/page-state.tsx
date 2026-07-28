import * as React from "react";
import { AlertTriangle, LoaderCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function RouteLoading({ label = "Loading route evidence" }: { label?: string }): React.JSX.Element {
  return (
    <Card className="grid min-h-[360px] place-items-center">
      <CardContent className="flex items-center gap-3 p-10 text-sm text-slate-400">
        <LoaderCircle className="size-5 animate-spin text-cyan-200" />
        {label}
      </CardContent>
    </Card>
  );
}

export function RouteError({ error }: { error: Error }): React.JSX.Element {
  return (
    <Card className="border-rose-300/20">
      <CardContent className="flex gap-4 p-6">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-rose-300" />
        <div>
          <h2 className="font-display font-semibold text-rose-100">Route evidence could not be loaded</h2>
          <p className="mt-2 font-mono text-xs leading-6 text-slate-400">{error.message}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function PageHeading({
  eyebrow,
  title,
  description,
  aside,
}: {
  eyebrow: string;
  title: string;
  description: string;
  aside?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="mb-7 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200/65">{eyebrow}</p>
        <h1 className="font-display text-3xl font-semibold tracking-[-0.025em] text-white md:text-4xl">{title}</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">{description}</p>
      </div>
      {aside}
    </div>
  );
}
