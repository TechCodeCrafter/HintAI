/**
 * PDF / document IR for Phase 4A.
 *
 * Search never sees raw PDF.js items. It sees NormalizedDocument.text after
 * MappedSegment joins. Currentness reads items[itemIndex].str, not a reparse.
 *
 * 4A.3 chunks NormalizedDocument into DocumentChunks for retrieve() only.
 */

export type PdfTextItem = {
  itemIndex: number;
  str: string;
  transform: [number, number, number, number, number, number];
  width: number;
  height: number;
};

export type SourceSegment = {
  kind: "source";
  itemIndex: number;
  sourceStart: number;
  sourceEnd: number;
  normStart: number;
  normEnd: number;
  transform: [number, number, number, number, number, number];
  width: number;
  height: number;
};

export type InsertedSegment = {
  kind: "inserted";
  inserted: "space" | "newline";
  normStart: number;
  normEnd: number;
};

export type MappedSegment = SourceSegment | InsertedSegment;

export type PdfOutlineItem = {
  title: string;
  page?: number;
};

export type PageReadingOrder = "single-column" | "two-column" | "uncertain";
export type PageIndexMode = "full" | "isolated-lines" | "skipped";

export type NormalizedPage = {
  pageNumber: number;
  text: string;
  items: PdfTextItem[];
  segments: MappedSegment[];
  readingOrder: PageReadingOrder;
  usefulItemCount: number;
  index: PageIndexMode;
  /**
   * Offset of the inserted newline between left and right columns.
   * Present only on high-confidence two-column pages. The chunker must
   * never merge text across this boundary.
   */
  columnBreakOffset?: number;
};

export type PdfDocumentReadiness = "ready" | "scanned" | "unreadable" | "refused";

export type NormalizedDocument = {
  contextId: string;
  sourceId: string;
  path: string;
  contentHash: string;
  type: "pdf";
  parserVersion: number;
  normalizerVersion: number;
  pageCount: number;
  outline: PdfOutlineItem[];
  pages: NormalizedPage[];
  readiness: PdfDocumentReadiness;
  readinessNote?: string;
};

export type DocumentItemRange = {
  page: number;
  itemIndex: number;
  charStart: number;
  charEnd: number;
};

export type DocumentChunk = {
  kind: "document";
  id: string;
  path: string;
  sourceId: string;
  page: number;
  startOffset: number;
  endOffset: number;
  text: string;
  contentHash: string;
  readingOrder: PageReadingOrder;
  heading?: string;
};

export type SourceBlobRecord = {
  id: string;
  contextId: string;
  sourceId: string;
  contentHash: string;
  blob: Blob;
};

export type NormalizedDocumentRow = {
  id: string;
  contextId: string;
  sourceId: string;
  contentHash: string;
  document: NormalizedDocument;
};

export function sourceBlobKey(sourceId: string, contentHash: string): string {
  return `${sourceId}:${contentHash}`;
}

export function normalizedDocumentKey(sourceId: string, contentHash: string): string {
  return `${sourceId}:${contentHash}`;
}
