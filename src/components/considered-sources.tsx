import { ChevronRight } from "lucide-react";
import type { ConsideredSource } from "@/lib/repo/types";
import { consideredText } from "@/lib/search/considered";

/**
 * The other loaded files retrieval ranked for the question, behind an expander.
 *
 * These are not citations and are styled so they cannot be read as one: no
 * check mark, no "Verified", and a line that says nothing in the answer rests
 * on them. Closed by default, because the answer and its evidence come first.
 *
 * A native <details> keeps this keyboard and screen-reader correct with no
 * state: Enter or Space toggles it, and the open state is announced.
 */
export function ConsideredSources({
  sources,
  silent = false,
  canOpen,
  onOpen,
}: {
  sources: ConsideredSource[];
  /** The Card said nothing, so these are the files that were checked, not "other" files. */
  silent?: boolean;
  /** False where the source cannot be shown (a PDF while the overlay hides the viewer). */
  canOpen?: (source: ConsideredSource) => boolean;
  onOpen?: (source: ConsideredSource) => void;
}) {
  if (sources.length === 0) return null;
  const label = silent ? "Files checked" : "Other files considered";
  return (
    <details className="considered" data-testid="card-considered">
      <summary className="considered-summary">
        <ChevronRight className="considered-caret size-3.5 shrink-0" aria-hidden="true" />
        <span>{label}</span>
        <span className="considered-count tabular-nums">{sources.length}</span>
      </summary>
      <p className="considered-note">
        {silent
          ? "Ranked highest for this question. No cited answer came from them."
          : "Ranked for this question and not cited. Nothing in the answer rests on them."}
      </p>
      <ConsideredList sources={sources} canOpen={canOpen} onOpen={onOpen} />
    </details>
  );
}

/**
 * The ranked files themselves, each a button that opens the file at the ranked
 * lines where it can be opened. Also listed under a silent Card's reason.
 */
export function ConsideredList({
  sources,
  canOpen,
  onOpen,
}: {
  sources: ConsideredSource[];
  canOpen?: (source: ConsideredSource) => boolean;
  onOpen?: (source: ConsideredSource) => void;
}) {
  return (
    <ul className="considered-list">
      {sources.map((source) => {
        const text = consideredText(source);
        const opens = Boolean(onOpen) && (canOpen ? canOpen(source) : true);
        return (
          <li key={`${source.kind}:${source.path}`} className="min-w-0">
            {opens ? (
              <button
                type="button"
                className="considered-item"
                data-testid="card-considered-item"
                data-path={source.path}
                title={`Open ${text}`}
                onClick={() => onOpen?.(source)}
              >
                <span className="break-all font-mono text-[12px]">{text}</span>
                <span className="sr-only">, considered and not cited</span>
              </button>
            ) : (
              <span className="considered-item" data-testid="card-considered-item" data-path={source.path}>
                <span className="break-all font-mono text-[12px]">{text}</span>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
