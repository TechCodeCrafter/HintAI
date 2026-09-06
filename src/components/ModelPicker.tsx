"use client";

import { AVAILABLE_MODELS } from "@/lib/ai/models";
import { isPaidTier, type SubscriptionTier } from "@/lib/billing/subscription";
import type { ComposeMode } from "@/lib/store";

export function ModelPicker({
  mode,
  subscription,
  value,
  onChange,
}: {
  mode: ComposeMode;
  subscription: SubscriptionTier;
  value: string;
  onChange: (id: string) => void;
}) {
  if (mode !== "synthesize" || !isPaidTier(subscription)) return null;
  return (
    <label className="flex min-w-0 items-center gap-2 text-[11px] text-muted">
      <span className="shrink-0">Model</span>
      <select
        data-testid="model-picker"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-8 min-w-0 flex-1 rounded-md border border-line bg-bg px-2 text-[11px] text-fg"
        aria-label="Answer model"
      >
        {AVAILABLE_MODELS.map((model) => (
          <option key={model.id} value={model.id}>
            {model.name}
          </option>
        ))}
      </select>
    </label>
  );
}
