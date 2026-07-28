import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.13em]",
  {
    variants: {
      variant: {
        default: "border-cyan-300/25 bg-cyan-300/10 text-cyan-200",
        secondary: "border-white/10 bg-white/[0.05] text-slate-300",
        success: "border-emerald-300/30 bg-emerald-300/10 text-emerald-200",
        destructive: "border-rose-300/30 bg-rose-300/10 text-rose-200",
        warning: "border-amber-300/30 bg-amber-300/10 text-amber-200",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps): React.JSX.Element {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}
