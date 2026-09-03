"use client";

import { useEffect, useId } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

const FEATURE_COPY: Record<string, string> = {
  synthesize:
    "Synthesize mode requires Pro. Upgrade to combine insights from multiple files with verified citations.",
  audit: "Claim Audit requires Pro. Upgrade to track and verify claims across meetings.",
};

const TIERS = [
  { name: "Free", price: "—", points: ["Extract only", "1 pack"] },
  {
    name: "Pro",
    price: "$12/mo",
    points: ["Extract + Synthesize + Claim Audit", "Unlimited packs", "Export"],
  },
  {
    name: "Team",
    price: "$49/seat/mo",
    points: ["Everything in Pro", "Temporal contradiction", "Shared corpus"],
  },
] as const;

export function UpgradeModal({
  open,
  feature,
  onClose,
}: {
  open: boolean;
  feature: string | null;
  onClose: () => void;
}) {
  const titleId = useId();
  const reason = (feature && FEATURE_COPY[feature]) || FEATURE_COPY.synthesize;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-bg/70 p-5" role="presentation" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-sm border border-line bg-surface p-5 text-body shadow-lg"
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
          <div className="grid grid-cols-3 bg-subtle text-[11px] font-medium tracking-wide text-muted uppercase">
            {TIERS.map((tier) => (
              <div key={tier.name} className="border-r border-line px-3 py-2 last:border-r-0">
                <p className="text-fg">{tier.name}</p>
                <p className="mt-0.5 normal-case tracking-normal">{tier.price}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-3 text-xs text-body">
            {TIERS.map((tier) => (
              <ul key={tier.name} className="list-none border-r border-line px-3 py-3 last:border-r-0">
                {tier.points.map((point) => (
                  <li key={point} className="mt-1.5 first:mt-0">
                    {point}
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>

        <Button
          className="mt-5 w-full bg-blue-600 text-white hover:bg-blue-500"
          data-testid="upgrade-cta"
          onClick={() => {
            console.log("Stripe integration pending");
          }}
        >
          Upgrade to Pro — $12/month
        </Button>
      </div>
    </div>
  );
}
