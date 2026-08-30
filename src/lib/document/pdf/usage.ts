import { isPdfSource, type StoredSource } from "../../context/types.ts";
import type { ContextPdfUsage } from "./limits.ts";

/** Metadata-only context usage. Does not load Blobs or NormalizedDocuments. */
export function contextPdfUsage(sources: StoredSource[], exceptSourceId?: string): ContextPdfUsage {
  let pdfBytes = 0;
  let pdfPages = 0;
  let extractedChars = 0;
  let pdfCount = 0;
  for (const source of sources) {
    if (!isPdfSource(source) || source.id === exceptSourceId) continue;
    pdfCount += 1;
    pdfBytes += source.byteLength;
    if (source.stagedByteLength) pdfBytes += source.stagedByteLength;
    pdfPages += source.pageCount ?? 0;
    if (source.stagedPageCount) pdfPages += source.stagedPageCount;
    extractedChars += source.extractedChars ?? 0;
    if (source.stagedExtractedChars) extractedChars += source.stagedExtractedChars;
  }
  return { pdfBytes, pdfPages, extractedChars, pdfCount };
}
