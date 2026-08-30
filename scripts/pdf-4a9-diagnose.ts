/**
 * Phase 4A.9 structural diagnostics. Read-only against production parser code.
 * Writes only under .eval/phase4a/4a9/. Does not modify parser, layout, or admission.
 *
 * node --experimental-strip-types scripts/pdf-4a9-diagnose.ts
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

import { buildDocumentChunks, DOCUMENT_CHUNK_CAP } from "../src/lib/document/chunk.ts";
import { detectRepeatedBands, lineBand, bandKey } from "../src/lib/document/pdf/headers.ts";
import { extractPdfItems, itemRight, itemX, itemY, usefulItemCount } from "../src/lib/document/pdf/items.ts";
import {
  detectReadingOrder,
  groupVisualLines,
  isDenseGrid,
  isParagraphBreak,
  leftEdgeClusters,
  lineIsUsable,
  type LeftEdgeCluster,
  type VisualLine,
  visualLineText,
} from "../src/lib/document/pdf/layout.ts";
import { mappingErrors } from "../src/lib/document/pdf/map.ts";
import { normalizePage } from "../src/lib/document/pdf/normalize.ts";
import { parsePdf } from "../src/lib/document/pdf/parse.ts";
import { openPdfDocument } from "../src/lib/document/pdf/pdfjs.ts";
import type { NormalizedPage, PdfTextItem } from "../src/lib/document/types.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const CORPUS = `${ROOT}.eval/phase4a/release/corpus`;
const OUT = `${ROOT}.eval/phase4a/4a9`;

const TWO_COL_MIN_LINES = 2;
const TWO_COL_GUTTER = 28;
const TWO_COL_EDGE_BUCKET = 36;
const TWO_COL_MIN_CLUSTER_ITEMS = 2;
const TWO_COL_MIN_SEP_RATIO = 0.18;

const DUMP_PAGES: Record<string, number[]> = {
  "attention.pdf": [1, 2, 6],
  "bert.pdf": [1, 2, 8],
  "resnet.pdf": [1, 2, 5],
  "cs229-notes.pdf": [1, 2, 3, 10, 28],
  "tracemonkey.pdf": [1, 2],
  "nist-800-145.pdf": [1, 2, 3],
  "nist-800-207.pdf": [1, 8, 20],
  "nist-800-63b.pdf": [1, 10, 40],
};

const LIST_RE = /^(?:[\u2022\u2023\u25E6\u2043•·▪◦‣●○■□–—-]\s+|\(\d+\)\s+|\d+[.)]\s+|[a-z][.)]\s+)/i;
const CAPTION_RE = /^(?:figure|fig\.|table|tbl\.)\s*\d/i;
const FURNITURE_HINT =
  /this publication is available free of charge|tlp[:\s-]*clear|nist sp |official business|page \d+ of \d+/i;

function blobFrom(bytes: Uint8Array): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: "application/pdf" });
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function lineSpan(lines: VisualLine[]): number {
  if (lines.length === 0) return 0;
  return lines[0].y - lines[lines.length - 1].y;
}

function columnHasProse(lines: VisualLine[]): boolean {
  return lines.some((line) => visualLineText(line).split(/\s+/).filter(Boolean).length >= 4);
}

function twoColumnPairExplain(
  clusters: LeftEdgeCluster[],
  pageWidth: number,
): { pair: { left: LeftEdgeCluster; right: LeftEdgeCluster } | null; reasons: string[] } {
  const substantial = clusters.filter((cluster) => cluster.items.length >= TWO_COL_MIN_CLUSTER_ITEMS);
  const reasons: string[] = [];
  if (substantial.length !== 2) {
    reasons.push(
      `substantial left-edge clusters ${substantial.length} !== 2 (total clusters ${clusters.length}; sizes ${clusters
        .map((c) => `${c.x.toFixed(1)}:${c.items.length}`)
        .join(", ")})`,
    );
    return { pair: null, reasons };
  }
  const [first, second] = [...substantial].sort((a, b) => a.x - b.x);
  const sep = second.x - first.x;
  const minSep = Math.max(TWO_COL_GUTTER * 2, pageWidth * TWO_COL_MIN_SEP_RATIO);
  if (sep < minSep) {
    reasons.push(`cluster separation ${sep.toFixed(1)} < min ${minSep.toFixed(1)}`);
    return { pair: null, reasons };
  }
  if (first.x > pageWidth * 0.45) reasons.push(`left cluster x ${first.x.toFixed(1)} > 45% width`);
  if (second.x < pageWidth * 0.45) reasons.push(`right cluster x ${second.x.toFixed(1)} < 45% width`);
  if (reasons.length) return { pair: null, reasons };
  return { pair: { left: first, right: second }, reasons: [] };
}

function confidentTwoColumnExplain(
  left: VisualLine[],
  right: VisualLine[],
  pair: { left: LeftEdgeCluster; right: LeftEdgeCluster },
  pageWidth: number,
): string[] {
  const reasons: string[] = [];
  if (left.length < TWO_COL_MIN_LINES) reasons.push(`left visual lines ${left.length} < ${TWO_COL_MIN_LINES}`);
  if (right.length < TWO_COL_MIN_LINES) reasons.push(`right visual lines ${right.length} < ${TWO_COL_MIN_LINES}`);
  if (!columnHasProse(left)) reasons.push("left column has no 4-word prose line");
  if (!columnHasProse(right)) reasons.push("right column has no 4-word prose line");
  const leftSpan = lineSpan(left);
  const rightSpan = lineSpan(right);
  if (leftSpan < 12) reasons.push(`left y-span ${leftSpan.toFixed(1)} < 12`);
  if (rightSpan < 12) reasons.push(`right y-span ${rightSpan.toFixed(1)} < 12`);
  if (left.length && right.length) {
    const overlap =
      Math.min(left[0].y, right[0].y) - Math.max(left[left.length - 1].y, right[right.length - 1].y);
    if (overlap <= 0) reasons.push(`column y-span overlap ${overlap.toFixed(1)} <= 0`);
    else if (overlap < 0.3 * Math.min(leftSpan, rightSpan)) {
      reasons.push(
        `column y-span overlap ${overlap.toFixed(1)} < 30% of min span ${Math.min(leftSpan, rightSpan).toFixed(1)}`,
      );
    }
    const leftEdges = left.flatMap((line) => line.items.map(itemX));
    const rightEdges = right.flatMap((line) => line.items.map(itemX));
    const gutter = Math.min(...rightEdges) - Math.max(...leftEdges);
    if (gutter < TWO_COL_GUTTER) reasons.push(`item-x gutter ${gutter.toFixed(1)} < ${TWO_COL_GUTTER}`);
  }
  if (pair.right.x - pair.left.x < pageWidth * TWO_COL_MIN_SEP_RATIO) {
    reasons.push(`pair sep ${(pair.right.x - pair.left.x).toFixed(1)} < 18% page width`);
  }
  return reasons;
}

function explainPage(items: PdfTextItem[], pageWidth: number, pageHeight: number, skipBands: Set<string>) {
  const useful = usefulItemCount(items);
  const lines = groupVisualLines(items);
  const clusters = leftEdgeClusters(items);
  const grid = isDenseGrid(items);
  const pairInfo = twoColumnPairExplain(clusters, pageWidth);
  const layout = detectReadingOrder(items, pageWidth);
  const mid = pageWidth / 2;
  const fallbackLeft = groupVisualLines(items.filter((item) => itemRight(item) < mid - TWO_COL_GUTTER / 2));
  const fallbackRight = groupVisualLines(items.filter((item) => itemX(item) > mid + TWO_COL_GUTTER / 2));
  const starts = lines.map((line) => itemX(line.items[0]));
  const spread = starts.length ? Math.max(...starts) - Math.min(...starts) : 0;

  const whyNotTwoColumn: string[] = [];
  if (grid) whyNotTwoColumn.push("dense-grid detector fired first");
  whyNotTwoColumn.push(...pairInfo.reasons);
  if (pairInfo.pair) {
    const splitX = (pairInfo.pair.left.x + pairInfo.pair.right.x) / 2;
    const left = groupVisualLines(items.filter((item) => itemX(item) < splitX));
    const right = groupVisualLines(items.filter((item) => itemX(item) >= splitX));
    whyNotTwoColumn.push(...confidentTwoColumnExplain(left, right, pairInfo.pair, pageWidth));
  }
  if (layout.readingOrder === "uncertain" && !grid && !pairInfo.pair) {
    if (fallbackLeft.length >= 2 && fallbackRight.length >= 2 && spread > pageWidth * 0.35) {
      whyNotTwoColumn.push(
        `fallback: left/right of mid both have ≥2 lines and start-x spread ${spread.toFixed(1)} > 35% width → uncertain (not two-column)`,
      );
    }
  }

  const normalized = normalizePage({ pageNumber: 0, items, pageWidth, pageHeight, skipBands });
  const usableIsolated = lines.filter((line) => {
    const key = bandKey(line, pageHeight);
    if (key && skipBands.has(key)) return false;
    return lineIsUsable(visualLineText(line));
  });

  let earliestSkip: string | null = null;
  if (normalized.index === "skipped") {
    if (useful === 0) earliestSkip = "no-useful-items";
    else if (grid) earliestSkip = "dense-grid";
    else if (layout.readingOrder === "uncertain" && usableIsolated.length === 0) {
      earliestSkip = "uncertain-no-usable-isolated-lines";
    } else if (layout.readingOrder === "single-column" && !normalized.text.trim()) {
      earliestSkip = "single-column-empty-after-join";
    } else {
      earliestSkip = "other-empty-page";
    }
  }

  const xs = items.filter((item) => item.str.trim()).map(itemX);
  const dominantX = histogram(xs, TWO_COL_EDGE_BUCKET)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  return {
    useful,
    grid,
    clusters: clusters.map((cluster) => ({
      x: Number(cluster.x.toFixed(2)),
      items: cluster.items.length,
      meanWidth: Number(mean(cluster.items.map((item) => item.width || 0)).toFixed(2)),
      yMin: Number(Math.min(...cluster.items.map(itemY)).toFixed(2)),
      yMax: Number(Math.max(...cluster.items.map(itemY)).toFixed(2)),
    })),
    clusterCount: clusters.length,
    substantialClusterCount: clusters.filter((c) => c.items.length >= TWO_COL_MIN_CLUSTER_ITEMS).length,
    dominantX,
    visualLineCount: lines.length,
    layoutReadingOrder: layout.readingOrder,
    whyNotTwoColumn: whyNotTwoColumn.filter(Boolean),
    fallbackLeftLines: fallbackLeft.length,
    fallbackRightLines: fallbackRight.length,
    startXSpread: Number(spread.toFixed(2)),
    usableIsolatedLines: usableIsolated.length,
    earliestSkip,
    readingOrder: normalized.readingOrder,
    index: normalized.index,
    textChars: normalized.text.length,
    newlineBlocks: normalized.text ? normalized.text.split("\n").filter((part) => part.trim()).length : 0,
    mappingErrors: mappingErrors(normalized),
    pageWidth,
    pageHeight,
  };
}

function histogram(values: number[], bucket: number): Array<{ x: number; count: number }> {
  const map = new Map<number, number>();
  for (const value of values) {
    const key = Math.round(value / bucket) * bucket;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()].map(([x, count]) => ({ x, count }));
}

function dominantProseRegions(items: PdfTextItem[], pageWidth: number) {
  const prose = items.filter((item) => {
    const words = item.str.trim().split(/\s+/).filter((word) => /[A-Za-z]{3,}/.test(word));
    return words.length >= 2 || item.str.trim().length >= 24;
  });
  const clusters = leftEdgeClusters(prose).filter((cluster) => cluster.items.length >= 4);
  const ranked = [...clusters].sort((a, b) => b.items.length - a.items.length);
  const top = ranked.slice(0, 3);
  const pair =
    top.length >= 2 &&
    Math.abs(top[0].x - top[1].x) >= Math.max(TWO_COL_GUTTER * 2, pageWidth * TWO_COL_MIN_SEP_RATIO)
      ? [...top.slice(0, 2)].sort((a, b) => a.x - b.x)
      : null;
  let overlap = 0;
  if (pair) {
    const leftY = pair[0].items.map(itemY);
    const rightY = pair[1].items.map(itemY);
    overlap = Math.min(Math.max(...leftY), Math.max(...rightY)) - Math.max(Math.min(...leftY), Math.min(...rightY));
  }
  return {
    proseItemCount: prose.length,
    clusters: ranked.map((cluster) => ({
      x: Number(cluster.x.toFixed(2)),
      items: cluster.items.length,
      share: Number((cluster.items.length / Math.max(prose.length, 1)).toFixed(3)),
    })),
    twoDominant: Boolean(pair && overlap > 12 && top[0].items.length >= 8 && top[1].items.length >= 8),
    overlap: Number(overlap.toFixed(2)),
    topShare: top.slice(0, 2).reduce((sum, cluster) => sum + cluster.items.length, 0) / Math.max(prose.length, 1),
  };
}

function classifyChunkOrigin(page: NormalizedPage, text: string, start: number, end: number): string {
  const trimmed = text.trim();
  if (CAPTION_RE.test(trimmed)) return "caption";
  if (LIST_RE.test(trimmed)) return "list-line";
  if (FURNITURE_HINT.test(trimmed) && trimmed.length < 180) return "header/footer leakage";
  if (page.index === "isolated-lines") return "isolated line";
  const blockLen = end - start;
  if (page.readingOrder === "two-column" && page.columnBreakOffset !== undefined) {
    const br = page.columnBreakOffset;
    if ((start === 0 && end <= br) || (start >= br + 1 && end === page.text.length)) {
      if (blockLen <= DOCUMENT_CHUNK_CAP) return "full-page block";
    }
  }
  if (start === 0 && end === page.text.length && blockLen <= DOCUMENT_CHUNK_CAP) return "full-page block";
  if (blockLen <= DOCUMENT_CHUNK_CAP) {
    if (trimmed.split(/\s+/).length <= 14 && !/[.!?]/.test(trimmed)) return "paragraph split";
    return "paragraph split";
  }
  return "sentence split";
}

function projectBlocks(items: PdfTextItem[], pageWidth: number, pageHeight: number, skipBands: Set<string>) {
  const lines = groupVisualLines(items).filter((line) => {
    const key = bandKey(line, pageHeight);
    return !key || !skipBands.has(key);
  });
  const regions = dominantProseRegions(items, pageWidth);
  const splitX =
    regions.twoDominant && regions.clusters.length >= 2
      ? (regions.clusters[0].x + regions.clusters[1].x) / 2
      : null;
  const assign = (line: VisualLine) => {
    if (splitX == null) return 0;
    const x = itemX(line.items[0]);
    return x < splitX ? 0 : 1;
  };
  const blocks: Array<{ kind: string; lines: number; chars: number }> = [];
  let current: VisualLine[] = [];
  let currentCol: number | null = null;
  let currentKind = "paragraph";

  const flush = () => {
    if (!current.length) return;
    const text = current.map(visualLineText).join(" ");
    blocks.push({ kind: currentKind, lines: current.length, chars: text.length });
    current = [];
    currentKind = "paragraph";
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const text = visualLineText(line);
    if (!text) continue;
    const col = assign(line);
    const kind = CAPTION_RE.test(text) ? "caption" : LIST_RE.test(text) ? "list" : "paragraph";
    const prev = current[current.length - 1];
    const breakCol = currentCol !== null && col !== currentCol;
    const breakGap = prev ? isParagraphBreak(prev, line) : false;
    const breakKind = kind !== "paragraph" && currentKind !== kind;
    if (!current.length) {
      current = [line];
      currentCol = col;
      currentKind = kind;
      continue;
    }
    if (breakCol || breakGap || breakKind || kind === "caption") {
      flush();
      current = [line];
      currentCol = col;
      currentKind = kind;
      continue;
    }
    current.push(line);
  }
  flush();

  const chunks = blocks.flatMap((block) => {
    if (block.chars <= DOCUMENT_CHUNK_CAP) return [block];
    return Array.from({ length: Math.ceil(block.chars / DOCUMENT_CHUNK_CAP) }, () => block);
  });
  return { blocks, projectedChunks: chunks.length, twoDominant: regions.twoDominant };
}

function furnitureCandidates(pages: Array<{ height: number; lines: VisualLine[] }>) {
  const counts = new Map<string, { count: number; sample: string; band: string }>();
  for (const page of pages) {
    const seen = new Set<string>();
    for (const line of page.lines) {
      const band = lineBand(line, page.height);
      if (band === "body") continue;
      const text = visualLineText(line);
      if (!text) continue;
      const key = `${band}:${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const prev = counts.get(key);
      counts.set(key, { count: (prev?.count ?? 0) + 1, sample: text, band });
    }
  }
  const threshold = pages.length * 0.5;
  const rows = [...counts.entries()].map(([key, value]) => ({
    key,
    ...value,
    share: value.count / pages.length,
    detected: value.count >= threshold && value.count >= 2,
  }));
  const detected = rows.filter((row) => row.detected);
  const nearMiss = rows.filter(
    (row) => !row.detected && row.count >= 2 && (row.share >= 0.25 || FURNITURE_HINT.test(row.sample)),
  );
  return {
    detected: detected.sort((a, b) => b.count - a.count),
    nearMiss: nearMiss.sort((a, b) => b.count - a.count).slice(0, 20),
  };
}

function brokenItems(items: PdfTextItem[], pageWidth: number) {
  const findings: Array<{ itemIndex: number; str: string; reason: string; width: number; x: number }> = [];
  for (const item of items) {
    const str = item.str;
    if (!str.trim()) continue;
    const right = itemRight(item);
    if (right > pageWidth + 8 && str.length > 8) {
      findings.push({ itemIndex: item.itemIndex, str, reason: "width overflows page", width: item.width, x: itemX(item) });
    }
    if (/^[A-Za-z]{1,4}$/.test(str.trim()) && item.width > 40) {
      findings.push({ itemIndex: item.itemIndex, str, reason: "short token with wide box (possible clip)", width: item.width, x: itemX(item) });
    }
    if (/\bextra ch\b/i.test(str)) {
      findings.push({ itemIndex: item.itemIndex, str, reason: "known clipped fragment extra ch", width: item.width, x: itemX(item) });
    }
  }
  return findings.slice(0, 40);
}

async function extractPages(bytes: Uint8Array) {
  const doc = await openPdfDocument(bytes);
  const pages: Array<{ pageNumber: number; items: PdfTextItem[]; width: number; height: number }> = [];
  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      pages.push({
        pageNumber,
        items: extractPdfItems(content.items),
        width: viewport.width,
        height: viewport.height,
      });
    }
  } finally {
    try {
      await doc.cleanup();
    } catch {
      // ignore
    }
  }
  return pages;
}

mkdirSync(`${OUT}/documents`, { recursive: true });
mkdirSync(`${OUT}/pages`, { recursive: true });

const files = readdirSync(CORPUS)
  .filter((name) => name.endsWith(".pdf"))
  .sort();

const documents = [];
const pageClassTotals = {
  singleColumn: 0,
  twoColumn: 0,
  uncertain: 0,
  full: 0,
  isolated: 0,
  skipped: 0,
  readyDocs: 0,
  refusedDocs: 0,
  scannedDocs: 0,
  unreadableDocs: 0,
};
const skipReasons = new Map<string, number>();
const twoColFailures: unknown[] = [];
const cs229Skips: unknown[] = [];
const chunkOrigins = new Map<string, number>();
const headerFindings: unknown[] = [];
const tableFindings: unknown[] = [];
const listFindings: unknown[] = [];
const captionFindings: unknown[] = [];
const brokenFindings: unknown[] = [];
const projections: unknown[] = [];
let totalChunks = 0;
let projectedTotal = 0;

for (const file of files) {
  const bytes = new Uint8Array(readFileSync(`${CORPUS}/${file}`));
  const parsed = await parsePdf({
    contextId: "4a9",
    sourceId: file,
    path: file,
    contentHash: file,
    blob: blobFrom(bytes),
  });

  if (parsed.readiness === "refused") pageClassTotals.refusedDocs += 1;
  else if (parsed.readiness === "scanned") pageClassTotals.scannedDocs += 1;
  else if (parsed.readiness === "unreadable") pageClassTotals.unreadableDocs += 1;
  else pageClassTotals.readyDocs += 1;

  if (parsed.readiness !== "ready") {
    const row = {
      sourceId: file,
      filename: file,
      byteSize: bytes.byteLength,
      pageCount: parsed.pageCount,
      extractedCharacterCount: parsed.extractedChars,
      readiness: parsed.readiness,
      readinessNote: parsed.readinessNote,
      totalChunks: 0,
      pages: [],
    };
    documents.push(row);
    writeFileSync(`${OUT}/documents/${basename(file, ".pdf")}.json`, `${JSON.stringify(row, null, 2)}\n`);
    continue;
  }

  const extracted = await extractPages(bytes);
  const skipBands = detectRepeatedBands(
    extracted.map((page) => ({ height: page.height, lines: groupVisualLines(page.items) })),
  );
  const furniture = furnitureCandidates(extracted.map((page) => ({ height: page.height, lines: groupVisualLines(page.items) })));
  const chunks = buildDocumentChunks(parsed.document);
  const chunksByPage = new Map<number, typeof chunks>();
  for (const chunk of chunks) {
    const list = chunksByPage.get(chunk.page) ?? [];
    list.push(chunk);
    chunksByPage.set(chunk.page, list);
  }

  const pageRows = [];
  let maxChunks = 0;
  let isolatedPages = 0;
  let listLines = 0;
  let captionLines = 0;
  let broken = 0;
  let projected = 0;
  let gridPages = 0;
  let twoDominantPages = 0;

  for (const raw of extracted) {
    const explained = explainPage(raw.items, raw.width, raw.height, skipBands);
    const regions = dominantProseRegions(raw.items, raw.width);
    if (regions.twoDominant) twoDominantPages += 1;
    if (explained.grid) gridPages += 1;
    pageClassTotals[explained.readingOrder === "single-column" ? "singleColumn" : explained.readingOrder === "two-column" ? "twoColumn" : "uncertain"] += 1;
    pageClassTotals[explained.index === "full" ? "full" : explained.index === "isolated-lines" ? "isolated" : "skipped"] += 1;
    if (explained.earliestSkip) skipReasons.set(explained.earliestSkip, (skipReasons.get(explained.earliestSkip) ?? 0) + 1);
    if (explained.index === "isolated-lines") isolatedPages += 1;

    const pageChunks = chunksByPage.get(raw.pageNumber) ?? [];
    maxChunks = Math.max(maxChunks, pageChunks.length);
    const pageNorm = parsed.document.pages.find((page) => page.pageNumber === raw.pageNumber);
    for (const chunk of pageChunks) {
      const origin = pageNorm ? classifyChunkOrigin(pageNorm, chunk.text, chunk.startOffset, chunk.endOffset) : "other";
      chunkOrigins.set(origin, (chunkOrigins.get(origin) ?? 0) + 1);
    }

    const projection = projectBlocks(raw.items, raw.width, raw.height, skipBands);
    projected += projection.projectedChunks;

    const lines = groupVisualLines(raw.items);
    for (const line of lines) {
      const text = visualLineText(line);
      if (LIST_RE.test(text)) listLines += 1;
      if (CAPTION_RE.test(text)) captionLines += 1;
    }
    const brokenOnPage = brokenItems(raw.items, raw.width);
    broken += brokenOnPage.length;

    if (file === "cs229-notes.pdf" && explained.index === "skipped") {
      cs229Skips.push({
        page: raw.pageNumber,
        usefulItems: explained.useful,
        itemCount: raw.items.length,
        visualLines: explained.visualLineCount,
        grid: explained.grid,
        clusterCount: explained.clusterCount,
        substantialClusterCount: explained.substantialClusterCount,
        clusters: explained.clusters,
        startXSpread: explained.startXSpread,
        usableIsolatedLines: explained.usableIsolatedLines,
        layoutReadingOrder: explained.layoutReadingOrder,
        earliestSkip: explained.earliestSkip,
        whyNotTwoColumn: explained.whyNotTwoColumn,
        pageWidth: raw.width,
        pageHeight: raw.height,
      });
    }

    pageRows.push({
      page: raw.pageNumber,
      itemCount: raw.items.length,
      visualLineCount: explained.visualLineCount,
      usefulItemCount: explained.useful,
      readingOrder: explained.readingOrder,
      index: explained.index,
      layoutReadingOrder: explained.layoutReadingOrder,
      pageWidth: raw.width,
      pageHeight: raw.height,
      clusterCount: explained.clusterCount,
      substantialClusterCount: explained.substantialClusterCount,
      clusters: explained.clusters,
      dominantX: explained.dominantX,
      newlineBlocks: explained.newlineBlocks,
      chunkCount: pageChunks.length,
      averageItemWidth: Number(mean(raw.items.map((item) => item.width || 0) || [0]).toFixed(2)),
      twoDominantProse: regions.twoDominant,
      proseClusters: regions.clusters.slice(0, 4),
      earliestSkip: explained.earliestSkip,
      whyNotTwoColumn: explained.whyNotTwoColumn,
      mappingErrors: explained.mappingErrors,
      classifiedAs: explained.readingOrder,
      isolatedLines: explained.index === "isolated-lines",
      skipped: explained.index === "skipped",
    });

    const dumpFor = DUMP_PAGES[file];
    if (dumpFor?.includes(raw.pageNumber)) {
      const lineOfItem = new Map<number, number>();
      lines.forEach((line, lineId) => {
        for (const item of line.items) lineOfItem.set(item.itemIndex, lineId);
      });
      const splitX =
        regions.twoDominant && regions.clusters.length >= 2
          ? (regions.clusters[0].x + regions.clusters[1].x) / 2
          : null;
      writeFileSync(
        `${OUT}/pages/${basename(file, ".pdf")}-p${raw.pageNumber}.json`,
        `${JSON.stringify(
          {
            file,
            page: raw.pageNumber,
            pageWidth: raw.width,
            pageHeight: raw.height,
            current: {
              readingOrder: explained.readingOrder,
              index: explained.index,
              earliestSkip: explained.earliestSkip,
              whyNotTwoColumn: explained.whyNotTwoColumn,
              clusterCount: explained.clusterCount,
              substantialClusterCount: explained.substantialClusterCount,
              clusters: explained.clusters,
            },
            leftEdgeClusters: explained.clusters,
            dominantProse: regions,
            ySpanOverlap: regions.overlap,
            gutterCandidates: explained.clusters.length >= 2
              ? explained.clusters.slice(0, -1).map((cluster, i) => ({
                  between: [cluster.x, explained.clusters[i + 1].x],
                  gap: explained.clusters[i + 1].x - cluster.x,
                }))
              : [],
            items: raw.items.map((item) => ({
              itemIndex: item.itemIndex,
              str: item.str,
              x: Number(itemX(item).toFixed(2)),
              y: Number(itemY(item).toFixed(2)),
              width: Number(item.width.toFixed(2)),
              height: Number(item.height.toFixed(2)),
              right: Number(itemRight(item).toFixed(2)),
              visualLineId: lineOfItem.get(item.itemIndex) ?? null,
              inferredColumn: splitX == null ? null : itemX(item) < splitX ? 0 : 1,
            })),
            visualLines: lines.map((line, lineId) => ({
              lineId,
              y: Number(line.y.toFixed(2)),
              height: Number(line.height.toFixed(2)),
              text: visualLineText(line),
              itemIndexes: line.items.map((item) => item.itemIndex),
              firstX: Number(itemX(line.items[0]).toFixed(2)),
            })),
          },
          null,
          2,
        )}\n`,
      );
    }
  }

  if (["attention.pdf", "bert.pdf", "resnet.pdf"].includes(file)) {
    twoColFailures.push({
      file,
      pages: pageRows.map((page) => ({
        page: page.page,
        readingOrder: page.readingOrder,
        index: page.index,
        substantialClusterCount: page.substantialClusterCount,
        clusterCount: page.clusterCount,
        clusters: page.clusters,
        twoDominantProse: page.twoDominantProse,
        whyNotTwoColumn: page.whyNotTwoColumn,
      })),
    });
  }

  const indexedPages = pageRows.filter((page) => page.index !== "skipped").length;
  const row = {
    sourceId: file,
    filename: file,
    byteSize: bytes.byteLength,
    pageCount: extracted.length,
    extractedCharacterCount: parsed.extractedChars,
    readiness: parsed.readiness,
    pageReadiness: pageRows.map((page) => ({ page: page.page, index: page.index, readingOrder: page.readingOrder })),
    totals: {
      singleColumn: pageRows.filter((p) => p.readingOrder === "single-column").length,
      twoColumn: pageRows.filter((p) => p.readingOrder === "two-column").length,
      uncertain: pageRows.filter((p) => p.readingOrder === "uncertain").length,
      full: pageRows.filter((p) => p.index === "full").length,
      isolated: isolatedPages,
      skipped: pageRows.filter((p) => p.index === "skipped").length,
      denseGrid: gridPages,
      twoDominantProsePages: twoDominantPages,
    },
    itemCountPerPage: pageRows.map((p) => p.itemCount),
    visualLineCountPerPage: pageRows.map((p) => p.visualLineCount),
    newlineBlocksPerPage: pageRows.map((p) => p.newlineBlocks),
    chunkCountPerPage: pageRows.map((p) => p.chunkCount),
    totalChunks: chunks.length,
    averageChunksPerPage: extracted.length ? chunks.length / extracted.length : 0,
    averageChunksPerIndexedPage: indexedPages ? chunks.length / indexedPages : 0,
    maxChunksPerPage: maxChunks,
    exceeds200: chunks.length > 200,
    headerFooterCandidates: furniture.detected,
    headerFooterNearMiss: furniture.nearMiss,
    pages: pageRows,
  };
  documents.push(row);
  writeFileSync(`${OUT}/documents/${basename(file, ".pdf")}.json`, `${JSON.stringify(row, null, 2)}\n`);

  totalChunks += chunks.length;
  projectedTotal += projected;
  projections.push({
    file,
    currentChunks: chunks.length,
    projectedChunks: projected,
    reductionPct: chunks.length ? Number((100 * (1 - projected / chunks.length)).toFixed(1)) : 0,
    twoDominantProsePages: twoDominantPages,
    isolatedPages,
    skipped: row.totals.skipped,
  });
  headerFindings.push({
    file,
    detected: furniture.detected.length,
    samples: furniture.detected.slice(0, 8).map((row) => ({ text: row.sample, band: row.band, pages: row.count })),
    nearMiss: furniture.nearMiss.slice(0, 8).map((row) => ({ text: row.sample, band: row.band, pages: row.count, share: Number(row.share.toFixed(2)) })),
  });
  tableFindings.push({
    file,
    denseGridPages: gridPages,
    skippedProbablyGrid: pageRows.filter((p) => p.earliestSkip === "dense-grid").length,
  });
  listFindings.push({ file, visualListLines: listLines, isolatedPages });
  captionFindings.push({ file, captionLikeLines: captionLines });
  brokenFindings.push({ file, flaggedItems: broken });
}

const ready = documents.filter((doc) => doc.readiness === "ready");
const over200 = ready.filter((doc) => (doc.totalChunks ?? 0) > 200);
const contextEstimate = {
  allReadyChunks: totalChunks,
  fiveLargest: [...ready].sort((a, b) => (b.totalChunks ?? 0) - (a.totalChunks ?? 0)).slice(0, 5).map((d) => ({
    file: d.filename,
    chunks: d.totalChunks,
  })),
  fiveLargestSum: [...ready]
    .sort((a, b) => (b.totalChunks ?? 0) - (a.totalChunks ?? 0))
    .slice(0, 5)
    .reduce((sum, doc) => sum + (doc.totalChunks ?? 0), 0),
  projectedAllReady: projectedTotal,
  projectedFiveLargest: [...projections]
    .sort((a, b) => (b as { projectedChunks: number }).projectedChunks - (a as { projectedChunks: number }).projectedChunks)
    .slice(0, 5),
};

const summary = {
  phase: "4A.9",
  role: "diagnostic / design only — no parser implementation",
  generatedAt: new Date().toISOString(),
  pageClassTotals,
  skipReasons: Object.fromEntries(skipReasons),
  chunkOrigins: Object.fromEntries(chunkOrigins),
  totalChunks,
  documentsOver200: over200.map((doc) => ({ file: doc.filename, chunks: doc.totalChunks })),
  contextEstimate,
};

writeFileSync(`${OUT}/corpus-table.json`, `${JSON.stringify(documents.map((doc) => ({
  filename: doc.filename,
  byteSize: doc.byteSize,
  pageCount: doc.pageCount,
  extractedCharacterCount: doc.extractedCharacterCount,
  readiness: doc.readiness,
  totals: "totals" in doc ? doc.totals : null,
  totalChunks: doc.totalChunks,
  averageChunksPerPage: "averageChunksPerPage" in doc ? doc.averageChunksPerPage : null,
  maxChunksPerPage: "maxChunksPerPage" in doc ? doc.maxChunksPerPage : null,
  exceeds200: "exceeds200" in doc ? doc.exceeds200 : false,
})), null, 2)}\n`);
writeFileSync(`${OUT}/classification-totals.json`, `${JSON.stringify(pageClassTotals, null, 2)}\n`);
writeFileSync(`${OUT}/two-column-failures.json`, `${JSON.stringify(twoColFailures, null, 2)}\n`);
writeFileSync(`${OUT}/cs229-skips.json`, `${JSON.stringify({
  skipped: cs229Skips.length,
  byReason: cs229Skips.reduce<Record<string, number>>((acc, row) => {
    const key = String((row as { earliestSkip: string }).earliestSkip);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {}),
  pages: cs229Skips,
}, null, 2)}\n`);
writeFileSync(`${OUT}/chunk-explosion.json`, `${JSON.stringify({ origins: Object.fromEntries(chunkOrigins), projections, totalChunks, projectedTotal }, null, 2)}\n`);
writeFileSync(`${OUT}/headers.json`, `${JSON.stringify(headerFindings, null, 2)}\n`);
writeFileSync(`${OUT}/tables.json`, `${JSON.stringify(tableFindings, null, 2)}\n`);
writeFileSync(`${OUT}/lists.json`, `${JSON.stringify(listFindings, null, 2)}\n`);
writeFileSync(`${OUT}/captions.json`, `${JSON.stringify(captionFindings, null, 2)}\n`);
writeFileSync(`${OUT}/broken-items.json`, `${JSON.stringify(brokenFindings, null, 2)}\n`);
writeFileSync(`${OUT}/chunk-projection.json`, `${JSON.stringify({ projections, contextEstimate }, null, 2)}\n`);
writeFileSync(`${OUT}/summary.json`, `${JSON.stringify(summary, null, 2)}\n`);

console.log(JSON.stringify(summary, null, 2));
