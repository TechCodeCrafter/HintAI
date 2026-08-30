import type { DocumentEvidence } from "../../search/evidence.ts";
import type { DocumentItemRange } from "../types.ts";

/**
 * How the viewer painted evidence. Never upgraded past what mapping can prove.
 *
 * exact        — character ranges inside the 6.3.289 TextLayer spans
 * item-box     — whole source-item geometry; approximate by definition
 * caption-only — correct page + caption; no highlight
 */
export type HighlightMode = "exact" | "item-box" | "caption-only";

export type DocumentOpenTarget = {
  sourceId: string;
  contentHash: string;
  page: number;
  /** Empty when the user opened the source from the Repo tree. */
  evidenceId?: string;
};

export type ViewerBox = {
  itemIndex: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type ExactHighlight = {
  itemIndex: number;
  charStart: number;
  charEnd: number;
};

export type HighlightPlan = {
  mode: HighlightMode;
  page: number;
  exact: ExactHighlight[];
  boxes: ViewerBox[];
  caption: string;
};

export type ViewerOpenRequest = {
  sourceId: string;
  contentHash: string;
  page: number;
  itemRanges: DocumentItemRange[];
  sourceText: string;
  supportText: string;
  evidenceId: string;
};

export type ViewerAvailability = "ready" | "stale" | "missing";

export function requestFromEvidence(evidence: DocumentEvidence): ViewerOpenRequest {
  return {
    sourceId: evidence.sourceId,
    contentHash: evidence.contentHash,
    page: evidence.page,
    itemRanges: evidence.itemRanges,
    sourceText: evidence.sourceText,
    supportText: evidence.supportText,
    evidenceId: evidence.id,
  };
}
