import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function DropzoneCard({
  icon,
  title,
  description,
  footer,
  disabled,
  testId,
  onClick,
  className,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  footer?: string;
  disabled?: boolean;
  testId?: string;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      data-testid={testId}
      onClick={onClick}
      className={cn("ds-dropzone w-full", className)}
    >
      <div className="space-y-2">
        <span className="text-accent [&_svg]:size-5">{icon}</span>
        <p className="ds-card-title">{title}</p>
        {description ? <p className="ds-caption">{description}</p> : null}
      </div>
      {footer ? <p className="ds-caption">{footer}</p> : null}
    </button>
  );
}
