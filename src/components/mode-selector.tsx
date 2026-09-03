"use client";

import { useState } from "react";
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
    <div className="mode-selector" data-testid="mode-selector">
      <div className="mode-selector-row" role="group" aria-label="Answer mode">
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
              className={cn("mode-selector-btn", active && "mode-selector-btn-active", locked && "opacity-50")}
              onClick={() => {
                if (locked) {
                  setUpgrade(item.upgrade);
                  return;
                }
                setUpgrade(null);
                setComposeMode(item.id);
              }}
            >
              {item.label}
              {locked ? <span aria-hidden="true">🔒</span> : null}
            </button>
          );
        })}
      </div>
      {upgrade ? (
        <p data-testid="upgrade-prompt" className="mode-selector-upgrade">
          {upgrade}
        </p>
      ) : null}
    </div>
  );
}
