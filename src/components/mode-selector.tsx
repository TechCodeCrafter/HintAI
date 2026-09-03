"use client";

import { useState } from "react";
import { Lock } from "lucide-react";
import { UpgradeModal } from "@/components/upgrade-modal";
import { cn } from "@/lib/cn";
import { isPaidTier, type SubscriptionTier } from "@/lib/billing/subscription";
import { useMeetHint, type ComposeMode } from "@/lib/store";

const MODES: Array<{ id: ComposeMode; label: string; upgrade: string }> = [
  { id: "extract", label: "Extract", upgrade: "" },
  {
    id: "synthesize",
    label: "Synthesize",
    upgrade: "Synthesize mode requires Pro. Upgrade to combine insights from multiple files with verified citations.",
  },
  {
    id: "audit",
    label: "Audit",
    upgrade: "Claim Audit requires Pro. Upgrade to track and verify claims across meetings.",
  },
];

function lockedFor(id: ComposeMode, subscription: SubscriptionTier): boolean {
  return id !== "extract" && !isPaidTier(subscription);
}

export function ModeSelector() {
  const mode = useMeetHint((s) => s.composeMode);
  const subscription = useMeetHint((s) => s.subscription);
  const setComposeMode = useMeetHint((s) => s.setComposeMode);
  const [upgrade, setUpgrade] = useState<string | null>(null);

  return (
    <div className="mode-selector shrink-0" data-testid="mode-selector">
      <div
        className="flex w-full overflow-hidden rounded-md border border-line bg-bg"
        role="group"
        aria-label="Answer mode"
      >
        {MODES.map((item) => {
          const locked = lockedFor(item.id, subscription);
          const active = mode === item.id;
          return (
            <button
              key={item.id}
              type="button"
              data-testid={`mode-${item.id}`}
              data-locked={locked ? "true" : undefined}
              aria-pressed={active}
              aria-label={locked ? `${item.label} (requires Pro)` : item.label}
              className={cn(
                "inline-flex min-h-8 min-w-0 flex-1 items-center justify-center gap-1 border-r border-line px-1.5 text-[11px] leading-none last:border-r-0",
                active && "bg-accent-soft text-fg",
                !active && "bg-transparent text-body",
                locked && "opacity-50",
              )}
              onClick={() => {
                if (locked) {
                  setUpgrade(item.upgrade);
                  return;
                }
                setUpgrade(null);
                setComposeMode(item.id);
              }}
            >
              <span className="truncate">{item.label}</span>
              {locked ? <Lock className="size-3 shrink-0" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
      {upgrade ? <UpgradeModal reason={upgrade} onClose={() => setUpgrade(null)} /> : null}
    </div>
  );
}
