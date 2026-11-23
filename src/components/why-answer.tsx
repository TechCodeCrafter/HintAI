import { ChevronRight } from "lucide-react";
import type { Card } from "@/lib/repo/types";
import { whyAnswer } from "@/lib/search/why-answer";

/**
 * "Why this answer?" on a Card that speaks: the exact spans the line was read
 * from, with the words it uses marked.
 *
 * It reads the evidence already on the Card, so opening it makes no request
 * and it works offline. A native <details> keeps it keyboard and
 * screen-reader correct with no state: Enter or Space toggles it.
 */
export function WhyAnswer({ card }: { card: Pick<Card, "say" | "evidence" | "parts"> | null | undefined }) {
  if (!card?.say) return null;
  const spans = whyAnswer(card);
  return (
    <details className="why-answer" data-testid="card-why">
      <summary className="why-answer-summary" data-testid="card-why-toggle">
        <ChevronRight className="why-answer-caret size-3.5 shrink-0" aria-hidden="true" />
        <span>Why this answer?</span>
        <span className="why-answer-count tabular-nums">{spans.length}</span>
      </summary>
      {spans.length === 0 ? (
        <p className="why-answer-note" data-testid="card-why-empty">
          No evidence spans were recorded for this answer. Treat it as unverified.
        </p>
      ) : (
        <>
          <p className="why-answer-note">
            {spans.length === 1
              ? "The answer was read from this passage. Marked words are the ones it uses."
              : "The answer was read from these passages. Marked words are the ones it uses."}
          </p>
          <ol className="why-answer-list">
            {spans.map((span) => (
              <li key={span.id} className="why-answer-span" data-testid="card-why-span" data-kind={span.kind}>
                <p className="why-answer-where">
                  <span className="break-all font-mono" data-testid="card-why-where">
                    {span.label}
                  </span>
                  {span.detail ? <span className="why-answer-detail">{span.detail}</span> : null}
                </p>
                {span.said ? (
                  <p className="why-answer-said" data-testid="card-why-said">
                    <span className="sr-only">Spoken from this passage: </span>
                    {span.said}
                  </p>
                ) : null}
                <pre className="why-answer-text" data-testid="card-why-text" tabIndex={0}>
                  {span.segments.map((segment, index) =>
                    segment.hit ? (
                      <mark key={index} className="why-answer-mark" data-testid="card-why-mark">
                        {segment.text}
                      </mark>
                    ) : (
                      <span key={index}>{segment.text}</span>
                    ),
                  )}
                </pre>
              </li>
            ))}
          </ol>
        </>
      )}
    </details>
  );
}
