import type { MappedSegment, NormalizedPage, SourceSegment } from "./types.ts";

/**
 * Deterministic support surface for a normalized slice. This is page.text —
 * inserted spaces, newlines, and safe dehyphenation already applied.
 * 4A.4 will attach this to DocumentEvidence.supportText. 4A.2 does not speak.
 */
export function supportTextFromNormRange(
  page: NormalizedPage,
  normStart: number,
  normEnd: number,
): string | null {
  if (normStart < 0 || normEnd > page.text.length || normEnd <= normStart) return null;
  if (!rangeCoveredBySegments(page.segments, normStart, normEnd)) return null;
  return page.text.slice(normStart, normEnd);
}

/** Source-backed item ranges overlapping a normalized slice. Inserted chars are skipped. */
export function sourceRangesFromNormRange(
  page: NormalizedPage,
  normStart: number,
  normEnd: number,
): SourceSegment[] | null {
  if (normStart < 0 || normEnd > page.text.length || normEnd <= normStart) return null;
  const hits: SourceSegment[] = [];
  for (const segment of page.segments) {
    if (segment.kind !== "source") continue;
    if (segment.normEnd <= normStart || segment.normStart >= normEnd) continue;
    const overlapStart = Math.max(segment.normStart, normStart);
    const overlapEnd = Math.min(segment.normEnd, normEnd);
    const srcStart = segment.sourceStart + (overlapStart - segment.normStart);
    const srcEnd = segment.sourceEnd - (segment.normEnd - overlapEnd);
    hits.push({ ...segment, sourceStart: srcStart, sourceEnd: srcEnd, normStart: overlapStart, normEnd: overlapEnd });
  }
  return hits;
}

export function rangeCoveredBySegments(segments: MappedSegment[], start: number, end: number): boolean {
  let cursor = start;
  const ordered = [...segments].sort((a, b) => a.normStart - b.normStart);
  for (const segment of ordered) {
    if (segment.normEnd <= start || segment.normStart >= end) continue;
    if (segment.normStart > cursor) return false;
    cursor = Math.max(cursor, segment.normEnd);
    if (cursor >= end) return true;
  }
  return cursor >= end;
}
