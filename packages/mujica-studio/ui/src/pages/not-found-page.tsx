import * as React from "react";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function NotFoundPage(): React.JSX.Element {
  return (
    <Card className="grid min-h-[420px] place-items-center">
      <CardContent className="p-10 text-center">
        <div className="font-display text-6xl font-semibold text-cyan-200">404</div>
        <h1 className="mt-4 font-display text-2xl font-semibold">Unknown Studio route</h1>
        <p className="mt-2 text-sm text-slate-500">The evidence is immutable; the route is simply not part of this workspace.</p>
        <Button asChild className="mt-6"><Link to="/overview"><ArrowLeft className="size-4" /> Project overview</Link></Button>
      </CardContent>
    </Card>
  );
}
