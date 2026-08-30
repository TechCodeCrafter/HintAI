import type { DocumentEvidence } from "../../search/evidence.ts";
import type { DocumentItemRange, NormalizedDocument, PdfTextItem } from "../types.ts";
import { mappedDivForRange, type TextLayerMap } from "./map.ts";
import type { ExactHighlight, HighlightMode, HighlightPlan, ViewerBox } from "./types.ts";

export type ViewportLike = {
  convertToViewportPoint: (x: number, y: number) => number[];
};

export type HighlightPlanInput = {
  evidence: DocumentEvidence;
  document?: NormalizedDocument;
  map?: TextLayerMap;
  divs?: Array<{ textContent: string | null }>;
  viewport?: ViewportLike;
  /** Test/QA only. Never used to search the page for similar text. */
  forceMode?: HighlightMode;
};

export function planHighlight(input: HighlightPlanInput): HighlightPlan {
  const { evidence } = input;
  const caption = evidence.supportText || evidence.sourceText;
  const base: HighlightPlan = {
    mode: "caption-only",
    page: evidence.page,
    exact: [],
    boxes: [],
    caption,
  };

  if (input.forceMode === "caption-only") return base;
  if (input.forceMode === "item-box") {
    const boxes = itemBoxes(evidence.itemRanges, input.document, input.viewport);
    if (boxes.length > 0) return { ...base, mode: "item-box", boxes };
    return base;
  }

  const exact = exactRanges(evidence.itemRanges, input.document, input.map, input.divs);
  if (input.forceMode === "exact") {
    if (exact.length > 0 && exact.length === evidence.itemRanges.length) {
      return { ...base, mode: "exact", exact };
    }
    return base;
  }

  if (exact.length > 0 && exact.length === evidence.itemRanges.length) {
    return { ...base, mode: "exact", exact };
  }

  const boxes = itemBoxes(evidence.itemRanges, input.document, input.viewport);
  if (boxes.length > 0 && boxes.length === evidence.itemRanges.length) {
    return { ...base, mode: "item-box", boxes };
  }

  return base;
}

function exactRanges(
  ranges: DocumentItemRange[],
  document: NormalizedDocument | undefined,
  map: TextLayerMap | undefined,
  divs: Array<{ textContent: string | null }> | undefined,
): ExactHighlight[] {
  if (!document || !map || !divs) return [];
  const out: ExactHighlight[] = [];
  for (const range of ranges) {
    const item = itemForRange(document, range);
    if (!item) return [];
    if (range.charStart < 0 || range.charEnd > item.str.length || range.charEnd <= range.charStart) {
      return [];
    }
    const mapped = mappedDivForRange(map, range.itemIndex, item.str, divs);
    if (!mapped) return [];
    if (range.charEnd > mapped.text.length) return [];
    out.push({ itemIndex: range.itemIndex, charStart: range.charStart, charEnd: range.charEnd });
  }
  return out;
}

function itemBoxes(
  ranges: DocumentItemRange[],
  document: NormalizedDocument | undefined,
  viewport: ViewportLike | undefined,
): ViewerBox[] {
  if (!document || !viewport) return [];
  const out: ViewerBox[] = [];
  for (const range of ranges) {
    const item = itemForRange(document, range);
    if (!item) return [];
    const box = itemViewportBox(item, viewport);
    if (!box) return [];
    out.push({ itemIndex: range.itemIndex, ...box });
  }
  return out;
}

export function itemForRange(document: NormalizedDocument, range: DocumentItemRange): PdfTextItem | undefined {
  const page = document.pages.find((entry) => entry.pageNumber === range.page);
  return page?.items.find((entry) => entry.itemIndex === range.itemIndex);
}

/**
 * Convert a PDF text item's geometry through the rendered viewport.
 * 6.3.289 PageViewport exposes convertToViewportPoint, not convertToViewportRectangle.
 */
export function itemViewportBox(item: PdfTextItem, viewport: ViewportLike): Omit<ViewerBox, "itemIndex"> | null {
  const x = item.transform[4];
  const y = item.transform[5];
  const width = item.width;
  const height = item.height > 0 ? item.height : 12;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !(width > 0)) return null;
  const corners = [
    viewport.convertToViewportPoint(x, y),
    viewport.convertToViewportPoint(x + width, y),
    viewport.convertToViewportPoint(x, y + height),
    viewport.convertToViewportPoint(x + width, y + height),
  ];
  if (corners.some((point) => !point || point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1]))) {
    return null;
  }
  const xs = corners.map((point) => point[0]);
  const ys = corners.map((point) => point[1]);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const w = Math.max(...xs) - left;
  const h = Math.max(...ys) - top;
  if (w < 0.5 || h < 0.5) return null;
  return { x: left, y: top, w, h };
}

export function highlightOnlyEvidenceItems(plan: HighlightPlan, ranges: DocumentItemRange[]): boolean {
  const allowed = new Set(ranges.map((range) => range.itemIndex));
  const painted = [...plan.exact.map((item) => item.itemIndex), ...plan.boxes.map((item) => item.itemIndex)];
  return painted.every((index) => allowed.has(index));
}
