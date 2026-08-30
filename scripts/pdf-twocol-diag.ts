/**
 * Phase 4A.4.1 diagnostic — paper.pdf two-column misclassification.
 * Read-only. Does not write eval artifacts used by 4A.3/4A.4.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { buildDocumentChunks } from "../src/lib/document/chunk.ts";
import { EVAL_PDF_FIXTURES } from "../src/lib/document/pdf/eval-fixtures.ts";
import { itemRight, itemX, itemY } from "../src/lib/document/pdf/items.ts";
import { detectReadingOrder, groupVisualLines, shouldInsertSpace } from "../src/lib/document/pdf/layout.ts";
import { parsePdf } from "../src/lib/document/pdf/parse.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const TWO_COL_MIN_LINES = 3;
const TWO_COL_GUTTER = 28;

function blobFrom(bytes: Uint8Array): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: "application/pdf" });
}

const result = await parsePdf({
  contextId: "diag",
  sourceId: "paper.pdf",
  path: "paper.pdf",
  contentHash: "paper.pdf",
  blob: blobFrom(EVAL_PDF_FIXTURES["paper.pdf"]),
});

const page = result.document.pages[0];
if (!page) throw new Error("paper.pdf has no page");
const width = 612;
const mid = width / 2;
const items = page.items.map((item) => ({
  itemIndex: item.itemIndex,
  str: item.str,
  x: itemX(item),
  y: itemY(item),
  width: item.width,
  height: item.height,
  right: itemRight(item),
  crossesMid: itemRight(item) >= mid - TWO_COL_GUTTER / 2 && itemX(item) <= mid + TWO_COL_GUTTER / 2,
}));

const leftItems = page.items.filter((item) => itemRight(item) < mid - TWO_COL_GUTTER / 2);
const rightItems = page.items.filter((item) => itemX(item) > mid + TWO_COL_GUTTER / 2);
const midItems = page.items.filter((item) => {
  const x = itemX(item);
  return x >= mid - TWO_COL_GUTTER / 2 && x <= mid + TWO_COL_GUTTER / 2;
});
const visualLines = groupVisualLines(page.items);
const layout = detectReadingOrder(page.items, width);
const leftLines = groupVisualLines(leftItems);
const rightLines = groupVisualLines(rightItems);

const sameLineJoins = visualLines.flatMap((line) => {
  const joins = [];
  for (let i = 0; i < line.items.length - 1; i += 1) {
    const prev = line.items[i];
    const next = line.items[i + 1];
    joins.push({
      from: prev.str,
      to: next.str,
      gap: itemX(next) - itemRight(prev),
      insertsSpace: shouldInsertSpace(prev, next),
      smash: `${prev.str}${next.str}`,
    });
  }
  return joins;
});

const report = {
  phase: "4A.4.1",
  pageWidth: width,
  mid,
  gutterHalf: TWO_COL_GUTTER / 2,
  current: {
    readingOrder: page.readingOrder,
    index: page.index,
    columnBreakOffset: page.columnBreakOffset ?? null,
    pageText: page.text,
  },
  classifier: {
    twoColMinLines: TWO_COL_MIN_LINES,
    leftItemCount: leftItems.length,
    rightItemCount: rightItems.length,
    midItemCount: midItems.length,
    leftLineCount: leftLines.length,
    rightLineCount: rightLines.length,
    leftLineNeed: TWO_COL_MIN_LINES,
    itemsCrossingMid: items.filter((item) => item.crossesMid).map((item) => item.itemIndex),
    detected: layout.readingOrder,
    whyNotTwoColumn: [
      leftLines.length < TWO_COL_MIN_LINES ? `left visual lines ${leftLines.length} < ${TWO_COL_MIN_LINES}` : null,
      rightLines.length < TWO_COL_MIN_LINES ? `right visual lines ${rightLines.length} < ${TWO_COL_MIN_LINES}` : null,
      leftItems.length === 0 ? "no items with itemRight entirely left of mid-gutter" : null,
      rightItems.length === 0 ? "no items with itemX entirely right of mid-gutter" : null,
    ].filter(Boolean),
  },
  items,
  visualLines: visualLines.map((line, index) => ({
    index,
    y: line.y,
    height: line.height,
    itemIndexes: line.items.map((item) => item.itemIndex),
    strs: line.items.map((item) => item.str),
    firstX: itemX(line.items[0]),
    lastX: itemX(line.items[line.items.length - 1]),
  })),
  sameLineJoins,
  chunks: buildDocumentChunks(result.document).map((chunk) => ({
    id: chunk.id,
    startOffset: chunk.startOffset,
    endOffset: chunk.endOffset,
    text: chunk.text,
  })),
};

writeFileSync(`${ROOT}.eval/phase4a/twocol-diag.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.classifier, null, 2));
console.log("readingOrder", page.readingOrder, "columnBreak", page.columnBreakOffset);
console.log("page.text", JSON.stringify(page.text));
console.log("items", items);
console.log("visualLines", report.visualLines);
console.log("joins", sameLineJoins);
