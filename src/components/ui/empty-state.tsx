import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  testId,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: { label: string; onClick?: () => void; href?: string; testId?: string };
  className?: string;
  testId?: string;
}) {
  return (
    <div
      className={cn("ds-surface flex flex-col items-center gap-3 px-6 py-10 text-center", className)}
      data-testid={testId}
    >
      {icon ? <div className="text-muted [&_svg]:size-8">{icon}</div> : null}
      <p className="ds-card-title">{title}</p>
      {description ? <p className="ds-body max-w-sm">{description}</p> : null}
      {action ? (
        action.href ? (
          <a href={action.href} className="mh-cta inline-flex items-center" data-testid={action.testId}>
            {action.label}
          </a>
        ) : (
          <Button type="button" onClick={action.onClick} data-testid={action.testId}>
            {action.label}
          </Button>
        )
      ) : null}
    </div>
  );
}
