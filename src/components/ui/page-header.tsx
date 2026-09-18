import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function PageHeader({
  overline,
  title,
  description,
  actions,
  breadcrumb,
  className,
}: {
  overline?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("space-y-3", className)}>
      {breadcrumb}
      {overline ? <p className="ds-overline">{overline}</p> : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <h1 className="ds-display">{title}</h1>
          {description ? <p className="ds-body max-w-2xl">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
