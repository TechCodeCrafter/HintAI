import type { DocumentItemRange, NormalizedDocument, NormalizedPage } from "./types.ts";

/**
 * Verbatim concat of the cited item slices. Inserted spaces/newlines are not
 * in this string — they never lived on a PDF item.
 */
export function reconstructSourceText(
  document: NormalizedDocument,
  ranges: DocumentItemRange[],
): string | null {
  const parts: string[] = [];
  for (const range of ranges) {
    const page = document.pages.find((entry) => entry.pageNumber === range.page);
    if (!page) return null;
    const slice = sliceItem(page, range.itemIndex, range.charStart, range.charEnd);
    if (slice === null) return null;
    parts.push(slice);
  }
  return parts.join("");
}

/**
 * Reconstruct raw evidence text from cached items on one page. Does not reparse.
 */
export function sourceTextFromRanges(
  document: NormalizedDocument,
  page: number,
  ranges: Array<{ itemIndex: number; charStart: number; charEnd: number }>,
): string | null {
  return reconstructSourceText(
    document,
    ranges.map((range) => ({ page, ...range })),
  );
}

function sliceItem(
  page: NormalizedPage,
  itemIndex: number,
  charStart: number,
  charEnd: number,
): string | null {
  const item = page.items.find((entry) => entry.itemIndex === itemIndex);
  if (!item) return null;
  if (charStart < 0 || charEnd > item.str.length || charEnd <= charStart) return null;
  return item.str.slice(charStart, charEnd);
}
