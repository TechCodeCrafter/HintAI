import type { NormalizedPage, PageIndexMode, PageReadingOrder, PdfTextItem } from "../types.ts";
import { bandKey } from "./headers.ts";
import { usefulItemCount } from "./items.ts";
import {
  classifyGridKind,
  detectReadingOrder,
  isParagraphBreak,
  isTableLikeGrid,
  lineIsUsable,
  shouldInsertSpace,
  type VisualLine,
  visualLineText,
} from "./layout.ts";
import {
  appendInserted,
  appendSource,
  createTextBuilder,
  endsWithSoftHyphen,
  startsLowerAlpha,
  type TextBuilder,
} from "./map.ts";

export function normalizePage(input: {
  pageNumber: number;
  items: PdfTextItem[];
  pageWidth: number;
  pageHeight: number;
  skipBands?: Set<string>;
}): NormalizedPage {
  const items = input.items;
  const useful = usefulItemCount(items);
  if (useful === 0) {
    return emptyPage(input.pageNumber, items, "uncertain", "skipped", 0);
  }
  if (isTableLikeGrid(items)) {
    return emptyPage(input.pageNumber, items, "uncertain", "skipped", useful);
  }

  const layout = detectReadingOrder(items, input.pageWidth);
  const skip = input.skipBands ?? new Set<string>();
  const usableLines = (lines: VisualLine[]) =>
    lines.filter((line) => {
      const key = bandKey(line, input.pageHeight);
      return !key || !skip.has(key);
    });

  if (layout.readingOrder === "two-column") {
    const left = usableLines(layout.left);
    const right = usableLines(layout.right);
    const builder = createTextBuilder();
    appendColumn(builder, left, true);
    let columnBreakOffset: number | undefined;
    if (builder.text && right.length > 0) {
      columnBreakOffset = builder.text.length;
      appendInserted(builder, "newline");
    }
    appendColumn(builder, right, true);
    return finish(input.pageNumber, items, builder, "two-column", "full", useful, columnBreakOffset);
  }

  const lines = usableLines(layout.lines);
  if (layout.readingOrder === "uncertain") {
    // Isolated math crumbs retrieve as fake answers. 4A.9.3 owns math blocks.
    if (classifyGridKind(items) === "math") {
      return emptyPage(input.pageNumber, items, "uncertain", "skipped", useful);
    }
    const isolated = lines.filter((line) => lineIsUsable(visualLineText(line)));
    if (isolated.length === 0) {
      return emptyPage(input.pageNumber, items, "uncertain", "skipped", useful);
    }
    const builder = createTextBuilder();
    appendColumn(builder, isolated, false);
    return finish(input.pageNumber, items, builder, "uncertain", "isolated-lines", useful);
  }

  const builder = createTextBuilder();
  appendColumn(builder, lines, true);
  const index: PageIndexMode = builder.text.trim() ? "full" : "skipped";
  return finish(input.pageNumber, items, builder, "single-column", index, useful);
}

function emptyPage(
  pageNumber: number,
  items: PdfTextItem[],
  readingOrder: PageReadingOrder,
  index: PageIndexMode,
  useful: number,
): NormalizedPage {
  return {
    pageNumber,
    text: "",
    items,
    segments: [],
    readingOrder,
    usefulItemCount: useful,
    index,
  };
}

function finish(
  pageNumber: number,
  items: PdfTextItem[],
  builder: TextBuilder,
  readingOrder: PageReadingOrder,
  index: PageIndexMode,
  useful: number,
  columnBreakOffset?: number,
): NormalizedPage {
  return {
    pageNumber,
    text: builder.text,
    items,
    segments: builder.segments,
    readingOrder,
    usefulItemCount: useful,
    index,
    columnBreakOffset,
  };
}

function appendColumn(builder: TextBuilder, lines: VisualLine[], joinWrapped: boolean) {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const next = lines[i + 1];
    const dehyphenate =
      joinWrapped &&
      next &&
      !isParagraphBreak(line, next) &&
      line.items.length > 0 &&
      next.items.length > 0 &&
      endsWithSoftHyphen(line.items[line.items.length - 1].str) &&
      startsLowerAlpha(next.items[0].str);
    appendLine(builder, line, dehyphenate);
    if (!next) continue;
    if (!joinWrapped || isParagraphBreak(line, next)) {
      if (builder.text && !builder.text.endsWith("\n")) appendInserted(builder, "newline");
    } else if (!dehyphenate && !builder.text.endsWith(" ") && !builder.text.endsWith("\n")) {
      appendInserted(builder, "space");
    }
  }
}

function appendLine(builder: TextBuilder, line: VisualLine, dropFinalHyphen: boolean) {
  for (let i = 0; i < line.items.length; i += 1) {
    const item = line.items[i];
    const next = line.items[i + 1];
    const dropHyphen = dropFinalHyphen && !next && endsWithSoftHyphen(item.str);
    const end = dropHyphen ? item.str.length - 1 : item.str.length;
    appendSource(builder, item, 0, end);
    if (next && shouldInsertSpace(item, next)) appendInserted(builder, "space");
  }
}
