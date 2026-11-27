import { useMemo } from "react";
import { ChevronRight } from "lucide-react";
import type { Card } from "@/lib/repo/types";
import { whyAnswer } from "@/lib/search/why-answer";
import { useEvidenceView, useEvidenceViewContext } from "@/components/use-evidence-view";

type WhyCard = Pick<Card, "say" | "evidence" | "parts" | "query">;

/**
 * "Why this answer?" on a Card that speaks: the exact passages the line was
 * read from, with what it took from them marked.
 *
 * It opens three ways. Click it, or press Enter or Space on it, and it stays
 * open, through a reload too. Rest the pointer on the card, or hold a finger
 * on it, and it opens for as long as you are there (see `EvidenceCard`).
 *
 * It reads the evidence already on the Card, so opening it makes no request
 * and it works offline. The passages are only worked out while it is open, so
 * a closed one costs a new answer nothing.
 */
export function WhyAnswer({ card }: { card: WhyCard | null | undefined }) {
  const shared = useEvidenceViewContext();
  // A card not wrapped in an EvidenceCard still gets click, keyboard and reload.
  const own = useEvidenceView(shared ? null : card);
  const view = shared ?? own.view;
  const spans = useMemo(() => (view.open ? whyAnswer(card) : []), [card, view.open]);
  if (!card?.say) return null;
  const count = card.evidence?.length ?? 0;
  const exact = spans.some((span) => span.segments.some((segment) => segment.exact));
  return (
    <details
      className="why-answer"
      data-testid="card-why"
      data-opened-by={view.open ? (view.pinned ? "pin" : "hover") : undefined}
      open={view.open}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !view.open) return;
        event.stopPropagation();
        view.setPinned(false);
      }}
    >
      <summary
        className="why-answer-summary"
        data-testid="card-why-toggle"
        // The browser's own toggle is replaced so hover and click share one state.
        onClick={(event) => {
          event.preventDefault();
          view.setPinned((was) => !was);
        }}
      >
        <ChevronRight className="why-answer-caret size-3.5 shrink-0" aria-hidden="true" />
        <span>Why this answer?</span>
        <span className="why-answer-count tabular-nums">{count}</span>
        {view.open && !view.pinned ? <span className="why-answer-hint">Click to keep open</span> : null}
      </summary>
      {!view.open ? null : spans.length === 0 ? (
        <p className="why-answer-note" data-testid="card-why-empty" data-evidence-body="">
          No evidence spans were recorded for this answer. Treat it as unverified.
        </p>
      ) : (
        <div data-evidence-body="">
          <p className="why-answer-note">
            {spans.length === 1 ? "The answer was read from this passage. " : "The answer was read from these passages. "}
            {exact ? (
              <>
                <mark className="why-answer-mark" data-exact="true">
                  Solid marks
                </mark>{" "}
                are word for word what it says. <mark className="why-answer-mark">Light marks</mark> are single words it
                uses.
              </>
            ) : (
              "Marked words are the ones it uses."
            )}
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
                      <mark
                        key={index}
                        className="why-answer-mark"
                        data-testid="card-why-mark"
                        data-exact={segment.exact ? "true" : undefined}
                      >
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
        </div>
      )}
    </details>
  );
}
