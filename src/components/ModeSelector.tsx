"use client";

import { cn } from "@/lib/cn";
import { isPaidTier, type SubscriptionTier } from "@/lib/billing/subscription";
import type { ComposeMode } from "@/lib/store";

const MODES: ComposeMode[] = ["extract", "synthesize", "audit"];

const LABELS: Record<ComposeMode, string> = {
  extract: "Extract",
  synthesize: "Synthesize",
  audit: "Audit",
};

function lockedFor(id: ComposeMode, subscription: SubscriptionTier): boolean {
  return id !== "extract" && !isPaidTier(subscription);
}

export function ModeSelector({
  mode,
  subscription,
  onChangeMode,
  onUpgradePrompt,
}: {
  mode: ComposeMode;
  subscription: SubscriptionTier;
  onChangeMode: (mode: ComposeMode) => void;
  onUpgradePrompt: (feature: string) => void;
}) {
  return (
    <div className="mode-selector shrink-0" data-testid="mode-selector">
      <div
        className="flex w-full gap-1 rounded-[10px] bg-subtle p-1"
        role="group"
        aria-label="Answer mode"
      >
        {MODES.map((id) => {
          const locked = lockedFor(id, subscription);
          const active = mode === id;
          return (
            <button
              key={id}
              type="button"
              data-testid={`mode-${id}`}
              data-locked={locked ? "true" : undefined}
              aria-pressed={active}
              aria-label={locked ? `${LABELS[id]} (requires Pro)` : LABELS[id]}
              data-active={active ? "true" : undefined}
              className={cn(
                "mode-tab inline-flex min-h-8 min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-2 text-[12px] leading-none",
                locked && "opacity-40",
              )}
              onClick={() => {
                if (locked) {
                  onUpgradePrompt(id);
                  return;
                }
                onChangeMode(id);
              }}
            >
              <span className="truncate">{LABELS[id]}</span>
              {locked ? <span aria-hidden="true">🔒</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
