import { ChevronRight } from "lucide-react";
import { ConsideredList } from "@/components/considered-sources";
import { SkippedGroups } from "@/components/index-summary-note";
import { useIndexSkipped } from "@/components/use-index-skipped";
import { formatIndexSummary } from "@/lib/context/index-summary";
import type { Card, ConsideredSource } from "@/lib/repo/types";
import { silenceGuidance } from "@/lib/search/silence";

function files(count: number): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? "file" : "files"}`;
}

/**
 * Why a Card said nothing, and what to do about it.
 *
 * The line is the next step for the Card's silence kind, with the Card's own
 * reason under it when that says more. The line is also a switch: opening it
 * lists what the search actually had, which is the files it ranked highest and
 * the files it never read because they were skipped.
 *
 * Both lists are read from what is loaded now. The ranked files are the ones
 * the caller has already checked are still loaded; the skipped files are
 * counted from the chunks search runs over, the same way the index status is.
 *
 * Render it only for a Card that has a silence kind. A native <details> keeps
 * it keyboard and screen-reader correct with no state of its own.
 */
export function SilenceReason({
  card,
  hits,
  canOpen,
  onOpen,
}: {
  card: Pick<Card, "reason" | "silence">;
  /** The files retrieval ranked for this question that are still loaded. */
  hits: ConsideredSource[];
  canOpen?: (source: ConsideredSource) => boolean;
  onOpen?: (source: ConsideredSource) => void;
}) {
  const { summary, failedGroups, leftGroups, failedCount, leftCount, busy } = useIndexSkipped();
  // While a load runs, a file not reached yet looks skipped. Count none until it settles.
  const skipped = busy ? 0 : failedCount + leftCount;
  const guidance = silenceGuidance(card, { hits: hits.length, skipped });
  if (!guidance) return null;

  return (
    // Announced once when the Card lands. Opening the list is not announced again.
    <div className="silence-reason" role="alert" data-testid="silence-reason" data-kind={card.silence}>
      <details>
        <summary className="silence-reason-summary" data-testid="card-reason">
          <ChevronRight className="silence-reason-caret size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            <span className="silence-reason-headline" data-testid="silence-headline">
              {guidance.headline}
            </span>
            {guidance.detail ? (
              <span className="silence-reason-detail" data-testid="silence-detail">
                {guidance.detail}
              </span>
            ) : null}
          </span>
        </summary>
        <div className="silence-reason-body" aria-live="off" data-testid="silence-expanded">
          <p className="silence-reason-note tabular-nums" data-testid="silence-index">
            {busy ? "Still indexing. These lists are final once it finishes." : formatIndexSummary(summary)}
          </p>
          <section data-testid="silence-hits">
            <p className="receipt-kicker">Top hits</p>
            {guidance.shows.hits ? (
              <>
                <p className="silence-reason-note">Ranked highest for this question. No cited answer came from them.</p>
                <ConsideredList sources={hits} canOpen={canOpen} onOpen={onOpen} />
              </>
            ) : (
              <p className="silence-reason-note" data-testid="silence-no-hits">
                Nothing ranked for this question that can be opened.
              </p>
            )}
          </section>
          {guidance.shows.skipped ? (
            <section data-testid="silence-skipped">
              <p className="receipt-kicker">{files(skipped)} skipped</p>
              <p className="silence-reason-note">Search never read these.</p>
              {failedCount > 0 ? <SkippedGroups groups={failedGroups} testId="silence-skipped-failed" /> : null}
              {leftCount > 0 ? <SkippedGroups groups={leftGroups} testId="silence-skipped-left" /> : null}
            </section>
          ) : null}
        </div>
      </details>
    </div>
  );
}
