import { ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { SkippedGroups } from "@/components/index-summary-note";
import { useIndexSkipped } from "@/components/use-index-skipped";
import { cn } from "@/lib/cn";
import { indexChipView } from "@/lib/context/index-status";
import { useMeetHint } from "@/lib/store";

function files(count: number): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? "file" : "files"}`;
}

/**
 * Where the index stands, in the header, so it is on screen before a meeting
 * starts and in every layout (the file pane that also shows it is hidden in
 * overlay mode and behind a tab on a phone).
 *
 * "Indexed 142 files · 3 skipped · 18,400 chunks". The counts are read from
 * the chunks search runs over, so they move when files are added, a PDF
 * finishes, or an exclusion is toggled. While a load runs the chip shows the
 * step in progress instead: a file not reached yet has no chunks either, and
 * calling it skipped would be wrong.
 *
 * Clicking opens the list of files search cannot reach, with the reason for
 * each. Files that failed are listed apart from files skipped by a rule.
 */
export function IndexChip({ className }: { className?: string }) {
  const contextStatus = useMeetHint((s) => s.contextStatus);
  const loadingFolder = useMeetHint((s) => s.loadingFolder);
  const contextUpdating = useMeetHint((s) => s.contextUpdating);
  const activity = useMeetHint((s) => s.indexActivity);
  const ingest = useMeetHint((s) => s.ingestProgress);
  const { summary, failedGroups, leftGroups, failedCount, leftCount } = useIndexSkipped();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const booting = contextStatus === "booting";
  const working =
    booting ||
    contextStatus === "hydrating" ||
    loadingFolder ||
    contextUpdating ||
    Boolean(ingest && ingest.phase !== "ready");
  const view = indexChipView({
    working,
    booting,
    errored: contextStatus === "error",
    activity,
    pdf: ingest,
    summary,
    skipped: failedCount + leftCount,
    failed: failedCount,
  });

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn("index-chip-root", className)}>
      <button
        ref={buttonRef}
        type="button"
        className="index-chip"
        data-testid="index-chip"
        data-state={view.state}
        data-attention={view.attention ? "true" : undefined}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={view.settled ? "Show the files search cannot reach" : "Indexing is still running"}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="index-chip-dot" aria-hidden="true" />
        <span className="index-chip-text tabular-nums" data-testid="index-chip-text">
          {view.text}
        </span>
        <ChevronDown className="index-chip-caret" aria-hidden="true" />
      </button>
      {open ? (
        <div id={panelId} className="index-chip-panel" role="group" aria-label="Index status" data-testid="index-chip-panel">
          {view.settled ? (
            <>
              <p className="index-chip-lead" data-testid="index-chip-stored">
                {files(summary.filesStored)} stored, {files(summary.filesIndexed)} searchable.
              </p>
              {failedCount + leftCount === 0 ? (
                <p className="index-chip-note" data-testid="index-chip-complete">
                  {summary.filesStored > 0
                    ? "No skipped files on record. Every stored file is searchable."
                    : "Nothing has been added to this space yet."}
                </p>
              ) : null}
              {failedCount > 0 ? (
                <section>
                  <h3 className="index-chip-heading index-chip-heading-failed">{files(failedCount)} failed to parse</h3>
                  <SkippedGroups groups={failedGroups} testId="index-chip-failed" />
                </section>
              ) : null}
              {leftCount > 0 ? (
                <section>
                  <h3 className="index-chip-heading">{files(leftCount)} skipped by a rule</h3>
                  <SkippedGroups groups={leftGroups} testId="index-chip-skipped" />
                </section>
              ) : null}
            </>
          ) : (
            <p className="index-chip-note" data-testid="index-chip-working">
              {view.text} The list of skipped files is final once this finishes.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
