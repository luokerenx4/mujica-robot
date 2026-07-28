import * as React from "react";
import { ScrollText } from "lucide-react";
import { PageHeading } from "@/components/page-state";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

export function EvidencePage(): React.JSX.Element {
  return (
    <>
      <PageHeading
        eyebrow="Complete debugger"
        title="Full evidence projection"
        description="The original comprehensive debugger remains available while its evidence panels move into typed, route-owned React pages."
        aside={<Badge variant="secondary"><ScrollText className="size-3" /> immutable legacy projection</Badge>}
      />
      <Card className="overflow-hidden">
        <iframe
          title="Complete Mujica evidence debugger"
          src="./legacy.html"
          className="h-[calc(100vh-13rem)] min-h-[720px] w-full border-0 bg-[#0b1015]"
        />
      </Card>
    </>
  );
}
