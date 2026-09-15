"use client";

import { useState } from "react";
import { Check, ThumbsDown, ThumbsUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { isFlightRecorder } from "@/lib/debug";
import {
  type NegativeFeedbackCategory,
  NEGATIVE_FEEDBACK_CATEGORIES,
  recordBetaFeedback,
} from "@/lib/instrumentation/beta-telemetry";
import { recordAnswerFeedback } from "@/lib/instrumentation/flight-recorder";
import type { AnswerTier } from "@/lib/search/answer-route";
import { cn } from "@/lib/cn";

const NEGATIVE_REASONS: { id: NegativeFeedbackCategory; label: string }[] = [
  { id: "wrong-answer", label: "Wrong answer" },
  { id: "missing-context", label: "Missing context" },
  { id: "wrong-source", label: "Wrong source" },
  { id: "citation-incorrect", label: "Citation incorrect" },
  { id: "too-vague", label: "Too vague" },
  { id: "too-slow", label: "Too slow" },
  { id: "should-have-stayed-silent", label: "Should have stayed silent" },
  { id: "other", label: "Other" },
];

export function AnswerFeedback({
  traceId,
  answerId,
  tier,
  latencyMs,
  workspaceId,
  spaceId,
  sourceIds,
}: {
  traceId: string;
  answerId?: string;
  tier: AnswerTier;
  latencyMs: number;
  workspaceId?: string;
  spaceId?: string;
  sourceIds?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<"useful" | "not-useful" | null>(null);

  function submitUseful() {
    recordBetaFeedback({
      traceId,
      answerId,
      workspaceId,
      spaceId,
      sourceIds,
      tier,
      latencyMs,
      result: "useful",
    });
    if (isFlightRecorder()) {
      recordAnswerFeedback({
        answerId: answerId ?? traceId,
        reason: "other",
        tier,
        latencyMs,
        result: "useful",
      });
    }
    setSent("useful");
    setOpen(false);
  }

  function submitNegative(category: NegativeFeedbackCategory) {
    recordBetaFeedback({
      traceId,
      answerId,
      workspaceId,
      spaceId,
      sourceIds,
      tier,
      latencyMs,
      result: "not-useful",
      failureCategory: category,
    });
    if (isFlightRecorder()) {
      recordAnswerFeedback({
        answerId: answerId ?? traceId,
        reason: legacyReason(category),
        tier,
        latencyMs,
        result: "not-useful",
        failureCategory: category,
      });
    }
    setSent("not-useful");
    setOpen(false);
  }

  return (
    <div className="relative inline-flex items-center gap-0.5" data-testid="answer-feedback">
      <Button
        type="button"
        variant="quiet"
        size="sm"
        data-testid="answer-feedback-useful"
        aria-label={sent === "useful" ? "Marked useful" : "Useful answer"}
        disabled={Boolean(sent)}
        className={cn(sent === "useful" && "text-ok")}
        onClick={() => submitUseful()}
      >
        {sent === "useful" ? <Check className="size-3.5" /> : <ThumbsUp className="size-3.5" />}
        <span className="sr-only">Useful</span>
      </Button>
      <Button
        type="button"
        variant="quiet"
        size="sm"
        data-testid="answer-feedback-toggle"
        aria-label={sent === "not-useful" ? "Feedback recorded" : "Not useful"}
        aria-expanded={open}
        disabled={Boolean(sent)}
        className={cn(sent === "not-useful" && "text-muted")}
        onClick={() => setOpen((value) => !value)}
      >
        {sent === "not-useful" ? <Check className="size-3.5" /> : <ThumbsDown className="size-3.5" />}
        <span className="sr-only">Not useful</span>
      </Button>
      {open && !sent ? (
        <div
          className="absolute right-0 top-full z-20 mt-1 min-w-[12rem] rounded-md border border-border bg-surface p-1 shadow-md"
          data-testid="answer-feedback-picker"
          role="menu"
        >
          {NEGATIVE_REASONS.map((reason) => (
            <button
              key={reason.id}
              type="button"
              role="menuitem"
              data-testid={`answer-feedback-${reason.id}`}
              className="block w-full rounded px-2 py-1.5 text-left text-xs text-fg hover:bg-muted/40"
              onClick={() => submitNegative(reason.id)}
            >
              {reason.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function legacyReason(category: NegativeFeedbackCategory): "wrong-answer" | "too-slow" | "wrong-source" | "missed-context" | "other" {
  if (category === "missing-context") return "missed-context";
  if (NEGATIVE_FEEDBACK_CATEGORIES.includes(category as NegativeFeedbackCategory)) {
    if (category === "wrong-answer" || category === "too-slow" || category === "wrong-source") return category;
  }
  return "other";
}
