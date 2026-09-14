"use client";

import { useState } from "react";
import { Check, ThumbsDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { isFlightRecorder } from "@/lib/debug";
import {
  type FeedbackReason,
  recordAnswerFeedback,
} from "@/lib/instrumentation/flight-recorder";
import type { AnswerTier } from "@/lib/search/answer-route";
import { cn } from "@/lib/cn";

const REASONS: { id: FeedbackReason; label: string }[] = [
  { id: "wrong-answer", label: "Wrong answer" },
  { id: "too-slow", label: "Too slow" },
  { id: "wrong-source", label: "Wrong source" },
  { id: "missed-context", label: "Missed context" },
  { id: "other", label: "Other" },
];

export function AnswerFeedback({
  answerId,
  tier,
  latencyMs,
}: {
  answerId: string;
  tier: AnswerTier;
  latencyMs: number;
}) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<FeedbackReason | null>(null);

  if (!isFlightRecorder()) return null;

  function submit(reason: FeedbackReason) {
    recordAnswerFeedback({ answerId, reason, tier, latencyMs });
    setSent(reason);
    setOpen(false);
  }

  return (
    <div className="relative inline-flex items-center">
      <Button
        type="button"
        variant="quiet"
        size="sm"
        data-testid="answer-feedback-toggle"
        aria-label={sent ? "Feedback recorded" : "Rate this answer"}
        aria-expanded={open}
        disabled={Boolean(sent)}
        className={cn(sent && "text-muted")}
        onClick={() => setOpen((value) => !value)}
      >
        {sent ? <Check className="size-3.5" /> : <ThumbsDown className="size-3.5" />}
      </Button>
      {open && !sent ? (
        <div
          className="absolute right-0 top-full z-20 mt-1 min-w-[11rem] rounded-md border border-border bg-surface p-1 shadow-md"
          data-testid="answer-feedback-picker"
          role="menu"
        >
          {REASONS.map((reason) => (
            <button
              key={reason.id}
              type="button"
              role="menuitem"
              data-testid={`answer-feedback-${reason.id}`}
              className="block w-full rounded px-2 py-1.5 text-left text-xs text-fg hover:bg-muted/40"
              onClick={() => submit(reason.id)}
            >
              {reason.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
