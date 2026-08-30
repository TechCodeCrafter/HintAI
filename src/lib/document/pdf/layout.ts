import type { PageReadingOrder, PdfTextItem } from "../types.ts";
import { itemRight, itemX, itemY } from "./items.ts";

export type VisualLine = {
  y: number;
  height: number;
  items: PdfTextItem[];
};

const LINE_TOLERANCE = 0.45;
const TWO_COL_MIN_LINES = 2;
const TWO_COL_GUTTER = 28;
const TWO_COL_EDGE_BUCKET = 36;
const TWO_COL_MIN_CLUSTER_ITEMS = 2;
const TWO_COL_MIN_SEP_RATIO = 0.18;
const GRID_MIN_ITEMS = 12;
const GRID_RECURRING = 3;
const GRID_SHORT = 12;

export function groupVisualLines(items: PdfTextItem[]): VisualLine[] {
  const withText = items.filter((item) => item.str.length > 0);
  const ordered = [...withText].sort((a, b) => itemY(b) - itemY(a) || itemX(a) - itemX(b));
  const lines: VisualLine[] = [];
  for (const item of ordered) {
    const y = itemY(item);
    const height = item.height > 0 ? item.height : 12;
    const existing = lines.find((line) => Math.abs(line.y - y) <= Math.max(line.height, height) * LINE_TOLERANCE);
    if (existing) {
      const n = existing.items.length;
      existing.items.push(item);
      existing.y = (existing.y * n + y) / (n + 1);
      existing.height = Math.max(existing.height, height);
    } else {
      lines.push({ y, height, items: [item] });
    }
  }
  for (const line of lines) {
    line.items.sort((a, b) => itemX(a) - itemX(b));
  }
  lines.sort((a, b) => b.y - a.y);
  return lines;
}

export function visualLineText(line: VisualLine): string {
  return line.items
    .map((item) => item.str)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isDenseGrid(items: PdfTextItem[]): boolean {
  const tokens = items.filter((item) => item.str.trim().length > 0);
  if (tokens.length < GRID_MIN_ITEMS) return false;
  const bucket = (value: number) => Math.round(value / 8) * 8;
  const xs = new Map<number, number>();
  const ys = new Map<number, number>();
  let short = 0;
  for (const item of tokens) {
    bump(xs, bucket(itemX(item)));
    bump(ys, bucket(itemY(item)));
    if (item.str.trim().length <= GRID_SHORT) short += 1;
  }
  const recurringX = [...xs.values()].filter((count) => count >= GRID_RECURRING).length;
  const recurringY = [...ys.values()].filter((count) => count >= GRID_RECURRING).length;
  return recurringX >= 3 && recurringY >= 3 && short / tokens.length >= 0.7;
}

export type LeftEdgeCluster = {
  x: number;
  items: PdfTextItem[];
};

/**
 * Cluster by left edge, not by itemRight. A left-column line that is slightly
 * wider than the column still belongs to that column.
 */
export function leftEdgeClusters(items: PdfTextItem[]): LeftEdgeCluster[] {
  const usable = items.filter((item) => item.str.trim().length > 0);
  const buckets = new Map<number, PdfTextItem[]>();
  for (const item of usable) {
    const key = Math.round(itemX(item) / TWO_COL_EDGE_BUCKET) * TWO_COL_EDGE_BUCKET;
    const list = buckets.get(key) ?? [];
    list.push(item);
    buckets.set(key, list);
  }
  const ordered = [...buckets.entries()].sort((a, b) => a[0] - b[0]);
  const merged: LeftEdgeCluster[] = [];
  for (const [, bucketItems] of ordered) {
    const x = meanX(bucketItems);
    const prev = merged[merged.length - 1];
    if (prev && x - prev.x <= TWO_COL_EDGE_BUCKET) {
      prev.items.push(...bucketItems);
      prev.x = meanX(prev.items);
    } else {
      merged.push({ x, items: [...bucketItems] });
    }
  }
  return merged;
}

export function detectReadingOrder(
  items: PdfTextItem[],
  pageWidth: number,
): { readingOrder: PageReadingOrder; left: VisualLine[]; right: VisualLine[]; lines: VisualLine[] } {
  const lines = groupVisualLines(items);
  if (isDenseGrid(items)) {
    return { readingOrder: "uncertain", left: [], right: [], lines };
  }

  const pair = twoColumnPair(leftEdgeClusters(items), pageWidth);
  if (pair) {
    const splitX = (pair.left.x + pair.right.x) / 2;
    const left = groupVisualLines(items.filter((item) => itemX(item) < splitX));
    const right = groupVisualLines(items.filter((item) => itemX(item) >= splitX));
    if (isConfidentTwoColumn(left, right, pair, pageWidth)) {
      return { readingOrder: "two-column", left, right, lines };
    }
  }

  const mid = pageWidth / 2;
  const leftItems = items.filter((item) => itemRight(item) < mid - TWO_COL_GUTTER / 2);
  const rightItems = items.filter((item) => itemX(item) > mid + TWO_COL_GUTTER / 2);
  const left = groupVisualLines(leftItems);
  const right = groupVisualLines(rightItems);
  if (left.length >= 2 && right.length >= 2) {
    const starts = lines.map((line) => itemX(line.items[0]));
    const spread = Math.max(...starts) - Math.min(...starts);
    if (spread > pageWidth * 0.35) {
      return { readingOrder: "uncertain", left, right, lines };
    }
  }
  return { readingOrder: "single-column", left: [], right: [], lines };
}

function twoColumnPair(
  clusters: LeftEdgeCluster[],
  pageWidth: number,
): { left: LeftEdgeCluster; right: LeftEdgeCluster } | null {
  const substantial = clusters.filter((cluster) => cluster.items.length >= TWO_COL_MIN_CLUSTER_ITEMS);
  if (substantial.length !== 2) return null;
  const [first, second] = [...substantial].sort((a, b) => a.x - b.x);
  const sep = second.x - first.x;
  if (sep < Math.max(TWO_COL_GUTTER * 2, pageWidth * TWO_COL_MIN_SEP_RATIO)) return null;
  if (first.x > pageWidth * 0.45 || second.x < pageWidth * 0.45) return null;
  return { left: first, right: second };
}

function isConfidentTwoColumn(
  left: VisualLine[],
  right: VisualLine[],
  pair: { left: LeftEdgeCluster; right: LeftEdgeCluster },
  pageWidth: number,
): boolean {
  if (left.length < TWO_COL_MIN_LINES || right.length < TWO_COL_MIN_LINES) return false;
  if (!columnHasProse(left) || !columnHasProse(right)) return false;
  const leftSpan = lineSpan(left);
  const rightSpan = lineSpan(right);
  if (leftSpan < 12 || rightSpan < 12) return false;
  const overlap = Math.min(left[0].y, right[0].y) - Math.max(left[left.length - 1].y, right[right.length - 1].y);
  if (overlap <= 0) return false;
  if (overlap < 0.3 * Math.min(leftSpan, rightSpan)) return false;
  const leftEdges = left.flatMap((line) => line.items.map(itemX));
  const rightEdges = right.flatMap((line) => line.items.map(itemX));
  if (Math.min(...rightEdges) - Math.max(...leftEdges) < TWO_COL_GUTTER) return false;
  if (pair.right.x - pair.left.x < pageWidth * TWO_COL_MIN_SEP_RATIO) return false;
  return true;
}

function columnHasProse(lines: VisualLine[]): boolean {
  return lines.some((line) => visualLineText(line).split(/\s+/).filter(Boolean).length >= 4);
}

function meanX(items: PdfTextItem[]): number {
  return items.reduce((sum, item) => sum + itemX(item), 0) / items.length;
}

export function shouldInsertSpace(prev: PdfTextItem, next: PdfTextItem): boolean {
  if (/\s$/.test(prev.str) || /^\s/.test(next.str)) return false;
  const gap = itemX(next) - itemRight(prev);
  const em = Math.max(prev.height, next.height, 8);
  if (gap > em * 0.22) return true;
  // A reported width that crosses the next left-edge is overflow, not one word.
  return gap <= 0 && itemX(next) - itemX(prev) > em * 4;
}

export function isParagraphBreak(prev: VisualLine, next: VisualLine): boolean {
  const gap = prev.y - next.y;
  return gap > Math.max(prev.height, next.height) * 1.85;
}

export function lineIsUsable(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/[.!?]/.test(trimmed)) return true;
  return trimmed.split(/\s+/).filter(Boolean).length >= 4;
}

function lineSpan(lines: VisualLine[]): number {
  if (lines.length === 0) return 0;
  return lines[0].y - lines[lines.length - 1].y;
}

function bump(map: Map<number, number>, key: number) {
  map.set(key, (map.get(key) ?? 0) + 1);
}
