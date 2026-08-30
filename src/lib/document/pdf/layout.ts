import type { PageReadingOrder, PdfTextItem } from "../types.ts";
import { itemRight, itemX } from "./items.ts";
import {
  groupVisualLines,
  leftEdgeClusters,
  visualLineText,
  type LeftEdgeCluster,
  type VisualLine,
} from "./layout-geometry.ts";
import {
  findDominantProseRegions,
  isTableLikeGrid,
  itemsInColumn,
  TWO_COL_GUTTER,
  TWO_COL_MIN_LINES,
  TWO_COL_MIN_SEP_RATIO,
} from "./prose-regions.ts";

export {
  groupVisualLines,
  isDenseGrid,
  leftEdgeClusters,
  visualLineText,
  type LeftEdgeCluster,
  type VisualLine,
} from "./layout-geometry.ts";

export {
  classifyGridKind,
  columnOfItem,
  findDominantProseRegions,
  isProseItem,
  isTableLikeGrid,
  itemOverflowsMid,
  itemProseMass,
  tightCrossGutterRisk,
} from "./prose-regions.ts";

const TWO_COL_MIN_CLUSTER_ITEMS = 2;

export function detectReadingOrder(
  items: PdfTextItem[],
  pageWidth: number,
): { readingOrder: PageReadingOrder; left: VisualLine[]; right: VisualLine[]; lines: VisualLine[] } {
  const lines = groupVisualLines(items);
  if (isTableLikeGrid(items)) {
    return { readingOrder: "uncertain", left: [], right: [], lines };
  }

  const analysis = findDominantProseRegions(items, pageWidth);

  if (analysis.twoDominantProse && analysis.splitX !== null) {
    const left = groupVisualLines(itemsInColumn(items, analysis, "left"));
    const right = groupVisualLines(itemsInColumn(items, analysis, "right"));
    if (columnsAreConfident(left, right, analysis.splitX, pageWidth)) {
      return { readingOrder: "two-column", left, right, lines: regionLines(left, right) };
    }
    return { readingOrder: "uncertain", left, right, lines: regionLines(left, right) };
  }

  const pair = twoColumnPair(leftEdgeClusters(items), pageWidth);
  if (pair) {
    const splitX = (pair.left.x + pair.right.x) / 2;
    const left = groupVisualLines(items.filter((item) => itemX(item) < splitX));
    const right = groupVisualLines(items.filter((item) => itemX(item) >= splitX));
    if (isConfidentTwoColumn(left, right, pair, pageWidth)) {
      return { readingOrder: "two-column", left, right, lines: regionLines(left, right) };
    }
  }

  if (analysis.refuseSingleColumn && analysis.splitX !== null) {
    const left = groupVisualLines(itemsInColumn(items, analysis, "left"));
    const right = groupVisualLines(itemsInColumn(items, analysis, "right"));
    return { readingOrder: "uncertain", left, right, lines: regionLines(left, right) };
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

function regionLines(left: VisualLine[], right: VisualLine[]): VisualLine[] {
  return [...left, ...right];
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

function columnsAreConfident(
  left: VisualLine[],
  right: VisualLine[],
  splitX: number,
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
  void splitX;
  void pageWidth;
  return true;
}

function isConfidentTwoColumn(
  left: VisualLine[],
  right: VisualLine[],
  pair: { left: LeftEdgeCluster; right: LeftEdgeCluster },
  pageWidth: number,
): boolean {
  if (!columnsAreConfident(left, right, (pair.left.x + pair.right.x) / 2, pageWidth)) return false;
  if (pair.right.x - pair.left.x < pageWidth * TWO_COL_MIN_SEP_RATIO) return false;
  return true;
}

function columnHasProse(lines: VisualLine[]): boolean {
  return lines.some((line) => visualLineText(line).split(/\s+/).filter(Boolean).length >= 4);
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
