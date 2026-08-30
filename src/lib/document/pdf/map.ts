import type { InsertedSegment, MappedSegment, NormalizedPage, PdfTextItem, SourceSegment } from "../types.ts";

export type TextBuilder = {
  text: string;
  segments: MappedSegment[];
};

export function createTextBuilder(): TextBuilder {
  return { text: "", segments: [] };
}

export function appendSource(builder: TextBuilder, item: PdfTextItem, sourceStart: number, sourceEnd: number) {
  if (sourceEnd <= sourceStart) return;
  if (sourceStart < 0 || sourceEnd > item.str.length) return;
  const slice = item.str.slice(sourceStart, sourceEnd);
  if (!slice) return;
  const normStart = builder.text.length;
  builder.text += slice;
  const segment: SourceSegment = {
    kind: "source",
    itemIndex: item.itemIndex,
    sourceStart,
    sourceEnd,
    normStart,
    normEnd: builder.text.length,
    transform: item.transform,
    width: item.width,
    height: item.height,
  };
  builder.segments.push(segment);
}

export function appendInserted(builder: TextBuilder, inserted: InsertedSegment["inserted"]) {
  const ch = inserted === "space" ? " " : "\n";
  const normStart = builder.text.length;
  builder.text += ch;
  builder.segments.push({
    kind: "inserted",
    inserted,
    normStart,
    normEnd: builder.text.length,
  });
}

export function endsWithSoftHyphen(str: string): boolean {
  return /[A-Za-z]-$/.test(str);
}

export function startsLowerAlpha(str: string): boolean {
  return /^[a-z]/.test(str);
}

export function mappingErrors(page: Pick<NormalizedPage, "text" | "items" | "segments">): string[] {
  const errors: string[] = [];
  const { text, items, segments } = page;
  if (segments.length === 0) {
    if (text.length > 0) errors.push("uncovered text without segments");
    return errors;
  }
  const ordered = [...segments].sort((a, b) => a.normStart - b.normStart);
  if (ordered[0].normStart !== 0) errors.push("mapping does not start at 0");
  if (ordered[ordered.length - 1].normEnd !== text.length) errors.push("mapping does not cover text end");
  for (let i = 0; i < ordered.length; i += 1) {
    const segment = ordered[i];
    if (segment.normEnd <= segment.normStart) errors.push(`empty segment at ${segment.normStart}`);
    if (i > 0 && segment.normStart !== ordered[i - 1].normEnd) {
      errors.push(`gap or overlap at ${segment.normStart}`);
    }
    const slice = text.slice(segment.normStart, segment.normEnd);
    if (segment.kind === "inserted") {
      if ("itemIndex" in segment) errors.push("inserted segment has itemIndex");
      const expected = segment.inserted === "space" ? " " : "\n";
      if (slice !== expected) errors.push(`inserted ${segment.inserted} mismatch`);
      continue;
    }
    const item = items.find((entry) => entry.itemIndex === segment.itemIndex);
    if (!item) {
      errors.push(`missing item ${segment.itemIndex}`);
      continue;
    }
    if (segment.sourceStart < 0 || segment.sourceEnd > item.str.length || segment.sourceEnd <= segment.sourceStart) {
      errors.push(`invalid source range on item ${segment.itemIndex}`);
      continue;
    }
    if (item.str.slice(segment.sourceStart, segment.sourceEnd) !== slice) {
      errors.push(`source slice mismatch on item ${segment.itemIndex}`);
    }
  }
  const covered = new Array<number>(text.length).fill(0);
  for (const segment of ordered) {
    for (let i = segment.normStart; i < segment.normEnd; i += 1) covered[i] += 1;
  }
  if (covered.some((count) => count !== 1)) errors.push("normalized character is not covered by exactly one segment");
  return errors;
}

export function assertMappedCoverage(page: Pick<NormalizedPage, "text" | "items" | "segments">) {
  const errors = mappingErrors(page);
  if (errors.length > 0) throw new Error(`mapped coverage failed: ${errors.join("; ")}`);
}
