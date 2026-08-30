/**
 * Phase 4A.9.3 derived DocumentBlocks.
 *
 * Observes the accepted 4A.9.2 NormalizedPage. Does not rewrite page.text,
 * segments, readingOrder, or index. Blocks are never citation provenance —
 * Cards still resolve Normalized range → MappedSegments → itemRanges.
 *
 * Trusted width is structural grouping only. Raw PdfTextItem geometry is
 * stored exactly and is what the viewer / evidence path read.
 *
 * trustedWidth = min(reportedWidth, max(glyphEstimate, 8), medianClusterWidth * 1.35)
 * glyphEstimate = str.length * max(height, 8) * 0.52
 * trustedRight = itemX + trustedWidth
 */
import { findDominantProseRegions } from "./pdf/prose-regions.ts";
import { itemX } from "./pdf/items.ts";
import type { MappedSegment, NormalizedPage, PdfTextItem } from "./types.ts";

export const LIST_MARKER =
  /^(?:[\u2022\u2023\u25E6\u2043•·▪◦‣●○■□–—*]\s+|\(\d+\)\s+|\d+[.)]\s+|\([a-z]\.?\)\s+|[a-z][.)]\s+)/i;
export const CAPTION_PREFIX = /^(?:figure|fig\.|table|tbl\.|algorithm)\s+\d/i;
export const SECTION_HEADING = /^(?:\d+(?:\.\d+){0,3})\s+[A-Za-z].{2,60}$/;

export const LEAF_BLOCK_KINDS = [
  "paragraph",
  "heading",
  "list-item",
  "caption",
  "math",
  "furniture",
  "prose",
  "unknown",
] as const;

export type DocumentBlockKind =
  | "paragraph"
  | "heading"
  | "list"
  | "list-item"
  | "caption"
  | "math"
  | "furniture"
  | "prose"
  | "unknown";

export type DocumentBlock = {
  id: string;
  kind: DocumentBlockKind;
  page: number;
  regionId?: string;
  lineIds: string[];
  itemIndexes: number[];
  /** Present when the block's items have MappedSegments on this page. */
  normStart?: number;
  normEnd?: number;
  parentBlockId?: string;
  confidence?: "high" | "medium" | "low";
};

export type BlockSourceLine = {
  id: string;
  itemIndexes: number[];
  normStart?: number;
  normEnd?: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  y: number;
  height: number;
  width: number;
  wordCount: number;
  features: {
    text: string;
    wordCount: number;
    alphaRatio: number;
    numericRatio: number;
    equationSymbolRatio: number;
    shortTokenRatio: number;
    bulletPrefix: boolean;
    lineWidth: number;
    proseScore: number;
  };
};

export type BlockRegion = {
  id: string;
  left: number;
  right: number;
};

export type FurnitureMatch = {
  text: string;
  share: number;
  pages: number;
  pageCount: number;
  ySpread: number;
  hint: boolean;
};

export type TrustedWidth = {
  itemIndex: number;
  reportedWidth: number;
  glyphEstimate: number;
  trustedWidth: number;
  trustedRight: number;
};

export function trustedItemMetrics(item: PdfTextItem, medianClusterWidth: number): TrustedWidth {
  const glyphEstimate = Math.max(item.str.length, 1) * Math.max(item.height, 8) * 0.52;
  const reportedWidth = item.width > 0 ? item.width : glyphEstimate;
  const cap = medianClusterWidth > 0 ? medianClusterWidth * 1.35 : reportedWidth;
  const trustedWidth = Math.min(reportedWidth, Math.max(glyphEstimate, 8), cap);
  return {
    itemIndex: item.itemIndex,
    reportedWidth,
    glyphEstimate,
    trustedWidth,
    trustedRight: itemX(item) + trustedWidth,
  };
}

export function structureBlockId(
  sourceId: string,
  page: number,
  kind: DocumentBlockKind,
  ordinal: number,
): string {
  return `${sourceId}:p${page}:block:${kind}:${ordinal}`;
}

export function normalizeFurnitureText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function furnitureHint(text: string): boolean {
  return /this publication is available free of charge|tlp[:\s-]*clear|nist sp |page \d+ of \d+/i.test(text);
}

/**
 * Repeating twice is not enough. Majority share is the default.
 * First/section/alternating pages can depress share; a pinned body-band
 * banner with a furniture hint and stable y on many pages still counts.
 */
export function isFurnitureCandidate(row: FurnitureMatch): boolean {
  if (row.pages < 3) return false;
  if (row.share >= 0.5) return true;
  if (row.hint && row.ySpread < 12 && row.pages >= 8) return true;
  return row.share >= 0.4 && row.hint && row.ySpread < 48;
}

export function reconstructPageBlocks(input: {
  sourceId: string;
  page: NormalizedPage;
  lines: BlockSourceLine[];
  regions: BlockRegion[];
  furnitureTexts: Set<string>;
  pageWidth: number;
  gridKind: "table" | "math" | "none";
}): DocumentBlock[] {
  const { sourceId, page, lines, regions, furnitureTexts, pageWidth, gridKind } = input;
  const widths = page.items
    .map((item) => (item.width > 0 ? item.width : 0))
    .filter((width) => width > 0)
    .sort((a, b) => a - b);
  const medianWidth = widths.length ? widths[Math.floor(widths.length / 2)] : 0;
  const regionOf = assignLineRegions(lines, page.items, regions, pageWidth);
  const ordinals: Record<string, number> = {};
  const nextId = (kind: DocumentBlockKind) => {
    const n = ordinals[kind] ?? 0;
    ordinals[kind] = n + 1;
    return structureBlockId(sourceId, page.pageNumber, kind, n);
  };
  const classified = new Map<string, DocumentBlockKind | "taken">();
  const blocks: DocumentBlock[] = [];

  const emit = (
    kind: DocumentBlockKind,
    group: BlockSourceLine[],
    extras?: { parentBlockId?: string; regionId?: string; confidence?: DocumentBlock["confidence"] },
  ): DocumentBlock | null => {
    if (group.length === 0) return null;
    const keys = [...new Set(group.map((line) => regionOf.get(line.id) ?? ""))];
    if (keys.length > 1) return null;
    if (group.some((line) => lineCrossesGutter(line, page.items, pageWidth))) {
      if (kind === "paragraph" || kind === "list" || kind === "list-item" || kind === "math") return null;
    }
    const itemIndexes = uniqueIndexes(group.flatMap((line) => line.itemIndexes));
    const range = mappedRangeForItems(page, itemIndexes);
    if (range && !rangeIsExclusive(page, itemIndexes, range)) return null;
    const regionId = extras?.regionId ?? (keys[0] && !keys[0].startsWith("unassigned:") ? keys[0] : undefined);
    const block: DocumentBlock = {
      id: nextId(kind),
      kind,
      page: page.pageNumber,
      lineIds: group.map((line) => line.id),
      itemIndexes,
      ...(range ?? {}),
      ...(regionId ? { regionId } : {}),
      ...(extras?.parentBlockId ? { parentBlockId: extras.parentBlockId } : {}),
      confidence: extras?.confidence ?? (range ? "high" : "medium"),
    };
    for (const line of group) classified.set(line.id, kind);
    blocks.push(block);
    return block;
  };

  for (const line of lines) {
    if (furnitureTexts.has(normalizeFurnitureText(line.features.text))) {
      emit("furniture", [line], { confidence: "high" });
    }
  }

  if (gridKind === "table") {
    for (const line of lines) {
      if (classified.has(line.id)) continue;
      if (isCaptionLine(line)) emit("caption", [line]);
      else emit("unknown", [line], { confidence: "low" });
    }
    return blocks;
  }

  const ctx = { page, pageWidth, gridKind, medianWidth, regionOf, emit, classified };
  for (const group of groupByRegion(lines.filter((line) => !classified.has(line.id)), regionOf)) {
    walkRegion(group, ctx);
  }
  for (const line of lines) {
    if (!classified.has(line.id)) emit("unknown", [line], { confidence: "low" });
  }
  return blocks;
}

function walkRegion(
  lines: BlockSourceLine[],
  ctx: {
    page: NormalizedPage;
    pageWidth: number;
    gridKind: "table" | "math" | "none";
    medianWidth: number;
    regionOf: Map<string, string | undefined>;
    emit: (
      kind: DocumentBlockKind,
      group: BlockSourceLine[],
      extras?: { parentBlockId?: string; regionId?: string; confidence?: DocumentBlock["confidence"] },
    ) => DocumentBlock | null;
    classified: Map<string, DocumentBlockKind | "taken">;
  },
) {
  const ordered = [...lines].sort((a, b) => b.y - a.y || a.left - b.left);
  for (let i = 0; i < ordered.length; i += 1) {
    const line = ordered[i];
    if (ctx.classified.has(line.id)) continue;
    if (isListMarkerLine(line)) takeList(ordered, i, ctx);
  }
  for (const line of ordered) {
    if (ctx.classified.has(line.id)) continue;
    if (isCaptionLine(line)) ctx.emit("caption", [line]);
  }
  for (let i = 0; i < ordered.length; i += 1) {
    const line = ordered[i];
    if (ctx.classified.has(line.id)) continue;
    if (!looksMath(line, ctx.gridKind)) continue;
    const run = takeRun(ordered, i, ctx, (current, next) => {
      return looksMath(next, ctx.gridKind) && canJoin(current, next, 1.8, ctx);
    });
    ctx.emit("math", run.group, { confidence: "medium" });
    i = run.next - 1;
  }
  for (const line of ordered) {
    if (ctx.classified.has(line.id)) continue;
    if (looksHeading(line, predecessor(ordered, line, ctx.classified), successor(ordered, line, ctx.classified))) {
      ctx.emit("heading", [line], { confidence: "medium" });
    }
  }
  for (let i = 0; i < ordered.length; i += 1) {
    const line = ordered[i];
    if (ctx.classified.has(line.id)) continue;
    if (line.wordCount < 2 && line.features.text.length < 24) continue;
    if (isBoundary(line, ctx.gridKind)) continue;
    const run = takeRun(ordered, i, ctx, (current, next) => {
      return canJoinParagraph(current, next, ctx) && !isBoundary(next, ctx.gridKind);
    });
    ctx.emit("paragraph", run.group);
    i = run.next - 1;
  }
}

function takeList(
  ordered: BlockSourceLine[],
  start: number,
  ctx: {
    page: NormalizedPage;
    emit: (
      kind: DocumentBlockKind,
      group: BlockSourceLine[],
      extras?: { parentBlockId?: string; regionId?: string; confidence?: DocumentBlock["confidence"] },
    ) => DocumentBlock | null;
    classified: Map<string, DocumentBlockKind | "taken">;
  },
): void {
  const members: BlockSourceLine[][] = [];
  let current: BlockSourceLine[] = [ordered[start]];
  let i = start + 1;
  const left = ordered[start].left;
  while (i < ordered.length) {
    const line = ordered[i];
    if (ctx.classified.has(line.id)) break;
    if (isCaptionLine(line) || looksHeading(line, ordered[i - 1], ordered[i + 1])) break;
    if (
      isListMarkerLine(line) &&
      Math.abs(line.left - left) <= 14 &&
      verticalGap(ordered[i - 1], line) <= line.height * 2.2
    ) {
      members.push(current);
      current = [line];
      i += 1;
      continue;
    }
    if (
      !isListMarkerLine(line) &&
      line.left >= left + 6 &&
      line.left <= left + 44 &&
      verticalGap(ordered[i - 1], line) <= line.height * 1.8
    ) {
      current.push(line);
      i += 1;
      continue;
    }
    break;
  }
  members.push(current);
  const heading = start > 0 ? ordered[start - 1] : undefined;
  const headingOk = Boolean(
    heading &&
      !ctx.classified.has(heading.id) &&
      looksListHeading(heading) &&
      verticalGap(heading, ordered[start]) <= heading.height * 1.8,
  );
  const allLines = [...(headingOk && heading ? [heading] : []), ...members.flat()];
  const parent = ctx.emit("list", allLines, { confidence: "high" });
  if (!parent) return;
  for (const item of members) {
    ctx.emit("list-item", item, { parentBlockId: parent.id, confidence: "high" });
  }
  if (headingOk && heading) ctx.classified.set(heading.id, "taken");
}

function takeRun(
  ordered: BlockSourceLine[],
  start: number,
  ctx: { classified: Map<string, DocumentBlockKind | "taken"> },
  join: (current: BlockSourceLine, next: BlockSourceLine) => boolean,
): { group: BlockSourceLine[]; next: number } {
  const group = [ordered[start]];
  let i = start + 1;
  while (i < ordered.length) {
    const next = ordered[i];
    if (ctx.classified.has(next.id)) break;
    if (!join(group[group.length - 1], next)) break;
    group.push(next);
    i += 1;
  }
  return { group, next: i };
}

function canJoinParagraph(
  current: BlockSourceLine,
  next: BlockSourceLine,
  ctx: { page: NormalizedPage; medianWidth: number; pageWidth: number },
): boolean {
  if (!canJoin(current, next, 1.65, ctx)) return false;
  if (isListMarkerLine(next) || isCaptionLine(next)) return false;
  const indent = Math.abs(next.left - current.left);
  const continuation = next.left > current.left && next.left - current.left <= 22;
  if (!(indent <= 10 || continuation)) return false;
  const items = uniqueIndexes([...current.itemIndexes, ...next.itemIndexes]);
  const range = mappedRangeForItems(ctx.page, items);
  if (range && !rangeIsExclusive(ctx.page, items, range)) return false;
  return true;
}

function canJoin(
  current: BlockSourceLine,
  next: BlockSourceLine,
  gapFactor: number,
  ctx: { medianWidth: number; pageWidth: number },
): boolean {
  if (oppositeSides(current, next, ctx.pageWidth)) return false;
  if (verticalGap(current, next) > Math.max(current.height, next.height) * gapFactor) return false;
  if (Math.abs(current.height - next.height) > Math.max(current.height, next.height) * 0.55) return false;
  void ctx.medianWidth;
  return true;
}

function oppositeSides(a: BlockSourceLine, b: BlockSourceLine, pageWidth: number): boolean {
  if (pageWidth <= 0) return false;
  const mid = pageWidth / 2;
  const aLeft = a.left < mid - 14;
  const bRight = b.left > mid + 14;
  const bLeft = b.left < mid - 14;
  const aRight = a.left > mid + 14;
  return (aLeft && bRight) || (aRight && bLeft);
}

function isBoundary(line: BlockSourceLine, gridKind: "table" | "math" | "none"): boolean {
  return isListMarkerLine(line) || isCaptionLine(line) || looksMath(line, gridKind);
}

function isListMarkerLine(line: BlockSourceLine): boolean {
  if (!LIST_MARKER.test(line.features.text) && !line.features.bulletPrefix) return false;
  const body = line.features.text.replace(LIST_MARKER, "").trim();
  return body.length >= 2;
}

function isCaptionLine(line: BlockSourceLine): boolean {
  if (!CAPTION_PREFIX.test(line.features.text)) return false;
  if (line.wordCount < 2 || line.features.text.length < 10) return false;
  if (line.wordCount <= 2 && line.features.text.length < 16) return false;
  return true;
}

function looksHeading(line: BlockSourceLine, prev?: BlockSourceLine, next?: BlockSourceLine): boolean {
  const text = line.features.text.trim();
  if (text.length < 4 || text.length > 88 || line.wordCount > 10) return false;
  if (isListMarkerLine(line) || isCaptionLine(line)) return false;
  if (SECTION_HEADING.test(text) && line.wordCount <= 8) return true;
  const taller = prev ? line.height >= prev.height * 1.25 : false;
  const gap = prev ? verticalGap(prev, line) > prev.height * 1.45 : false;
  const hasBodyAfter = next ? next.wordCount >= 3 : false;
  return taller && gap && hasBodyAfter && line.wordCount <= 8;
}

function looksListHeading(line: BlockSourceLine): boolean {
  const text = line.features.text.trim();
  return text.length >= 4 && text.length <= 80 && line.wordCount <= 10 && /:\s*$/.test(text);
}

function looksMath(line: BlockSourceLine, gridKind: "table" | "math" | "none"): boolean {
  if (gridKind === "table") return false;
  const f = line.features;
  if (f.wordCount >= 10 && f.proseScore >= 0.45) return false;
  if (f.equationSymbolRatio >= 0.12 && f.wordCount <= 8) return true;
  if (f.shortTokenRatio >= 0.55 && f.equationSymbolRatio >= 0.05 && f.wordCount <= 6) return true;
  return f.wordCount <= 2 && /[=∑∫√∞]/.test(f.text) && f.text.length < 48;
}

function assignLineRegions(
  lines: BlockSourceLine[],
  items: PdfTextItem[],
  regions: BlockRegion[],
  pageWidth: number,
): Map<string, string | undefined> {
  const out = new Map<string, string | undefined>();
  const analysis = findDominantProseRegions(items, pageWidth);
  const byIndex = new Map(items.map((item) => [item.itemIndex, item]));
  const mid = pageWidth / 2;
  const splitX =
    analysis.splitX ??
    (analysis.refuseSingleColumn || analysis.widthDistrust || analysis.twoIndependentRegions ? mid : null);
  const split = splitX !== null && splitX > 0;
  const leftRegion = pickRegion(regions, splitX ?? mid, "left");
  const rightRegion = pickRegion(regions, splitX ?? mid, "right");

  for (const line of lines) {
    if (lineCrossesGutter(line, items, pageWidth)) {
      out.set(line.id, undefined);
      continue;
    }
    if (!split) {
      out.set(line.id, regions.length === 1 ? regions[0]?.id : "page");
      continue;
    }
    const lineItems = line.itemIndexes
      .map((index) => byIndex.get(index))
      .filter((item): item is PdfTextItem => Boolean(item));
    const origins = lineItems.length ? lineItems.map((item) => itemX(item)) : [line.left];
    const leftOrigin = origins.filter((x) => x < splitX! - 6);
    const rightOrigin = origins.filter((x) => x > splitX! + 6);
    if (leftOrigin.length > 0 && rightOrigin.length > 0) {
      out.set(line.id, undefined);
      continue;
    }
    const side = (origins[0] ?? line.left) < splitX! ? "left" : "right";
    out.set(line.id, side === "left" ? leftRegion ?? "left" : rightRegion ?? "right");
  }
  return out;
}

function pickRegion(regions: BlockRegion[], splitX: number, side: "left" | "right"): string | undefined {
  const hits = regions.filter((region) => (side === "left" ? region.left < splitX : region.left >= splitX));
  return (side === "left" ? hits.sort((a, b) => a.left - b.left)[0] : hits.sort((a, b) => a.left - b.left)[0])?.id;
}

function lineCrossesGutter(line: BlockSourceLine, items: PdfTextItem[], pageWidth: number): boolean {
  if (pageWidth <= 0 || line.itemIndexes.length === 0) return false;
  const mid = pageWidth / 2;
  const byIndex = new Map(items.map((item) => [item.itemIndex, item]));
  const xs = line.itemIndexes
    .map((index) => byIndex.get(index))
    .filter((item): item is PdfTextItem => Boolean(item))
    .map(itemX);
  if (xs.length === 0) return false;
  return xs.some((x) => x < mid - 14) && xs.some((x) => x > mid + 14);
}

export function mappedRangeForItems(
  page: NormalizedPage,
  itemIndexes: number[],
): { normStart: number; normEnd: number } | null {
  const wanted = new Set(itemIndexes);
  const hits = page.segments.filter(
    (segment): segment is Extract<MappedSegment, { kind: "source" }> =>
      segment.kind === "source" && wanted.has(segment.itemIndex),
  );
  if (hits.length === 0) return null;
  return {
    normStart: Math.min(...hits.map((segment) => segment.normStart)),
    normEnd: Math.max(...hits.map((segment) => segment.normEnd)),
  };
}

export function rangeIsExclusive(
  page: NormalizedPage,
  itemIndexes: number[],
  range: { normStart: number; normEnd: number },
): boolean {
  const wanted = new Set(itemIndexes);
  for (const segment of page.segments) {
    if (segment.kind !== "source") continue;
    const overlaps = segment.normStart < range.normEnd && segment.normEnd > range.normStart;
    if (overlaps && !wanted.has(segment.itemIndex)) return false;
  }
  return true;
}

function uniqueIndexes(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function verticalGap(upper: BlockSourceLine, lower: BlockSourceLine): number {
  return upper.bottom - lower.top;
}

function predecessor(
  ordered: BlockSourceLine[],
  line: BlockSourceLine,
  classified: Map<string, DocumentBlockKind | "taken">,
): BlockSourceLine | undefined {
  const index = ordered.findIndex((entry) => entry.id === line.id);
  for (let i = index - 1; i >= 0; i -= 1) {
    if (!classified.has(ordered[i].id)) return ordered[i];
  }
  return ordered[index - 1];
}

function successor(
  ordered: BlockSourceLine[],
  line: BlockSourceLine,
  classified: Map<string, DocumentBlockKind | "taken">,
): BlockSourceLine | undefined {
  const index = ordered.findIndex((entry) => entry.id === line.id);
  for (let i = index + 1; i < ordered.length; i += 1) {
    if (!classified.has(ordered[i].id)) return ordered[i];
  }
  return ordered[index + 1];
}

function groupByRegion(lines: BlockSourceLine[], regionOf: Map<string, string | undefined>): BlockSourceLine[][] {
  const groups = new Map<string, BlockSourceLine[]>();
  for (const line of lines) {
    const assigned = regionOf.get(line.id);
    const key = assigned ?? `unassigned:${line.id}`;
    const list = groups.get(key) ?? [];
    list.push(line);
    groups.set(key, list);
  }
  return [...groups.values()];
}

/** Hypothetical 4A.9.4 units. Not stored. Furniture and unknown contribute 0. */
export function projectChunkUnits(blocks: DocumentBlock[], cap = 1200): number {
  const lists = blocks.filter((block) => block.kind === "list");
  const listed = new Set(blocks.filter((block) => block.parentBlockId).map((block) => block.id));
  let n = 0;
  for (const list of lists) {
    if (list.normStart === undefined || list.normEnd === undefined) continue;
    const size = list.normEnd - list.normStart;
    if (size <= 0) continue;
    n += size > cap ? Math.max(1, Math.ceil(size / cap)) : 1;
  }
  for (const block of blocks) {
    if (block.kind === "list" || listed.has(block.id)) continue;
    if (block.kind === "furniture" || block.kind === "unknown" || block.kind === "heading") continue;
    if (block.kind === "math" && ((block.normEnd ?? 0) - (block.normStart ?? 0) < 24)) continue;
    if (block.normStart === undefined || block.normEnd === undefined) continue;
    const size = block.normEnd - block.normStart;
    if (size <= 0) continue;
    n += size > cap ? Math.max(1, Math.ceil(size / cap)) : 1;
  }
  return n;
}
