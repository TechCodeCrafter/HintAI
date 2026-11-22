import { Check } from "lucide-react";
import type { Citation } from "@/lib/repo/types";
import { citationChipText, citationText, citedPath, isDocumentCitation } from "@/lib/search/cite";

export function VerifiedCitations({
  citations,
  overlay = false,
  loadedPaths,
  onOpenCited,
}: {
  citations: Citation[];
  overlay?: boolean;
  /**
   * Paths loaded right now, when the caller knows. A file citation outside the
   * set (an older answer whose file was since removed) keeps its coordinates on
   * screen but is neither clickable nor labelled Verified.
   */
  loadedPaths?: ReadonlySet<string>;
  onOpenCited: (cite: Citation) => void;
}) {
  if (citations.length === 0) return null;
  return (
    <ul className="answer-receipt-cites">
      {citations.map((c) => {
        const filePath = citedPath(c);
        const loaded = !filePath || !loadedPaths || loadedPaths.has(filePath);
        const opensFile = Boolean(filePath) && loaded;
        const opensPdf = isDocumentCitation(c) && !overlay;
        const opens = opensFile || opensPdf;
        const chip = citationChipText(c);
        return (
          <li key={c.evidenceId ?? citationText(c)} className="min-w-0 cite-fade" data-testid="card-citation">
            <button
              type="button"
              onClick={opens ? () => onOpenCited(c) : undefined}
              disabled={!opens}
              className="cite-chip"
              data-source-id={"sourceId" in c ? c.sourceId : undefined}
              data-loaded={loaded ? undefined : "false"}
              title={opens ? `Open ${citationText(c)}` : undefined}
            >
              {loaded ? <Check className="size-3.5 shrink-0 text-ok" aria-hidden="true" /> : null}
              <span className="cite-status">{loaded ? "Verified" : "Not loaded now"}</span>
              <span className="break-all font-mono text-[12px] text-fg">{chip}</span>
              {c.label ? <span className="text-[12px] text-muted">{c.label}</span> : null}
              <span className="sr-only">{citationText(c)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
