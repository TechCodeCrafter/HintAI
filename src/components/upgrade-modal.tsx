"use client";

import { useEffect, useId } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

const COMPARE = [
  { feature: "Extract a cited line from your files", free: true, pro: true },
  { feature: "Synthesize across files with verified citations", free: false, pro: true },
  { feature: "Claim Audit across the meeting", free: false, pro: true },
] as const;

export function UpgradeModal({
  reason,
  onClose,
}: {
  reason: string;
  onClose: () => void;
}) {
  const titleId = useId();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="key-settings-backdrop" role="presentation" onClick={onClose}>
      <div
        className="key-settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="upgrade-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-sm font-medium text-fg">
              Upgrade to Pro
            </h2>
            <p data-testid="upgrade-prompt" className="mt-2 text-xs leading-relaxed text-body">
              {reason}
            </p>
          </div>
          <button
            type="button"
            data-testid="upgrade-close"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-sm text-secondary hover:text-fg"
            aria-label="Close"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-5 overflow-hidden rounded-sm border border-line">
          <div className="grid grid-cols-[1fr_4.5rem_4.5rem] bg-subtle px-3 py-2 text-[11px] font-medium tracking-wide text-muted uppercase">
            <span>Feature</span>
            <span className="text-center">Free</span>
            <span className="text-center">Pro</span>
          </div>
          {COMPARE.map((row) => (
            <div
              key={row.feature}
              className="grid grid-cols-[1fr_4.5rem_4.5rem] items-center border-t border-line px-3 py-2.5 text-xs text-body"
            >
              <span>{row.feature}</span>
              <span className="text-center text-muted">{row.free ? "Yes" : "—"}</span>
              <span className="text-center text-fg">{row.pro ? "Yes" : "—"}</span>
            </div>
          ))}
        </div>

        <Button
          className="mt-5 w-full"
          data-testid="upgrade-cta"
          onClick={() => {
            console.log("Stripe not wired yet");
          }}
        >
          Upgrade to Pro — $12/month
        </Button>
      </div>
    </div>
  );
}
