/**
 * Phase 4A.9.4 block-aware DocumentChunks.
 *
 * A chunk is a contiguous slice of NormalizedPage.text. Never reconstruct
 * text from items, never invent block-local offsets. Furniture, unknown,
 * and pure math emit zero chunks.
 */
import type { DocumentBlock } from "./blocks.ts";
import {
  furnitureHint,
  isFurnitureCandidate,
  mappedRangeForItems,
  normalizeFurnitureText,
} from "./blocks.ts";
import { deriveDocumentStructure, type DocumentStructure, type StructuredPage } from "./structure.ts";
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

export type ListChunkFate = "parent-contiguous" | "member-groups" | "item-only" | "unsearchable";

/**
 * PDF pages → DocumentChunks from safe mapped DocumentBlocks.
 * Never spans pages. Never goes through buildChunks.
 *
 * When a page has no visual structure at all and its 4A.9.2 index is `full`,
 * the accepted newline paragraph path is used. Isolated-line and unknown
 * material are not searchable fallbacks.
 */
export function buildDocumentChunks(
  document: NormalizedDocument,
  structure?: DocumentStructure,
): DocumentChunk[] {
  if (document.readiness !== "ready") return [];
  const derived = asDocumentStructure(structure) ?? deriveDocumentStructure(document);
  const headingByPage = new Map<number, string>();
  for (const item of document.outline) {
    if (item.page && item.title.trim() && !headingByPage.has(item.page)) {
      headingByPage.set(item.page, item.title);
    }
  }
  const furnitureTexts = classifiedFurnitureTexts(derived);
  const chunks: DocumentChunk[] = [];
  for (const page of document.pages) {
    if (!page.text) continue;
    const structured = derived.pages.find((entry) => entry.pageNumber === page.pageNumber);
    const outlineHeading = headingByPage.get(page.pageNumber);
    const banned = furnitureBannedRanges(page, structured, furnitureTexts);
    if (!structured || structured.blocks.length === 0) {
      if (page.index === "full") {
        chunks.push(...legacyFullPageChunks(document, page, outlineHeading, banned));
      }
      continue;
    }
    chunks.push(...chunksFromStructuredPage(document, page, structured, outlineHeading, banned));
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
  if (chunk.startOffset < 0 || chunk.endOffset > page.text.length || chunk.startOffset >= chunk.endOffset) {
    throw new Error(`chunk offsets out of range on page ${chunk.page}`);
  }
  if (page.text.slice(chunk.startOffset, chunk.endOffset) !== chunk.text) {
    throw new Error(`chunk text does not match page ${chunk.page} offsets`);
  }
}

/** Isolated-lines eligibility. Kept for tests; 4A.9.4 does not emit isolated fallbacks. */
export function isolatedLineEligible(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^\d{1,4}$/.test(trimmed)) return false;
  if (/^[\W_]+$/.test(trimmed)) return false;
  const words = trimmed.split(/\s+/).filter((word) => /[A-Za-z]{2,}/.test(word));
  if (words.length >= 4) return true;
  return words.length >= 3 && /[.!?]/.test(trimmed) && trimmed.length >= 16;
}

export function mappedBlockRange(
  page: NormalizedPage,
  block: DocumentBlock,
): { start: number; end: number } | null {
  if (block.page !== page.pageNumber) return null;
  if (block.normStart === undefined || block.normEnd === undefined) return null;
  if (block.normStart < 0 || block.normEnd > page.text.length || block.normStart >= block.normEnd) return null;
  const text = page.text.slice(block.normStart, block.normEnd);
  if (!text.trim()) return null;
  if (crossesColumnBreak(page, block.normStart, block.normEnd)) return null;
  return { start: block.normStart, end: block.normEnd };
}

function chunksFromStructuredPage(
  document: NormalizedDocument,
  page: NormalizedPage,
  structured: StructuredPage,
  outlineHeading: string | undefined,
  banned: Array<{ start: number; end: number }>,
): DocumentChunk[] {
  if (structured.diagnostics.gridKind === "table") {
    return structured.blocks.flatMap((block) => {
      if (block.kind !== "caption") return [];
      return emitMappedBlock(document, page, block, headingFor(page, structured, block, outlineHeading), banned);
    });
  }
  const listed = new Set(structured.blocks.filter((block) => block.parentBlockId).map((block) => block.id));
  const chunks: DocumentChunk[] = [];
  for (const block of structured.blocks) {
    if (block.kind === "furniture" || block.kind === "unknown" || block.kind === "math" || block.kind === "heading") {
      continue;
    }
    if (block.kind === "list-item" && listed.has(block.id)) continue;
    const heading = headingFor(page, structured, block, outlineHeading);
    if (block.kind === "list") {
      chunks.push(...emitList(document, page, structured, block, heading, banned));
      continue;
    }
    if (block.kind === "paragraph" || block.kind === "prose" || block.kind === "caption" || block.kind === "list-item") {
      if (block.kind === "caption" && !captionSearchable(page, block)) continue;
      if (block.kind === "list-item" && !itemSearchable(page, block)) continue;
      chunks.push(...emitMappedBlock(document, page, block, heading, banned));
    }
  }
  return chunks;
}

function emitList(
  document: NormalizedDocument,
  page: NormalizedPage,
  structured: StructuredPage,
  list: DocumentBlock,
  heading: string | undefined,
  banned: Array<{ start: number; end: number }>,
): DocumentChunk[] {
  const items = structured.blocks.filter((block) => block.parentBlockId === list.id && block.kind === "list-item");
  const parent = mappedBlockRange(page, list);
  if (parent) {
    if (parent.end - parent.start <= DOCUMENT_CHUNK_CAP) {
      return emitRange(document, page, parent.start, parent.end, heading, banned);
    }
    const groups = groupListItems(page, items);
    if (groups.length > 0) {
      return groups.flatMap((range) => emitRange(document, page, range.start, range.end, heading, banned));
    }
    return emitRange(document, page, parent.start, parent.end, heading, banned);
  }
  return items.flatMap((item) => {
    if (!itemSearchable(page, item)) return [];
    return emitMappedBlock(document, page, item, heading, banned);
  });
}

export function listChunkFate(
  page: NormalizedPage,
  list: DocumentBlock,
  items: DocumentBlock[],
): ListChunkFate {
  const parent = mappedBlockRange(page, list);
  if (parent) {
    return parent.end - parent.start <= DOCUMENT_CHUNK_CAP ? "parent-contiguous" : "member-groups";
  }
  if (items.some((item) => mappedBlockRange(page, item) && itemSearchable(page, item))) return "item-only";
  return "unsearchable";
}

function groupListItems(page: NormalizedPage, items: DocumentBlock[]): Array<{ start: number; end: number }> {
  const mapped = items
    .map((item) => mappedBlockRange(page, item))
    .filter((range): range is { start: number; end: number } => Boolean(range))
    .sort((a, b) => a.start - b.start);
  const groups: Array<{ start: number; end: number }> = [];
  let current: { start: number; end: number } | null = null;
  for (const range of mapped) {
    if (!current) {
      current = { ...range };
      continue;
    }
    if (range.end - current.start <= DOCUMENT_CHUNK_CAP && !crossesColumnBreak(page, current.start, range.end)) {
      current.end = range.end;
      continue;
    }
    groups.push(current);
    current = { ...range };
  }
  if (current) groups.push(current);
  return groups;
}

function emitMappedBlock(
  document: NormalizedDocument,
  page: NormalizedPage,
  block: DocumentBlock,
  heading: string | undefined,
  banned: Array<{ start: number; end: number }>,
): DocumentChunk[] {
  const range = mappedBlockRange(page, block);
  if (!range) return [];
  return emitRange(document, page, range.start, range.end, heading, banned);
}

function emitRange(
  document: NormalizedDocument,
  page: NormalizedPage,
  start: number,
  end: number,
  heading: string | undefined,
  banned: Array<{ start: number; end: number }>,
): DocumentChunk[] {
  return subtractRanges(start, end, banned).flatMap((range) => {
    if (crossesColumnBreak(page, range.start, range.end)) return [];
    if (isFurnitureOnlySlice(page.text.slice(range.start, range.end))) return [];
    if (!page.text.slice(range.start, range.end).trim()) return [];
    if (range.end - range.start <= DOCUMENT_CHUNK_CAP) {
      return [makeChunk(document, page, range.start, range.end, heading)];
    }
    return splitToCap(document, page, range.start, range.end, heading, banned);
  });
}

function captionSearchable(page: NormalizedPage, block: DocumentBlock): boolean {
  const range = mappedBlockRange(page, block);
  if (!range) return false;
  const text = page.text.slice(range.start, range.end).trim();
  const words = text.split(/\s+/).filter((word) => /[A-Za-z]{2,}/.test(word));
  return words.length >= 3 && text.length >= 16;
}

function itemSearchable(page: NormalizedPage, block: DocumentBlock): boolean {
  const range = mappedBlockRange(page, block);
  if (!range) return false;
  const text = page.text.slice(range.start, range.end).trim();
  const words = text.split(/\s+/).filter((word) => /[A-Za-z]{2,}/.test(word));
  return words.length >= 2 && text.length >= 8;
}

function headingFor(
  page: NormalizedPage,
  structured: StructuredPage,
  block: DocumentBlock,
  outlineHeading: string | undefined,
): string | undefined {
  const nearby = structured.blocks.find(
    (entry) =>
      entry.kind === "heading" &&
      entry.page === page.pageNumber &&
      entry.normEnd !== undefined &&
      block.normStart !== undefined &&
      entry.normEnd <= block.normStart &&
      block.normStart - entry.normEnd <= 80,
  );
  const fromBlock = nearby && nearby.normStart !== undefined && nearby.normEnd !== undefined
    ? page.text.slice(nearby.normStart, nearby.normEnd).trim()
    : "";
  return outlineHeading ?? (fromBlock || undefined);
}

function crossesColumnBreak(page: NormalizedPage, start: number, end: number): boolean {
  const br = page.columnBreakOffset;
  return page.readingOrder === "two-column" && br !== undefined && start < br && end > br;
}

function legacyFullPageChunks(
  document: NormalizedDocument,
  page: NormalizedPage,
  heading: string | undefined,
  banned: Array<{ start: number; end: number }>,
): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  for (const block of pageBlocks(page)) {
    chunks.push(...emitRange(document, page, block.start, block.end, heading, banned));
  }
  return chunks;
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
  banned: Array<{ start: number; end: number }> = [],
): DocumentChunk[] {
  if (end - start <= DOCUMENT_CHUNK_CAP) {
    if (isFurnitureOnlySlice(page.text.slice(start, end))) return [];
    return [makeChunk(document, page, start, end, heading)];
  }
  const ranges = splitSentences(page.text, start, end).flatMap((range) =>
    range.end - range.start <= DOCUMENT_CHUNK_CAP ? [range] : splitWhitespace(page.text, range.start, range.end),
  );
  return ranges.flatMap((range) => {
    if (isFurnitureOnlySlice(page.text.slice(range.start, range.end))) return [];
    if (overlapsBanned(range.start, range.end, banned)) return [];
    return [makeChunk(document, page, range.start, range.end, heading)];
  });
}

function asDocumentStructure(value: unknown): DocumentStructure | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as DocumentStructure;
  if (!Array.isArray(candidate.pages)) return undefined;
  return candidate;
}

function classifiedFurnitureTexts(structure: DocumentStructure): string[] {
  return (structure.furnitureCandidates ?? [])
    .filter((row) => {
      const ySpread = row.yValues.length ? Math.max(...row.yValues) - Math.min(...row.yValues) : 0;
      return isFurnitureCandidate({
        text: row.text,
        share: row.share,
        pages: row.pages,
        pageCount: row.pageCount,
        ySpread,
        hint: furnitureHint(row.text),
      });
    })
    .map((row) => row.text);
}

function furnitureBannedRanges(
  page: NormalizedPage,
  structured: StructuredPage | undefined,
  furnitureTexts: string[],
): Array<{ start: number; end: number }> {
  const banned: Array<{ start: number; end: number }> = [];
  if (structured) {
    for (const block of structured.blocks) {
      if (block.kind !== "furniture") continue;
      const mapped = mappedBlockRange(page, block);
      if (mapped) banned.push(mapped);
      const fromItems = mappedRangeForItems(page, block.itemIndexes);
      if (fromItems) banned.push({ start: fromItems.normStart, end: fromItems.normEnd });
    }
  }
  banned.push(...findFurnitureSpans(page.text, furnitureTexts));
  banned.push(...nistBannerSpans(page.text));
  return banned;
}

function findFurnitureSpans(pageText: string, furnitureTexts: string[]): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  for (const raw of furnitureTexts) {
    const words = normalizeFurnitureText(raw)
      .split(" ")
      .filter((word) => word.length > 0);
    if (words.length < 4) continue;
    const re = new RegExp(words.map(escapeRegExp).join("\\s+"), "ig");
    let match: RegExpExecArray | null;
    while ((match = re.exec(pageText))) {
      spans.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  return spans;
}

function nistBannerSpans(pageText: string): Array<{ start: number; end: number }> {
  const re = /this publication is available free of charge from:(?:\s*https?:\/\/\S+)?/gi;
  const spans: Array<{ start: number; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(pageText))) {
    spans.push({ start: match.index, end: match.index + match[0].length });
  }
  return spans;
}

function subtractRanges(
  start: number,
  end: number,
  banned: Array<{ start: number; end: number }>,
): Array<{ start: number; end: number }> {
  const cuts = banned
    .filter((range) => range.start < end && range.end > start)
    .map((range) => ({ start: Math.max(start, range.start), end: Math.min(end, range.end) }))
    .sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const cut of cuts) {
    const last = merged[merged.length - 1];
    if (!last || cut.start > last.end) merged.push({ ...cut });
    else last.end = Math.max(last.end, cut.end);
  }
  const parts: Array<{ start: number; end: number }> = [];
  let cursor = start;
  for (const cut of merged) {
    if (cut.start > cursor) parts.push({ start: cursor, end: cut.start });
    cursor = Math.max(cursor, cut.end);
  }
  if (cursor < end) parts.push({ start: cursor, end });
  return parts.filter((part) => part.end > part.start);
}

function overlapsBanned(start: number, end: number, banned: Array<{ start: number; end: number }>): boolean {
  return banned.some((range) => range.start < end && range.end > start);
}

function isFurnitureOnlySlice(text: string): boolean {
  if (!/this publication is available free of charge/i.test(text)) return false;
  const stripped = text
    .replace(/this publication is available free of charge from:(?:\s*https?:\/\/\S+)?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const words = stripped.split(/\s+/).filter((word) => /[A-Za-z]{3,}/.test(word));
  return words.length < 3;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
