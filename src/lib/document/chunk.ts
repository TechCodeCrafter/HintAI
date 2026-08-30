import type { DocumentChunk, NormalizedDocument, NormalizedPage } from "./types.ts";

export const DOCUMENT_CHUNK_CAP = 1200;

export function documentChunkId(
  sourceId: string,
  page: number,
  startOffset: number,
  endOffset: number,
  contentHash: string,
): string {
  return `${sourceId}:p${page}:${startOffset}-${endOffset}:${contentHash}`;
}

/**
 * PDF pages → DocumentChunks. Never spans pages. Never goes through buildChunks.
 * Newlines in NormalizedPage.text are hard block boundaries (paragraph,
 * column, or isolated line). Blocks are never merged.
 */
export function buildDocumentChunks(document: NormalizedDocument): DocumentChunk[] {
  if (document.readiness !== "ready") return [];
  const headingByPage = new Map<number, string>();
  for (const item of document.outline) {
    if (item.page && item.title.trim() && !headingByPage.has(item.page)) {
      headingByPage.set(item.page, item.title);
    }
  }
  const chunks: DocumentChunk[] = [];
  for (const page of document.pages) {
    if (page.index === "skipped" || !page.text) continue;
    const heading = headingByPage.get(page.pageNumber);
    if (page.index === "isolated-lines") {
      for (const block of pageBlocks(page)) {
        const text = page.text.slice(block.start, block.end);
        if (!isolatedLineEligible(text)) continue;
        chunks.push(makeChunk(document, page, block.start, block.end, heading));
      }
      continue;
    }
    for (const block of pageBlocks(page)) {
      chunks.push(...splitToCap(document, page, block.start, block.end, heading));
    }
  }
  return chunks;
}

export function isUsableDocumentChunk(chunk: unknown): chunk is DocumentChunk {
  if (!chunk || typeof chunk !== "object") return false;
  const row = chunk as DocumentChunk;
  return (
    row.kind === "document" &&
    typeof row.id === "string" &&
    typeof row.sourceId === "string" &&
    row.sourceId.length > 0 &&
    typeof row.path === "string" &&
    typeof row.page === "number" &&
    row.page >= 1 &&
    typeof row.startOffset === "number" &&
    typeof row.endOffset === "number" &&
    row.endOffset > row.startOffset &&
    typeof row.text === "string" &&
    row.text.length > 0 &&
    typeof row.contentHash === "string" &&
    row.contentHash.length > 0 &&
    !("startLine" in row && row.startLine !== undefined) &&
    !("endLine" in row && row.endLine !== undefined)
  );
}

export function assertChunkMatchesPage(document: NormalizedDocument, chunk: DocumentChunk) {
  const page = document.pages.find((entry) => entry.pageNumber === chunk.page);
  if (!page) throw new Error(`chunk page ${chunk.page} missing`);
  if (page.text.slice(chunk.startOffset, chunk.endOffset) !== chunk.text) {
    throw new Error(`chunk text does not match page ${chunk.page} offsets`);
  }
}

/** Isolated-lines eligibility. Stricter than layout's lineIsUsable. */
export function isolatedLineEligible(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^\d{1,4}$/.test(trimmed)) return false;
  if (/^[\W_]+$/.test(trimmed)) return false;
  const words = trimmed.split(/\s+/).filter((word) => /[A-Za-z]{2,}/.test(word));
  if (words.length >= 4) return true;
  return words.length >= 3 && /[.!?]/.test(trimmed) && trimmed.length >= 16;
}

function pageBlocks(page: NormalizedPage): Array<{ start: number; end: number }> {
  const { text } = page;
  if (page.readingOrder === "two-column" && page.columnBreakOffset !== undefined) {
    const br = page.columnBreakOffset;
    return [...splitNewlines(text, 0, br), ...splitNewlines(text, br + 1, text.length)];
  }
  return splitNewlines(text, 0, text.length);
}

function splitNewlines(text: string, from: number, to: number): Array<{ start: number; end: number }> {
  const lo = Math.max(0, from);
  const hi = Math.min(text.length, to);
  const parts: Array<{ start: number; end: number }> = [];
  let start = lo;
  for (let i = lo; i < hi; i += 1) {
    if (text[i] !== "\n") continue;
    if (i > start) parts.push({ start, end: i });
    start = i + 1;
  }
  if (start < hi) parts.push({ start, end: hi });
  return parts.filter((part) => text.slice(part.start, part.end).trim().length > 0);
}

function splitToCap(
  document: NormalizedDocument,
  page: NormalizedPage,
  start: number,
  end: number,
  heading: string | undefined,
): DocumentChunk[] {
  if (end - start <= DOCUMENT_CHUNK_CAP) {
    return [makeChunk(document, page, start, end, heading)];
  }
  const ranges = splitSentences(page.text, start, end).flatMap((range) =>
    range.end - range.start <= DOCUMENT_CHUNK_CAP ? [range] : splitWhitespace(page.text, range.start, range.end),
  );
  return ranges.map((range) => makeChunk(document, page, range.start, range.end, heading));
}

function splitSentences(text: string, from: number, to: number): Array<{ start: number; end: number }> {
  const parts: Array<{ start: number; end: number }> = [];
  let start = from;
  for (let i = from; i < to; i += 1) {
    const ch = text[i];
    if ((ch === "." || ch === "!" || ch === "?") && (i + 1 === to || /\s/.test(text[i + 1] ?? ""))) {
      let end = i + 1;
      while (end < to && /\s/.test(text[end] ?? "")) end += 1;
      if (end > start) parts.push({ start, end: Math.min(end, to) });
      start = end;
    }
  }
  if (start < to) parts.push({ start, end: to });
  return parts.filter((part) => text.slice(part.start, part.end).trim().length > 0);
}

function splitWhitespace(text: string, from: number, to: number): Array<{ start: number; end: number }> {
  const parts: Array<{ start: number; end: number }> = [];
  let start = from;
  while (start < to) {
    if (to - start <= DOCUMENT_CHUNK_CAP) {
      parts.push({ start, end: to });
      break;
    }
    let cut = start + DOCUMENT_CHUNK_CAP;
    const window = text.slice(start, cut);
    const space = window.lastIndexOf(" ");
    if (space >= 8) cut = start + space + 1;
    parts.push({ start, end: cut });
    start = cut;
  }
  return parts.filter((part) => text.slice(part.start, part.end).trim().length > 0);
}

function makeChunk(
  document: NormalizedDocument,
  page: NormalizedPage,
  startOffset: number,
  endOffset: number,
  heading: string | undefined,
): DocumentChunk {
  const text = page.text.slice(startOffset, endOffset);
  return {
    kind: "document",
    id: documentChunkId(document.sourceId, page.pageNumber, startOffset, endOffset, document.contentHash),
    sourceId: document.sourceId,
    path: document.path,
    page: page.pageNumber,
    startOffset,
    endOffset,
    text,
    contentHash: document.contentHash,
    readingOrder: page.readingOrder,
    heading,
  };
}
