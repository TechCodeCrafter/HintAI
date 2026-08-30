import type { Card, Citation, DocumentCitation } from "../../repo/types.ts";
import type { DocumentEvidence } from "../../search/evidence.ts";
import type { DocumentOpenTarget } from "./types.ts";

/**
 * Citation click → Card evidence by evidenceId. Path is display metadata.
 * Never reconstruct itemRanges from the chip text.
 */
export function documentEvidenceForCitation(
  card: Card | null | undefined,
  cite: Citation,
): DocumentEvidence | null {
  if (cite.kind !== "document") return null;
  if (!cite.evidenceId) return null;
  const found = card?.evidence?.find((item) => item.kind === "document" && item.id === cite.evidenceId);
  return found?.kind === "document" ? found : null;
}

export function openTargetFromEvidence(evidence: DocumentEvidence): DocumentOpenTarget {
  return {
    sourceId: evidence.sourceId,
    contentHash: evidence.contentHash,
    page: evidence.page,
    evidenceId: evidence.id,
  };
}

export function resolveDocumentOpen(
  card: Card | null | undefined,
  cite: DocumentCitation,
): { target: DocumentOpenTarget; evidence: DocumentEvidence } | { target: null; reason: "missing-evidence" } {
  const evidence = documentEvidenceForCitation(card, cite);
  if (!evidence) return { target: null, reason: "missing-evidence" };
  if (evidence.sourceId !== cite.sourceId) return { target: null, reason: "missing-evidence" };
  if (evidence.page !== cite.page) return { target: null, reason: "missing-evidence" };
  return { target: openTargetFromEvidence(evidence), evidence };
}

export function evidenceForOpenTarget(
  card: Card | null | undefined,
  target: DocumentOpenTarget | null,
): DocumentEvidence | null {
  if (!target) return null;
  const found = card?.evidence?.find((item) => item.kind === "document" && item.id === target.evidenceId);
  if (!found || found.kind !== "document") return null;
  if (found.sourceId !== target.sourceId) return null;
  if (found.contentHash !== target.contentHash) return null;
  return found;
}
