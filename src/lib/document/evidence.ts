import type { DocumentEvidence } from "../search/evidence.ts";
import { sourceRangesFromNormRange, supportTextFromNormRange } from "./support-text.ts";
import { reconstructSourceText } from "./source-text.ts";
import type { DocumentItemRange, NormalizedDocument, NormalizedPage } from "./types.ts";

export function documentEvidenceId(
  sourceId: string,
  contentHash: string,
  page: number,
  normStart: number,
  normEnd: number,
): string {
  return `${sourceId}@${contentHash}:p${page}:${normStart}-${normEnd}`;
}

/**
 * Map a page-normalized claim range onto PDF items. Fail closed.
 * Inserted segments are never source identity.
 *
 * DocumentStructure / DocumentBlock / VisualLine ids are derived layout
 * helpers. They are never provenance. A Card must cite itemRanges, not a block id.
 */
export function documentEvidenceFromRange(args: {
  document: NormalizedDocument;
  page: number;
  normStart: number;
  normEnd: number;
  spokenText: string;
}): DocumentEvidence | null {
  const { document, page: pageNumber, normStart, normEnd, spokenText } = args;
  if (!spokenText.trim()) return null;
  const page = document.pages.find((entry) => entry.pageNumber === pageNumber);
  if (!page) return null;
  if (normStart < 0 || normEnd > page.text.length || normEnd <= normStart) return null;
  const sliced = page.text.slice(normStart, normEnd);
  if (!sliced.trim()) return null;
  const sources = sourceRangesFromNormRange(page, normStart, normEnd);
  if (!sources || sources.length === 0) return null;
  const supportText = supportTextFromNormRange(page, normStart, normEnd);
  if (supportText === null || supportText !== sliced) return null;
  const itemRanges = itemRangesFromSources(page, sources);
  if (itemRanges.length === 0) return null;
  const sourceText = reconstructSourceText(document, itemRanges);
  if (sourceText === null || sourceText.length === 0) return null;
  const heading = resolvedHeading(document, pageNumber);
  return {
    kind: "document",
    id: documentEvidenceId(document.sourceId, document.contentHash, pageNumber, normStart, normEnd),
    sourceId: document.sourceId,
    sourceType: "pdf",
    path: document.path,
    page: pageNumber,
    sourceText,
    supportText,
    spokenText,
    contentHash: document.contentHash,
    parserVersion: document.parserVersion,
    normalizerVersion: document.normalizerVersion,
    itemRanges,
    heading,
  };
}

function itemRangesFromSources(
  page: NormalizedPage,
  sources: Array<{ itemIndex: number; sourceStart: number; sourceEnd: number }>,
): DocumentItemRange[] {
  const ranges: DocumentItemRange[] = [];
  for (const source of sources) {
    const item = page.items.find((entry) => entry.itemIndex === source.itemIndex);
    if (!item) return [];
    if (source.sourceStart < 0 || source.sourceEnd > item.str.length || source.sourceEnd <= source.sourceStart) {
      return [];
    }
    ranges.push({
      page: page.pageNumber,
      itemIndex: source.itemIndex,
      charStart: source.sourceStart,
      charEnd: source.sourceEnd,
    });
  }
  return ranges;
}

function resolvedHeading(document: NormalizedDocument, page: number): string | undefined {
  const hit = document.outline.find((item) => item.page === page && item.title.trim());
  return hit?.title.trim() || undefined;
}
