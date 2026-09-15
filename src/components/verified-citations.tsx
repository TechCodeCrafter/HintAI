import { Check } from "lucide-react";
import type { Citation } from "@/lib/repo/types";
import {
  citationChipText,
  citationText,
  citedLineRange,
  citedPath,
  isDocumentCitation,
  isFileCitation,
} from "@/lib/search/cite";

export function VerifiedCitations({
  citations,
  overlay = false,
  onOpenCited,
}: {
  citations: Citation[];
  overlay?: boolean;
  onOpenCited: (cite: Citation) => void;
}) {
  if (citations.length === 0) return null;
  return (
    <ul className="answer-receipt-cites">
      {citations.map((c) => {
        const opensFile = Boolean(citedPath(c));
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
            >
              <Check className="size-3.5 shrink-0 text-ok" aria-hidden="true" />
              <span className="cite-status">Verified</span>
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
