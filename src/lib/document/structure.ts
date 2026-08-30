/**
 * Phase 4A.9.1 derived structural IR.
 *
 * Observes an existing NormalizedDocument. 4A.9.2 production layout
 * consumes the same dominant-prose / grid-kind analysis; this IR remains
 * derived and is never evidence. Cards cite itemRanges, never a
 * VisualLine, PageRegion, or DocumentBlock id.
 *
 * Geometry is PDF user space as stored on PdfTextItem.transform:
 * origin bottom-left, x increases right, y increases up. Viewer
 * conversion stays outside this IR.
 */
import { DOCUMENT_STRUCTURE_VERSION } from "../context/index-versions.ts";
import {
  furnitureHint,
  isFurnitureCandidate,
  LEAF_BLOCK_KINDS,
  normalizeFurnitureText,
  reconstructPageBlocks,
  structureBlockId,
  type DocumentBlock,
} from "./blocks.ts";
import { itemRight, itemX, itemY } from "./pdf/items.ts";
import { groupVisualLines, isDenseGrid, visualLineText, type VisualLine } from "./pdf/layout.ts";
import { classifyGridKind } from "./pdf/prose-regions.ts";
import type { MappedSegment, NormalizedDocument, NormalizedPage, PdfTextItem } from "./types.ts";
import {
  analyzePageRegions,
  captionSignal,
  crossGutterOnLine,
  gridMathFeatures,
  lineFeatures,
  listSignal,
  type CaptionCandidate,
  type CrossGutterFinding,
  type GridMathFeatures,
  type LineFeatures,
  type ListCandidate,
  type RegionCandidate,
} from "./structure-diagnostics.ts";

export type { DocumentBlock, DocumentBlockKind } from "./blocks.ts";
export { structureBlockId } from "./blocks.ts";

export type StructureVisualLine = {
  id: string;
  ordinal: number;
  itemIndexes: number[];
  /** Present only when this line contributed source segments to page.text. */
  normStart?: number;
  normEnd?: number;
  x: number;
  y: number;
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  wordCount: number;
  features: LineFeatures;
};

/**
 * Region snapshot for diagnostics. Production reading-order uses the same
 * dominant-prose analysis; these ids are still never provenance.
 */
export type PageRegion = {
  id: string;
  kind: "prose" | "unknown";
  role: "candidate";
  lineIds: string[];
  left: number;
  right: number;
  top: number;
  bottom: number;
};

/**
 * Derived structure only. Never cite DocumentBlock.id as provenance.
 * Evidence still resolves normalized range → MappedSegments → itemRanges.
 */

export type StructuredPage = {
  pageNumber: number;
  width: number;
  height: number;
  sizeSource: "viewport" | "inferred-items";
  lines: StructureVisualLine[];
  regions: PageRegion[];
  blocks: DocumentBlock[];
  diagnostics: PageStructureDiagnostics;
};

export type PageStructureDiagnostics = {
  readingOrder: NormalizedPage["readingOrder"];
  index: NormalizedPage["index"];
  denseGrid: boolean;
  gridKind: "table" | "math" | "none";
  regionCandidates: RegionCandidate[];
  twoDominantProse: boolean;
  twoIndependentRegions: boolean;
  refuseSingleColumn: boolean;
  widthDistrust: boolean;
  proseMassShareTop2: number;
  crossGutterRisk: boolean;
  crossGutter: CrossGutterFinding[];
  gridMath: GridMathFeatures;
  listCandidates: ListCandidate[];
  captionCandidates: CaptionCandidate[];
};

export type FurnitureCandidate = {
  text: string;
  pages: number;
  pageCount: number;
  share: number;
  yValues: number[];
  xValues: number[];
  heights: number[];
  likelyFurnitureScore: number;
};

export type DocumentStructure = {
  sourceId: string;
  contentHash: string;
  parserVersion: number;
  normalizerVersion: number;
  structureVersion: number;
  pages: StructuredPage[];
  furnitureCandidates: FurnitureCandidate[];
};

export type PageSize = { width: number; height: number };

export function structureVisualLineId(sourceId: string, pageNumber: number, ordinal: number): string {
  return `${sourceId}:p${pageNumber}:line:${ordinal}`;
}

export function structureRegionId(sourceId: string, pageNumber: number, ordinal: number): string {
  return `${sourceId}:p${pageNumber}:region:${ordinal}`;
}

export function inferPageSize(items: PdfTextItem[]): PageSize {
  if (items.length === 0) return { width: 0, height: 0 };
  let width = 0;
  let height = 0;
  for (const item of items) {
    width = Math.max(width, itemRight(item));
    height = Math.max(height, itemY(item) + Math.max(item.height, 0));
  }
  return { width, height };
}

function lineGeometry(line: VisualLine) {
  const xs = line.items.map(itemX);
  const rights = line.items.map(itemRight);
  const bottoms = line.items.map(itemY);
  const tops = line.items.map((item) => itemY(item) + Math.max(item.height, 0));
  const left = Math.min(...xs);
  const right = Math.max(...rights);
  const bottom = Math.min(...bottoms);
  const top = Math.max(...tops);
  return {
    x: left,
    y: line.y,
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: Math.max(top - bottom, line.height),
  };
}

/**
 * Normalized range for a visual line from existing MappedSegments only.
 * Does not search page.text.
 */
export function lineNormRange(
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

function mappedSliceForItems(page: NormalizedPage, itemIndexes: number[]): string | null {
  const range = lineNormRange(page, itemIndexes);
  if (!range) return null;
  return page.text.slice(range.normStart, range.normEnd);
}

/**
 * Derived on demand from a valid NormalizedDocument. Not loaded on ordinary
 * warm Context hydration when DocumentChunks already exist. A structure-version
 * mismatch rebuilds from the IR only — no Blob, no PDF.js.
 */
export function deriveDocumentStructure(
  document: NormalizedDocument,
  options?: { pageSize?: Record<number, PageSize> },
): DocumentStructure {
  const shells = document.pages.map((page) =>
    deriveStructuredPage(document.sourceId, page, options?.pageSize?.[page.pageNumber]),
  );
  const furnitureCandidates = furnitureFromLines(shells);
  const furnitureTexts = new Set(
    furnitureCandidates
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
      .map((row) => normalizeFurnitureText(row.text)),
  );
  const pages = shells.map((page, index) => {
    const source = document.pages[index];
    return {
      ...page,
      blocks: reconstructPageBlocks({
        sourceId: document.sourceId,
        page: source,
        lines: page.lines,
        regions: page.regions,
        furnitureTexts,
        pageWidth: page.width,
        gridKind: page.diagnostics.gridKind,
      }),
    };
  });
  return {
    sourceId: document.sourceId,
    contentHash: document.contentHash,
    parserVersion: document.parserVersion,
    normalizerVersion: document.normalizerVersion,
    structureVersion: DOCUMENT_STRUCTURE_VERSION,
    pages,
    furnitureCandidates,
  };
}

function deriveStructuredPage(
  sourceId: string,
  page: NormalizedPage,
  viewport?: PageSize,
): StructuredPage {
  const inferred = inferPageSize(page.items);
  const size = viewport && viewport.width > 0 && viewport.height > 0 ? viewport : inferred;
  const sizeSource: StructuredPage["sizeSource"] = viewport && viewport.width > 0 ? "viewport" : "inferred-items";
  const rawLines = groupVisualLines(page.items);
  const lines: StructureVisualLine[] = rawLines.map((line, ordinal) => {
    const itemIndexes = line.items.map((item) => item.itemIndex);
    const range = lineNormRange(page, itemIndexes);
    const geometry = lineGeometry(line);
    const text = visualLineText(line);
    const features = lineFeatures(text, line.items, geometry.width);
    return {
      id: structureVisualLineId(sourceId, page.pageNumber, ordinal),
      ordinal,
      itemIndexes,
      ...(range ?? {}),
      ...geometry,
      wordCount: features.wordCount,
      features,
    };
  });

  const regionAnalysis = analyzePageRegions(sourceId, page.pageNumber, lines, page.items, size.width);
  const regions: PageRegion[] = regionAnalysis.candidates.map((candidate, ordinal) => ({
    id: structureRegionId(sourceId, page.pageNumber, ordinal),
    kind: candidate.kind,
    role: "candidate" as const,
    lineIds: candidate.lineIds,
    left: candidate.left,
    right: candidate.right,
    top: candidate.top,
    bottom: candidate.bottom,
  }));

  const gutter = lines.flatMap((line) =>
    crossGutterOnLine(line, page.items, size.width, page.text, page.pageNumber),
  );
  const lists = lines.flatMap((line) => listSignal(line));
  const captions = lines.flatMap((line) => captionSignal(line));

  return {
    pageNumber: page.pageNumber,
    width: size.width,
    height: size.height,
    sizeSource,
    lines,
    regions,
    blocks: [] as DocumentBlock[],
    diagnostics: {
      readingOrder: page.readingOrder,
      index: page.index,
      denseGrid: isDenseGrid(page.items),
      gridKind: classifyGridKind(page.items),
      regionCandidates: regionAnalysis.candidates,
      twoDominantProse: regionAnalysis.twoDominantProse,
      twoIndependentRegions: regionAnalysis.twoIndependentRegions,
      refuseSingleColumn: regionAnalysis.refuseSingleColumn,
      widthDistrust: regionAnalysis.widthDistrust,
      proseMassShareTop2: regionAnalysis.proseMassShareTop2,
      crossGutterRisk: gutter.length > 0 || regionAnalysis.refuseSingleColumn,
      crossGutter: gutter,
      gridMath: gridMathFeatures(page, lines, size.width),
      listCandidates: lists,
      captionCandidates: captions,
    },
  };
}

function furnitureFromLines(pages: StructuredPage[]): FurnitureCandidate[] {
  const counts = new Map<
    string,
    { pages: Set<number>; yValues: number[]; xValues: number[]; heights: number[] }
  >();
  for (const page of pages) {
    const seen = new Set<string>();
    for (const line of page.lines) {
      const text = line.features.text;
      if (!text || text.length < 12) continue;
      if (seen.has(text)) continue;
      seen.add(text);
      const row = counts.get(text) ?? { pages: new Set<number>(), yValues: [], xValues: [], heights: [] };
      row.pages.add(page.pageNumber);
      row.yValues.push(line.y);
      row.xValues.push(line.left);
      row.heights.push(line.height);
      counts.set(text, row);
    }
  }
  const pageCount = pages.length;
  return [...counts.entries()]
    .map(([text, row]) => {
      const n = row.pages.size;
      const share = pageCount > 0 ? n / pageCount : 0;
      const ySpread = row.yValues.length ? Math.max(...row.yValues) - Math.min(...row.yValues) : 0;
      const xSpread = row.xValues.length ? Math.max(...row.xValues) - Math.min(...row.xValues) : 0;
      const furnitureHint =
        /this publication is available free of charge|tlp[:\s-]*clear|nist sp |page \d+ of \d+/i.test(text);
      const likelyFurnitureScore = Math.min(
        1,
        share * 0.7 + (ySpread < 40 ? 0.15 : 0) + (xSpread < 40 ? 0.1 : 0) + (furnitureHint ? 0.15 : 0),
      );
      return {
        text,
        pages: n,
        pageCount,
        share,
        yValues: row.yValues,
        xValues: row.xValues,
        heights: row.heights,
        likelyFurnitureScore,
      };
    })
    .filter((row) => row.pages >= 2)
    .sort((a, b) => b.share - a.share || b.likelyFurnitureScore - a.likelyFurnitureScore);
}

export function structureErrors(structure: DocumentStructure, document: NormalizedDocument): string[] {
  const errors: string[] = [];
  if (structure.sourceId !== document.sourceId) errors.push("sourceId mismatch");
  if (structure.contentHash !== document.contentHash) errors.push("contentHash mismatch");
  if (structure.parserVersion !== document.parserVersion) errors.push("parserVersion mismatch");
  if (structure.normalizerVersion !== document.normalizerVersion) errors.push("normalizerVersion mismatch");
  if (structure.structureVersion !== DOCUMENT_STRUCTURE_VERSION) {
    errors.push(`structureVersion ${structure.structureVersion} != ${DOCUMENT_STRUCTURE_VERSION}`);
  }
  const seenLineIds = new Set<string>();
  const seenRegionIds = new Set<string>();
  for (const page of structure.pages) {
    const source = document.pages.find((entry) => entry.pageNumber === page.pageNumber);
    if (!source) {
      errors.push(`structured page ${page.pageNumber} missing from document`);
      continue;
    }
    const itemIds = new Set(source.items.map((item) => item.itemIndex));
    const lineById = new Map(page.lines.map((line) => [line.id, line]));
    if (!Number.isFinite(page.width) || !Number.isFinite(page.height)) {
      errors.push(`page ${page.pageNumber} geometry is not finite`);
    }
    for (const line of page.lines) {
      if (seenLineIds.has(line.id)) errors.push(`duplicate line id ${line.id}`);
      seenLineIds.add(line.id);
      const expectedId = structureVisualLineId(structure.sourceId, page.pageNumber, line.ordinal);
      if (line.id !== expectedId) errors.push(`non-deterministic line id ${line.id}`);
      for (const itemIndex of line.itemIndexes) {
        if (!itemIds.has(itemIndex)) errors.push(`line ${line.id} references missing item ${itemIndex}`);
      }
      for (const key of ["x", "y", "width", "height", "left", "right", "top", "bottom"] as const) {
        if (!Number.isFinite(line[key])) errors.push(`line ${line.id} ${key} is not finite`);
      }
      if (line.left > line.right) errors.push(`line ${line.id} left > right`);
      if (line.bottom > line.top) errors.push(`line ${line.id} bottom > top`);
      const hasStart = line.normStart !== undefined;
      const hasEnd = line.normEnd !== undefined;
      if (hasStart !== hasEnd) errors.push(`line ${line.id} half-open norm range`);
      if (hasStart && hasEnd) {
        if (line.normStart! < 0 || line.normEnd! < 0) errors.push(`line ${line.id} negative norm range`);
        if (line.normStart! > line.normEnd!) errors.push(`line ${line.id} normStart > normEnd`);
        if (line.normEnd! > source.text.length) errors.push(`line ${line.id} normEnd past page.text`);
        const expected = mappedSliceForItems(source, line.itemIndexes);
        const got = source.text.slice(line.normStart, line.normEnd);
        if (expected !== null && expected !== got) {
          errors.push(`line ${line.id} slice does not match mapped segments`);
        }
      }
    }
    for (const region of page.regions) {
      if (seenRegionIds.has(region.id)) errors.push(`duplicate region id ${region.id}`);
      seenRegionIds.add(region.id);
      if (region.role !== "candidate") errors.push(`region ${region.id} is not marked candidate`);
      for (const lineId of region.lineIds) {
        if (!lineById.has(lineId)) errors.push(`region ${region.id} missing line ${lineId}`);
      }
    }
    const seenBlockIds = new Set<string>();
    const kindOrdinal = new Map<string, number>();
    const leafRanges: Array<{ id: string; start: number; end: number }> = [];
    for (const block of page.blocks) {
      if (seenBlockIds.has(block.id)) errors.push(`duplicate block id ${block.id}`);
      seenBlockIds.add(block.id);
      if (block.page !== page.pageNumber) errors.push(`block ${block.id} crosses pages`);
      const expectedOrdinal = kindOrdinal.get(block.kind) ?? 0;
      kindOrdinal.set(block.kind, expectedOrdinal + 1);
      if (block.id !== structureBlockId(structure.sourceId, page.pageNumber, block.kind, expectedOrdinal)) {
        errors.push(`non-deterministic block id ${block.id}`);
      }
      const hasStart = block.normStart !== undefined;
      const hasEnd = block.normEnd !== undefined;
      if (hasStart !== hasEnd) errors.push(`block ${block.id} half-open norm range`);
      if (hasStart && hasEnd) {
        if (block.normStart! < 0 || block.normEnd! < 0 || block.normStart! > block.normEnd!) {
          errors.push(`block ${block.id} invalid range`);
        }
        if (block.normEnd! > source.text.length) errors.push(`block ${block.id} range not page-local`);
        const got = source.text.slice(block.normStart, block.normEnd);
        const expected = mappedSliceForItems(source, block.itemIndexes);
        if (expected !== null && expected !== got) {
          errors.push(`block ${block.id} slice does not match mapped segments`);
        }
      }
      for (const lineId of block.lineIds) {
        if (!lineById.has(lineId)) errors.push(`block ${block.id} missing line ${lineId}`);
      }
      for (const itemIndex of block.itemIndexes) {
        if (!itemIds.has(itemIndex)) errors.push(`block ${block.id} missing item ${itemIndex}`);
      }
      if (block.parentBlockId) {
        const parent = page.blocks.find((entry) => entry.id === block.parentBlockId);
        if (!parent) errors.push(`block ${block.id} missing parent`);
        else if (parent.page !== block.page) errors.push(`block ${block.id} parent crosses pages`);
      }
      const regionKeys = new Set(
        block.lineIds
          .map((lineId) => lineById.get(lineId)?.left)
          .filter((left): left is number => left !== undefined)
          .map((left) => (page.regions.length >= 2 && page.width > 0
            ? left < page.width / 2 - 14
              ? "left"
              : left > page.width / 2 + 14
                ? "right"
                : "mid"
            : "page")),
      );
      if (block.kind !== "unknown" && regionKeys.has("left") && regionKeys.has("right")) {
        errors.push(`block ${block.id} merges cross-region lines`);
      }
      if ((LEAF_BLOCK_KINDS as readonly string[]).includes(block.kind) && hasStart && hasEnd) {
        leafRanges.push({ id: block.id, start: block.normStart!, end: block.normEnd! });
      }
    }
    leafRanges.sort((a, b) => a.start - b.start || a.end - b.end);
    for (let i = 1; i < leafRanges.length; i += 1) {
      if (leafRanges[i].start < leafRanges[i - 1].end) {
        errors.push(`leaf blocks ${leafRanges[i - 1].id} and ${leafRanges[i].id} overlap`);
      }
    }
  }
  return errors;
}

export function assertValidStructure(structure: DocumentStructure, document: NormalizedDocument) {
  const errors = structureErrors(structure, document);
  if (errors.length > 0) throw new Error(`structure invalid: ${errors.join("; ")}`);
}
