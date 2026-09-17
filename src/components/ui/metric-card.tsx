import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function MetricCard({
  label,
  value,
  detail,
  icon,
  className,
}: {
  label: string;
  value: string | number;
  detail?: string;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("ds-surface space-y-1 p-4", className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="ds-caption font-medium uppercase tracking-wider">{label}</p>
        {icon ? <span className="text-muted [&_svg]:size-4">{icon}</span> : null}
      </div>
      <p className="text-2xl font-semibold tabular-nums tracking-tight text-fg">{value}</p>
      {detail ? <p className="ds-caption">{detail}</p> : null}
    </div>
  );
}
