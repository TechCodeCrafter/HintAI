/**
 * Shared PDF visual-line and left-edge clustering.
 * PDF user space: origin bottom-left, x right, y up.
 */
import type { PdfTextItem } from "../types.ts";
import { itemX, itemY } from "./items.ts";

export type VisualLine = {
  y: number;
  height: number;
  items: PdfTextItem[];
};

export type LeftEdgeCluster = {
  x: number;
  items: PdfTextItem[];
};

export const LINE_TOLERANCE = 0.45;
export const TWO_COL_EDGE_BUCKET = 36;
export const GRID_MIN_ITEMS = 12;
export const GRID_RECURRING = 3;
export const GRID_SHORT = 12;

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

function meanX(items: PdfTextItem[]): number {
  return items.reduce((sum, item) => sum + itemX(item), 0) / items.length;
}

function bump(map: Map<number, number>, key: number) {
  map.set(key, (map.get(key) ?? 0) + 1);
}
