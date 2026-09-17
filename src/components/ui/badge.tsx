import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide",
  {
    variants: {
      variant: {
        ready: "bg-[color-mix(in_srgb,var(--color-ok)_14%,transparent)] text-ok",
        indexing: "bg-[color-mix(in_srgb,var(--color-warn)_16%,transparent)] text-warn",
        error: "bg-[color-mix(in_srgb,var(--color-bad)_14%,transparent)] text-bad",
        listening: "bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] text-accent",
        idle: "bg-[color-mix(in_srgb,var(--color-muted)_18%,transparent)] text-muted",
        local: "bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] text-accent",
        unsupported: "bg-[color-mix(in_srgb,var(--color-muted)_16%,transparent)] text-muted",
        neutral: "border border-line bg-subtle text-secondary",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export function Badge({
  className,
  variant,
  dot,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants> & {
    dot?: boolean;
  }) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot ? (
        <span
          className={cn(
            "size-1.5 rounded-full",
            variant === "ready" && "bg-ok",
            variant === "indexing" && "bg-warn",
            variant === "error" && "bg-bad",
            variant === "listening" && "bg-accent live-dot",
            variant === "idle" && "bg-muted",
            variant === "local" && "bg-accent",
            variant === "unsupported" && "bg-muted",
            (!variant || variant === "neutral") && "bg-muted",
          )}
          aria-hidden
        />
      ) : null}
      {children}
    </span>
  );
}
