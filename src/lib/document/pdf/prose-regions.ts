/**
 * Phase 4A.9.2 production layout analysis.
 *
 * Derived from the 4A.9.1 diagnostic model. Not evidence: Cards still cite
 * itemRanges, never a region id. Column identity uses item left-edge origins
 * only — reported widths that cross the gutter are distrusted.
 *
 * Geometry is PDF user space (origin bottom-left, y-up).
 */
import type { PdfTextItem } from "../types.ts";
import { itemRight, itemX, itemY } from "./items.ts";
import { groupVisualLines, isDenseGrid, leftEdgeClusters, visualLineText, type VisualLine } from "./layout-geometry.ts";

export const TWO_COL_GUTTER = 28;
export const TWO_COL_MIN_SEP_RATIO = 0.18;
export const TWO_COL_MIN_LINES = 2;
const MIN_PROSE_MASS_SHARE_TOP2 = 0.55;
const MIN_REGION_ITEMS = 3;
const MIN_REGION_ALPHA = 40;
const MIN_Y_SPAN = 12;
const Y_OVERLAP_RATIO = 0.3;

export type GridKind = "table" | "math" | "none";

export type ProseRegion = {
  side: "left" | "right";
  x: number;
  items: PdfTextItem[];
  alphabeticChars: number;
  multiWordLineCount: number;
  yTop: number;
  yBottom: number;
  ySpan: number;
  proseMassShare: number;
};

export type DominantProseAnalysis = {
  regions: ProseRegion[];
  extraClusterCount: number;
  twoDominantProse: boolean;
  twoIndependentRegions: boolean;
  refuseSingleColumn: boolean;
  proseMassShareTop2: number;
  splitX: number | null;
  gutter: number | null;
  yOverlap: number;
  widthDistrust: boolean;
  crossGutterRisk: boolean;
  gridKind: GridKind;
};

/** Alphabetic characters. One overflowing box cannot invent a second column. */
export function itemProseMass(item: PdfTextItem): number {
  return (item.str.match(/[A-Za-z]/g) ?? []).length;
}

export function isProseItem(item: PdfTextItem): boolean {
  const words = item.str
    .trim()
    .split(/\s+/)
    .filter((word) => /[A-Za-z]{3,}/.test(word));
  return words.length >= 2 || item.str.trim().length >= 24;
}

export function isMultiWordItem(item: PdfTextItem): boolean {
  return item.str
    .trim()
    .split(/\s+/)
    .filter((word) => /[A-Za-z]{3,}/.test(word)).length >= 2;
}

/** PDF.js width that crosses mid and is too large to be one column. */
export function itemOverflowsMid(item: PdfTextItem, pageWidth: number): boolean {
  if (pageWidth <= 0) return false;
  const mid = pageWidth / 2;
  return itemX(item) < mid && itemRight(item) > mid + 20 && item.width > pageWidth * 0.45;
}

export function lineWordCount(line: VisualLine): number {
  return visualLineText(line)
    .split(/\s+/)
    .filter((word) => /[A-Za-z]{2,}/.test(word)).length;
}

/**
 * Geometric lattice (existing isDenseGrid) plus prose continuity.
 * Long lecture lines with aligned symbols are math, not a table.
 */
export function classifyGridKind(items: PdfTextItem[]): GridKind {
  if (!isDenseGrid(items)) return "none";
  const lines = groupVisualLines(items);
  const longProse = lines.filter((line) => lineWordCount(line) >= 4).length;
  const text = lines.map(visualLineText).join(" ");
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  const chars = Math.max(text.replace(/\s/g, "").length, 1);
  const alpha = letters / chars;
  const longRatio = longProse / Math.max(lines.length, 1);
  // Lecture math: continuous prose dominates even when symbols align.
  if (longProse >= 8 && alpha >= 0.4) return "math";
  if (longProse >= 5 && longRatio >= 0.28 && alpha >= 0.35) return "math";
  return "table";
}

export function isTableLikeGrid(items: PdfTextItem[]): boolean {
  return classifyGridKind(items) === "table";
}

/**
 * Tight cross-gutter: two multi-word items that straddle mid on one visual
 * y-group, or an overflow-width item plus a second item originating past mid.
 * Broader 4A.9.1 overflow-only noise is not enough.
 */
export function tightCrossGutterRisk(items: PdfTextItem[], pageWidth: number): boolean {
  if (pageWidth <= 0) return false;
  const mid = pageWidth / 2;
  const lines = groupVisualLines(items);
  for (const line of lines) {
    const leftMulti = line.items.filter((item) => itemX(item) < mid - 14 && isMultiWordItem(item));
    const rightMulti = line.items.filter((item) => itemX(item) > mid + 14 && isMultiWordItem(item));
    if (leftMulti.length > 0 && rightMulti.length > 0) return true;
    const overflow = line.items.some((item) => itemOverflowsMid(item, pageWidth));
    const pastMid = line.items.some((item) => itemX(item) > mid + 14 && item.str.trim().length > 0);
    if (overflow && pastMid) return true;
  }
  return false;
}

export function findDominantProseRegions(items: PdfTextItem[], pageWidth: number): DominantProseAnalysis {
  const gridKind = classifyGridKind(items);
  const nonempty = items.filter((item) => item.str.trim().length > 0);
  const prose = nonempty.filter(isProseItem);
  const mid = pageWidth / 2;
  const minSep = Math.max(TWO_COL_GUTTER * 2, pageWidth * TWO_COL_MIN_SEP_RATIO);
  const widthDistrust = nonempty.some((item) => itemOverflowsMid(item, pageWidth));
  const crossGutterRisk = tightCrossGutterRisk(items, pageWidth);

  const clusterSource = prose.length > 0 ? prose : nonempty;
  const clusters = leftEdgeClusters(clusterSource);
  const totalMass = Math.max(
    clusterSource.reduce((sum, item) => sum + itemProseMass(item), 0),
    1,
  );

  const scored = clusters.map((cluster) => {
    const mass = cluster.items.reduce((sum, item) => sum + itemProseMass(item), 0);
    const ys = cluster.items.map(itemY);
    const yTop = ys.length ? Math.max(...ys) : 0;
    const yBottom = ys.length ? Math.min(...ys) : 0;
    const grouped = groupVisualLines(cluster.items);
    return {
      x: cluster.x,
      items: cluster.items,
      alphabeticChars: mass,
      proseMassShare: mass / totalMass,
      yTop,
      yBottom,
      ySpan: yTop - yBottom,
      multiWordLineCount: grouped.filter((line) => lineWordCount(line) >= 4).length,
    };
  });

  const ranked = [...scored].sort((a, b) => b.alphabeticChars - a.alphabeticChars);
  const top2 = ranked.slice(0, 2).sort((a, b) => a.x - b.x);
  const proseMassShareTop2 = top2.reduce((sum, row) => sum + row.proseMassShare, 0);

  let twoDominantProse = false;
  let yOverlap = 0;
  let gutter: number | null = null;
  if (top2.length === 2) {
    const [left, right] = top2;
    gutter = right.x - left.x;
    yOverlap = Math.min(left.yTop, right.yTop) - Math.max(left.yBottom, right.yBottom);
    const minSpan = Math.min(left.ySpan, right.ySpan);
    const straddle = left.x <= pageWidth * 0.45 && right.x >= pageWidth * 0.45;
    const bothStrong =
      left.items.length >= MIN_REGION_ITEMS &&
      right.items.length >= MIN_REGION_ITEMS &&
      left.alphabeticChars >= MIN_REGION_ALPHA &&
      right.alphabeticChars >= MIN_REGION_ALPHA &&
      left.multiWordLineCount >= TWO_COL_MIN_LINES &&
      right.multiWordLineCount >= TWO_COL_MIN_LINES &&
      left.proseMassShare >= 0.18 &&
      right.proseMassShare >= 0.18;
    twoDominantProse =
      gridKind !== "table" &&
      gutter >= minSep &&
      straddle &&
      bothStrong &&
      left.ySpan >= MIN_Y_SPAN &&
      right.ySpan >= MIN_Y_SPAN &&
      yOverlap > 0 &&
      yOverlap >= Y_OVERLAP_RATIO * minSpan &&
      proseMassShareTop2 >= MIN_PROSE_MASS_SHARE_TOP2;
  }

  const leftOrigin = nonempty.filter((item) => itemX(item) < mid - 14);
  const rightOrigin = nonempty.filter((item) => itemX(item) > mid + 14);
  const leftProse = leftOrigin.filter(isProseItem);
  const rightProse = rightOrigin.filter(isProseItem);
  const rightMultiWordLines = groupVisualLines(rightOrigin).filter((line) => lineWordCount(line) >= 4).length;
  const leftMultiWordLines = groupVisualLines(leftOrigin).filter((line) => lineWordCount(line) >= 4).length;

  const twoIndependentRegions =
    twoDominantProse ||
    (gridKind !== "table" &&
      widthDistrust &&
      rightOrigin.length >= 2 &&
      leftProse.length >= 2 &&
      leftMultiWordLines >= TWO_COL_MIN_LINES &&
      (rightProse.length >= 2 || rightMultiWordLines >= TWO_COL_MIN_LINES));

  const refuseSingleColumn =
    gridKind !== "table" && (twoDominantProse || twoIndependentRegions || crossGutterRisk);

  let splitX: number | null = null;
  if (twoDominantProse && top2.length === 2) {
    splitX = (top2[0].x + top2[1].x) / 2;
  } else if (refuseSingleColumn) {
    splitX = mid;
  }

  const regions: ProseRegion[] = [];
  if (top2.length === 2 && (twoDominantProse || twoIndependentRegions)) {
    regions.push({
      side: "left",
      x: top2[0].x,
      items: top2[0].items,
      alphabeticChars: top2[0].alphabeticChars,
      multiWordLineCount: top2[0].multiWordLineCount,
      yTop: top2[0].yTop,
      yBottom: top2[0].yBottom,
      ySpan: top2[0].ySpan,
      proseMassShare: top2[0].proseMassShare,
    });
    regions.push({
      side: "right",
      x: top2[1].x,
      items: top2[1].items,
      alphabeticChars: top2[1].alphabeticChars,
      multiWordLineCount: top2[1].multiWordLineCount,
      yTop: top2[1].yTop,
      yBottom: top2[1].yBottom,
      ySpan: top2[1].ySpan,
      proseMassShare: top2[1].proseMassShare,
    });
  } else if (refuseSingleColumn) {
    regions.push({
      side: "left",
      x: meanX(leftOrigin),
      items: leftOrigin,
      alphabeticChars: leftOrigin.reduce((sum, item) => sum + itemProseMass(item), 0),
      multiWordLineCount: leftMultiWordLines,
      yTop: leftOrigin.length ? Math.max(...leftOrigin.map(itemY)) : 0,
      yBottom: leftOrigin.length ? Math.min(...leftOrigin.map(itemY)) : 0,
      ySpan: 0,
      proseMassShare: 0,
    });
    regions.push({
      side: "right",
      x: meanX(rightOrigin),
      items: rightOrigin,
      alphabeticChars: rightOrigin.reduce((sum, item) => sum + itemProseMass(item), 0),
      multiWordLineCount: rightMultiWordLines,
      yTop: rightOrigin.length ? Math.max(...rightOrigin.map(itemY)) : 0,
      yBottom: rightOrigin.length ? Math.min(...rightOrigin.map(itemY)) : 0,
      ySpan: 0,
      proseMassShare: 0,
    });
    if (regions[0] && regions[1]) {
      regions[0].ySpan = regions[0].yTop - regions[0].yBottom;
      regions[1].ySpan = regions[1].yTop - regions[1].yBottom;
    }
  }

  return {
    regions,
    extraClusterCount: Math.max(0, scored.length - 2),
    twoDominantProse,
    twoIndependentRegions,
    refuseSingleColumn,
    proseMassShareTop2,
    splitX,
    gutter,
    yOverlap,
    widthDistrust,
    crossGutterRisk,
    gridKind,
  };
}

/**
 * Column membership from left-edge origin. Overflowing width never moves
 * a left-origin item into the right region.
 */
export function columnOfItem(
  item: PdfTextItem,
  analysis: DominantProseAnalysis,
): "left" | "right" | "unassigned" {
  if (analysis.splitX === null || !item.str.trim()) return "unassigned";
  return itemX(item) < analysis.splitX ? "left" : "right";
}

export function itemsInColumn(
  items: PdfTextItem[],
  analysis: DominantProseAnalysis,
  side: "left" | "right",
): PdfTextItem[] {
  return items.filter((item) => columnOfItem(item, analysis) === side);
}

function meanX(items: PdfTextItem[]): number {
  if (items.length === 0) return 0;
  return items.reduce((sum, item) => sum + itemX(item), 0) / items.length;
}
