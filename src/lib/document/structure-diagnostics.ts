/**
 * Structural diagnostics. 4A.9.2 production layout consumes the same
 * dominant-prose and grid-kind analysis. No models, embeddings, or LLMs.
 */
import { itemRight, itemX, itemY } from "./pdf/items.ts";
import { isDenseGrid, leftEdgeClusters } from "./pdf/layout.ts";
import { classifyGridKind, findDominantProseRegions } from "./pdf/prose-regions.ts";
import type { NormalizedPage, PdfTextItem } from "./types.ts";
import type { StructureVisualLine } from "./structure.ts";

const LIST_RE = /^(?:[\u2022\u2023\u25E6\u2043•·▪◦‣●○■□–—-]\s+|\(\d+\)\s+|\d+[.)]\s+|[a-z][.)]\s+)/i;
const CAPTION_RE = /^(?:figure|fig\.|table|tbl\.|algorithm)\s*\d/i;
const EQ_RE = /[=∑∫√∞±×÷≤≥≠≈∈→←()[\]{}^_]/;
const TWO_COL_EDGE_BUCKET = 36;

export type LineFeatures = {
  text: string;
  wordCount: number;
  alphaRatio: number;
  numericRatio: number;
  punctRatio: number;
  avgTokenLength: number;
  itemCount: number;
  lineWidth: number;
  capitalizedShare: number;
  bulletPrefix: boolean;
  equationSymbolRatio: number;
  shortTokenRatio: number;
  /** Diagnostic 0–1. Not a classifier. */
  proseScore: number;
};

export type RegionCandidate = {
  idHint: string;
  kind: "prose" | "unknown";
  x: number;
  items: number;
  proseLines: number;
  ySpan: number;
  avgWidth: number;
  medianWidth: number;
  gutterToNext: number | null;
  mostlyShortMathNoise: boolean;
  alphabeticChars: number;
  proseMassShare: number;
  lineIds: string[];
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type CrossGutterFinding = {
  lineId: string;
  page: number;
  itemIndexes: number[];
  leftX: number;
  rightX: number;
  mid: number;
  maxItemWidth: number;
  overflowWidth: boolean;
  joinedNormText: string | null;
};

export type GridMathFeatures = {
  itemCount: number;
  lineCount: number;
  longProseLineCount: number;
  shortTokenRatio: number;
  alphaRatio: number;
  numericRatio: number;
  equationSymbolRatio: number;
  recurringX: number;
  recurringY: number;
  alignmentStability: number;
  denseGridFired: boolean;
  /** Diagnostic hypothesis only. */
  hypothesis: "likely-math" | "likely-grid" | "mixed" | "unknown";
};

export type ListCandidate = {
  lineId: string;
  marker: string;
  left: number;
  wordCount: number;
};

export type CaptionCandidate = {
  lineId: string;
  text: string;
  y: number;
};

export function lineFeatures(text: string, items: PdfTextItem[], lineWidth: number): LineFeatures {
  const tokens = text.split(/\s+/).filter(Boolean);
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  const digits = (text.match(/\d/g) ?? []).length;
  const punct = (text.match(/[^\w\s]/g) ?? []).length;
  const chars = Math.max(text.replace(/\s/g, "").length, 1);
  const short = tokens.filter((token) => token.length <= 2).length;
  const eq = (text.match(EQ_RE) ?? []).length;
  const capitalized = tokens.filter((token) => /^[A-Z]/.test(token)).length;
  const wordCount = tokens.filter((token) => /[A-Za-z]{2,}/.test(token)).length;
  const alphaRatio = letters / chars;
  const numericRatio = digits / chars;
  const shortTokenRatio = tokens.length ? short / tokens.length : 0;
  const avgTokenLength = tokens.length ? tokens.reduce((sum, token) => sum + token.length, 0) / tokens.length : 0;
  const bulletPrefix = LIST_RE.test(text);
  const proseScore = clamp01(
    0.35 * Math.min(1, wordCount / 8) +
      0.25 * alphaRatio +
      0.2 * (1 - shortTokenRatio) +
      0.2 * Math.min(1, avgTokenLength / 5),
  );
  return {
    text,
    wordCount,
    alphaRatio,
    numericRatio,
    punctRatio: punct / chars,
    avgTokenLength,
    itemCount: items.length,
    lineWidth,
    capitalizedShare: tokens.length ? capitalized / tokens.length : 0,
    bulletPrefix,
    equationSymbolRatio: eq / chars,
    shortTokenRatio,
    proseScore,
  };
}

export function analyzePageRegions(
  sourceId: string,
  pageNumber: number,
  lines: StructureVisualLine[],
  items: PdfTextItem[],
  pageWidth: number,
): {
  candidates: RegionCandidate[];
  twoDominantProse: boolean;
  twoIndependentRegions: boolean;
  refuseSingleColumn: boolean;
  widthDistrust: boolean;
  proseMassShareTop2: number;
} {
  const production = findDominantProseRegions(items, pageWidth);
  const byIndex = new Map(items.map((item) => [item.itemIndex, item]));
  const proseItems = items.filter((item) => {
    const words = item.str.trim().split(/\s+/).filter((word) => /[A-Za-z]{3,}/.test(word));
    return words.length >= 2 || item.str.trim().length >= 24;
  });
  const clusters = leftEdgeClusters(proseItems.length ? proseItems : items.filter((item) => item.str.trim()));

  const assigned = new Map<number, StructureVisualLine[]>();
  for (const line of lines) {
    const leftItem = line.itemIndexes
      .map((itemIndex) => byIndex.get(itemIndex))
      .filter((item): item is PdfTextItem => Boolean(item))
      .sort((a, b) => itemX(a) - itemX(b))[0];
    const anchor = leftItem ? itemX(leftItem) : line.left;
    let best = 0;
    let bestDist = Infinity;
    clusters.forEach((cluster, index) => {
      const dist = Math.abs(cluster.x - anchor);
      if (dist < bestDist) {
        best = index;
        bestDist = dist;
      }
    });
    const key = clusters.length ? best : Math.round(anchor / TWO_COL_EDGE_BUCKET) * TWO_COL_EDGE_BUCKET;
    const list = assigned.get(key) ?? [];
    list.push(line);
    assigned.set(key, list);
  }

  const totalAlpha =
    (proseItems.length ? proseItems : items).reduce((sum, item) => sum + alphaChars(item.str), 0) || 1;
  const candidates: RegionCandidate[] = clusters.map((cluster, ordinal) => {
    const group = assigned.get(ordinal) ?? [];
    const widths = cluster.items.map((item) => item.width || 0).sort((a, b) => a - b);
    const alphabeticChars = cluster.items.reduce((sum, item) => sum + alphaChars(item.str), 0);
    const shortish = cluster.items.filter((item) => item.str.trim().length <= 12).length;
    const ys = cluster.items.map(itemY);
    const kind: RegionCandidate["kind"] = alphabeticChars >= 40 ? "prose" : "unknown";
    return {
      idHint: `${sourceId}:p${pageNumber}:region:${ordinal}`,
      kind,
      x: cluster.x,
      items: cluster.items.length,
      proseLines: group.filter((line) => line.features.wordCount >= 2).length,
      ySpan: ys.length ? Math.max(...ys) - Math.min(...ys) : 0,
      avgWidth: widths.length ? mean(widths) : 0,
      medianWidth: widths.length ? widths[Math.floor(widths.length / 2)] : 0,
      gutterToNext: null as number | null,
      mostlyShortMathNoise: cluster.items.length > 0 && shortish / cluster.items.length >= 0.7,
      alphabeticChars,
      proseMassShare: alphabeticChars / totalAlpha,
      lineIds: group.map((line) => line.id),
      left: cluster.items.length ? Math.min(...cluster.items.map(itemX)) : cluster.x,
      right: cluster.items.length ? Math.max(...cluster.items.map(itemRight)) : cluster.x,
      top: ys.length ? Math.max(...ys) : 0,
      bottom: ys.length ? Math.min(...ys) : 0,
    };
  }).sort((a, b) => a.left - b.left);

  for (let i = 0; i < candidates.length - 1; i += 1) {
    candidates[i].gutterToNext = candidates[i + 1].left - candidates[i].right;
  }

  return {
    candidates,
    twoDominantProse: production.twoDominantProse,
    twoIndependentRegions: production.twoIndependentRegions,
    refuseSingleColumn: production.refuseSingleColumn,
    widthDistrust: production.widthDistrust,
    proseMassShareTop2: production.proseMassShareTop2,
  };
}

export function crossGutterOnLine(
  line: StructureVisualLine,
  items: PdfTextItem[],
  pageWidth: number,
  pageText: string,
  pageNumber: number,
): CrossGutterFinding[] {
  if (pageWidth <= 0 || line.itemIndexes.length === 0) return [];
  const mid = pageWidth / 2;
  const lineItems = line.itemIndexes
    .map((itemIndex) => items.find((item) => item.itemIndex === itemIndex))
    .filter((item): item is PdfTextItem => Boolean(item));
  if (lineItems.length === 0) return [];
  const leftish = lineItems.filter((item) => itemX(item) < mid - 14);
  const rightish = lineItems.filter((item) => itemX(item) > mid + 14);
  const overflow = lineItems.some((item) => itemX(item) < mid && itemRight(item) > mid + 20 && item.width > pageWidth * 0.45);
  let gapAcross = false;
  const ordered = [...lineItems].sort((a, b) => itemX(a) - itemX(b));
  for (let i = 0; i < ordered.length - 1; i += 1) {
    const gap = itemX(ordered[i + 1]) - itemRight(ordered[i]);
    if (itemRight(ordered[i]) <= mid && itemX(ordered[i + 1]) >= mid && gap >= 20) gapAcross = true;
  }
  if (!((leftish.length > 0 && rightish.length > 0) || overflow || gapAcross)) return [];
  const joined =
    line.normStart !== undefined && line.normEnd !== undefined
      ? pageText.slice(line.normStart, line.normEnd)
      : null;
  return [
    {
      lineId: line.id,
      page: pageNumber,
      itemIndexes: line.itemIndexes,
      leftX: Math.min(...lineItems.map(itemX)),
      rightX: Math.max(...lineItems.map(itemRight)),
      mid,
      maxItemWidth: Math.max(...lineItems.map((item) => item.width)),
      overflowWidth: overflow,
      joinedNormText: joined,
    },
  ];
}

export function gridMathFeatures(
  page: NormalizedPage,
  lines: StructureVisualLine[],
  pageWidth: number,
): GridMathFeatures {
  const tokens = page.items.filter((item) => item.str.trim().length > 0);
  const short = tokens.filter((item) => item.str.trim().length <= 12).length;
  const text = lines.map((line) => line.features.text).join(" ");
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  const digits = (text.match(/\d/g) ?? []).length;
  const eq = (text.match(EQ_RE) ?? []).length;
  const chars = Math.max(text.replace(/\s/g, "").length, 1);
  const bucket = (value: number) => Math.round(value / 8) * 8;
  const xs = new Map<number, number>();
  const ys = new Map<number, number>();
  for (const item of tokens) {
    bump(xs, bucket(itemX(item)));
    bump(ys, bucket(itemY(item)));
  }
  const recurringX = [...xs.values()].filter((count) => count >= 3).length;
  const recurringY = [...ys.values()].filter((count) => count >= 3).length;
  const xCounts = [...xs.values()];
  const alignmentStability = xCounts.length ? stdev(xCounts) / (mean(xCounts) || 1) : 0;
  const longProseLineCount = lines.filter((line) => line.features.wordCount >= 4).length;
  const shortTokenRatio = tokens.length ? short / tokens.length : 0;
  const alphaRatio = letters / chars;
  const numericRatio = digits / chars;
  const equationSymbolRatio = eq / chars;
  const denseGridFired = isDenseGrid(page.items);
  const gridKind = classifyGridKind(page.items);
  let hypothesis: GridMathFeatures["hypothesis"] = "unknown";
  if (gridKind === "math") hypothesis = "likely-math";
  else if (gridKind === "table") hypothesis = "likely-grid";
  else if (denseGridFired && longProseLineCount >= 3 && alphaRatio >= 0.35) hypothesis = "likely-math";
  else if (denseGridFired && longProseLineCount <= 1 && recurringX >= 3 && recurringY >= 3) hypothesis = "likely-grid";
  else if (denseGridFired) hypothesis = "mixed";
  else if (recurringX >= 3 && recurringY >= 3 && shortTokenRatio >= 0.7 && longProseLineCount <= 1) {
    hypothesis = "likely-grid";
  }
  void pageWidth;
  return {
    itemCount: page.items.length,
    lineCount: lines.length,
    longProseLineCount,
    shortTokenRatio,
    alphaRatio,
    numericRatio,
    equationSymbolRatio,
    recurringX,
    recurringY,
    alignmentStability,
    denseGridFired,
    hypothesis,
  };
}

export function listSignal(line: StructureVisualLine): ListCandidate[] {
  if (!line.features.bulletPrefix) return [];
  const marker = line.features.text.match(LIST_RE)?.[0]?.trim() ?? "";
  return [{ lineId: line.id, marker, left: line.left, wordCount: line.features.wordCount }];
}

export function captionSignal(line: StructureVisualLine): CaptionCandidate[] {
  if (!CAPTION_RE.test(line.features.text)) return [];
  return [{ lineId: line.id, text: line.features.text, y: line.y }];
}

function alphaChars(text: string): number {
  return (text.match(/[A-Za-z]/g) ?? []).length;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length);
}

function bump(map: Map<number, number>, key: number) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
