import assert from "node:assert/strict";
import { test } from "node:test";

import type { PdfTextItem } from "../../types.ts";
import { sourceRangesFromNormRange, supportTextFromNormRange } from "../../support-text.ts";
import { detectRepeatedBands } from "../headers.ts";
import { groupVisualLines } from "../layout.ts";
import { assertMappedCoverage, mappingErrors } from "../map.ts";
import { normalizePage } from "../normalize.ts";

function item(index: number, str: string, x: number, y: number, width = 40, height = 12): PdfTextItem {
  return { itemIndex: index, str, transform: [1, 0, 0, 1, x, y], width, height };
}

test("every normalized character belongs to exactly one mapped segment", () => {
  const page = normalizePage({
    pageNumber: 1,
    pageWidth: 612,
    pageHeight: 792,
    items: [item(0, "Serializable", 72, 700, 80), item(1, "isolation", 170, 700, 60)],
  });
  assert.equal(mappingErrors(page).length, 0);
  assertMappedCoverage(page);
  assert.match(page.text, /Serializable isolation/);
  const space = page.segments.find((segment) => segment.kind === "inserted");
  assert.equal(space?.inserted, "space");
  assert.equal("itemIndex" in (space ?? {}), false);
});

test("inserted newlines have no itemIndex", () => {
  const page = normalizePage({
    pageNumber: 1,
    pageWidth: 612,
    pageHeight: 792,
    items: [item(0, "First paragraph ends here.", 72, 700, 160), item(1, "Second paragraph starts.", 72, 640, 160)],
  });
  assert.equal(mappingErrors(page).length, 0);
  const newline = page.segments.find((segment) => segment.kind === "inserted" && segment.inserted === "newline");
  assert.ok(newline);
  assert.equal("itemIndex" in newline, false);
});

test("source segment ranges are valid against item.str", () => {
  const items = [item(0, "Hello", 72, 700, 40)];
  const page = normalizePage({ pageNumber: 1, pageWidth: 612, pageHeight: 792, items });
  for (const segment of page.segments) {
    if (segment.kind !== "source") continue;
    assert.ok(segment.sourceStart >= 0);
    assert.ok(segment.sourceEnd <= items[0].str.length);
    assert.equal(items[0].str.slice(segment.sourceStart, segment.sourceEnd), page.text.slice(segment.normStart, segment.normEnd));
  }
});

test("same-line visual gap inserts a space without mutating item.str", () => {
  const first = item(0, "serializable", 72, 700, 70);
  const second = item(1, "isolation", 200, 700, 50);
  const page = normalizePage({ pageNumber: 1, pageWidth: 612, pageHeight: 792, items: [first, second] });
  assert.equal(page.text, "serializable isolation");
  assert.equal(first.str, "serializable");
  assert.equal(second.str, "isolation");
  assert.ok(page.segments.some((segment) => segment.kind === "inserted" && segment.inserted === "space"));
});

test("visual x order wins when PDF.js item order is reversed", () => {
  const later = item(0, "isolation", 200, 700, 50);
  const earlier = item(1, "serializable", 72, 700, 70);
  const page = normalizePage({ pageNumber: 1, pageWidth: 612, pageHeight: 792, items: [later, earlier] });
  assert.equal(page.text, "serializable isolation");
  assert.equal(page.items[0].itemIndex, 0);
  assert.equal(page.items[1].itemIndex, 1);
});

test("safe dehyphenation joins wrap while raw item.str stays unchanged", () => {
  const first = item(0, "serial-", 72, 700, 40);
  const second = item(1, "izable", 72, 684, 40);
  const page = normalizePage({ pageNumber: 1, pageWidth: 612, pageHeight: 792, items: [first, second] });
  assert.equal(page.text, "serializable");
  assert.equal(first.str, "serial-");
  assert.equal(second.str, "izable");
  const hyphenSeg = page.segments.find(
    (segment) => segment.kind === "source" && segment.itemIndex === 0,
  );
  assert.ok(hyphenSeg && hyphenSeg.kind === "source");
  assert.equal(first.str.slice(hyphenSeg.sourceStart, hyphenSeg.sourceEnd), "serial");
  const support = supportTextFromNormRange(page, 0, page.text.length);
  assert.equal(support, "serializable");
  const ranges = sourceRangesFromNormRange(page, 0, page.text.length);
  assert.ok(ranges);
  assert.equal(ranges.length, 2);
  assert.equal(first.str.slice(ranges[0].sourceStart, ranges[0].sourceEnd), "serial");
  assert.equal(second.str.slice(ranges[1].sourceStart, ranges[1].sourceEnd), "izable");
});

test("ligatures are not speculatively rewritten", () => {
  const ligature = item(0, "ﬁle", 72, 700, 20);
  const expanded = item(2, "file", 72, 680, 20);
  const page = normalizePage({
    pageNumber: 1,
    pageWidth: 612,
    pageHeight: 792,
    items: [ligature, expanded],
  });
  assert.match(page.text, /ﬁle/);
  assert.match(page.text, /file/);
  assert.equal(ligature.str, "ﬁle");
  assert.equal(expanded.str, "file");
});

test("clear single-column pages index as full prose", () => {
  const page = normalizePage({
    pageNumber: 1,
    pageWidth: 612,
    pageHeight: 792,
    items: [
      item(0, "Serializable isolation prevents lost outcomes.", 72, 700, 240),
      item(1, "The lock manager waits for the older transaction.", 72, 682, 240),
    ],
  });
  assert.equal(page.readingOrder, "single-column");
  assert.equal(page.index, "full");
  assert.match(page.text, /Serializable isolation/);
});

test("clear two-column pages read left then right", () => {
  const items = [
    item(0, "Left column first sentence is here.", 72, 700, 180),
    item(1, "Left column second sentence follows.", 72, 682, 180),
    item(2, "Left column third sentence remains.", 72, 664, 180),
    item(3, "Right column first sentence is here.", 340, 700, 180),
    item(4, "Right column second sentence follows.", 340, 682, 180),
    item(5, "Right column third sentence remains.", 340, 664, 180),
  ];
  const page = normalizePage({ pageNumber: 1, pageWidth: 612, pageHeight: 792, items });
  assert.equal(page.readingOrder, "two-column");
  assert.equal(page.index, "full");
  const leftAt = page.text.indexOf("Left column first");
  const rightAt = page.text.indexOf("Right column first");
  assert.ok(leftAt >= 0 && rightAt > leftAt);
  assert.ok(typeof page.columnBreakOffset === "number");
  assert.ok(page.columnBreakOffset > leftAt);
  assert.ok(page.columnBreakOffset <= rightAt);
  assert.equal(page.text[page.columnBreakOffset ?? -1], "\n");
});

test("indented bullets stay single-column", () => {
  const items = [
    item(0, "The isolation levels are:", 72, 700, 160),
    item(1, "read uncommitted", 90, 680, 100),
    item(2, "read committed", 90, 662, 100),
    item(3, "repeatable read", 90, 644, 100),
    item(4, "serializable", 90, 626, 80),
  ];
  const page = normalizePage({ pageNumber: 1, pageWidth: 612, pageHeight: 792, items });
  assert.equal(page.readingOrder, "single-column");
  assert.match(page.text, /The isolation levels are/);
});

test("a page number sidebar does not become two-column", () => {
  const items = [
    item(0, "CS 186 · Fall", 72, 760, 80),
    item(1, "1", 500, 40, 10),
    item(2, "Locking is the default concurrency mechanism in this course.", 72, 700, 240),
    item(3, "The rest of the lecture stays in one column on the left.", 72, 682, 240),
  ];
  const page = normalizePage({ pageNumber: 1, pageWidth: 612, pageHeight: 792, items });
  assert.equal(page.readingOrder, "single-column");
  assert.match(page.text, /Locking is the default/);
});

test("a wide left-column line that crosses mid still stays in the left column", () => {
  const items = [
    item(0, "Two-phase locking requires waits on conflicting writes before", 72, 700, 323),
    item(1, "the lock point.", 72, 684, 74),
    item(2, "Snapshot isolation allows write skew unless extra checks.", 340, 700, 220),
    item(3, "Further right-column prose remains on that side.", 340, 684, 220),
  ];
  const page = normalizePage({ pageNumber: 1, pageWidth: 612, pageHeight: 792, items });
  assert.equal(page.readingOrder, "two-column");
  assert.ok(typeof page.columnBreakOffset === "number");
  const breakAt = page.columnBreakOffset ?? 0;
  const left = page.text.slice(0, breakAt);
  const right = page.text.slice(breakAt + 1);
  assert.match(left, /Two-phase locking/);
  assert.match(left, /the lock point/);
  assert.equal(left.includes("Snapshot"), false);
  assert.match(right, /Snapshot isolation/);
  assert.equal(right.includes("lock point"), false);
  assert.equal(page.text.includes("beforeSnapshot"), false);
  assert.equal(mappingErrors(page).length, 0);
  assertMappedCoverage(page);
});

test("uncertain pages do not become stream prose", () => {
  const items = [
    item(0, "Alpha token", 40, 700, 40),
    item(1, "Beta token", 400, 690, 40),
    item(2, "Gamma token", 80, 500, 40),
    item(3, "Delta token", 420, 480, 40),
  ];
  const page = normalizePage({ pageNumber: 1, pageWidth: 612, pageHeight: 792, items });
  assert.equal(page.readingOrder, "uncertain");
  assert.notEqual(page.index, "full");
  assert.equal(page.text.includes("Alpha token Beta token Gamma token Delta token"), false);
});

test("dense grid pages are not flattened into a prose paragraph", () => {
  const items: PdfTextItem[] = [];
  let index = 0;
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      items.push(item(index, `${row}.${col}`, 80 + col * 80, 700 - row * 20, 24));
      index += 1;
    }
  }
  const page = normalizePage({ pageNumber: 1, pageWidth: 612, pageHeight: 792, items });
  assert.equal(page.index, "skipped");
  assert.equal(page.text, "");
  assert.equal(page.items.length, 20);
});

test("repeated headers are excluded from searchable text and kept in raw items", () => {
  const header = () => item(0, "CS401 Lecture Notes", 72, 770, 140);
  const body = (label: string) => item(1, label, 72, 700, 200);
  const pages = [1, 2, 3].map((pageNumber) => {
    const items = [header(), body(`Body sentence on page ${pageNumber} is unique.`)];
    return { height: 792, lines: groupVisualLines(items), items };
  });
  const skip = detectRepeatedBands(pages);
  assert.ok([...skip].some((key) => key.includes("CS401 Lecture Notes")));
  const page = normalizePage({
    pageNumber: 1,
    pageWidth: 612,
    pageHeight: 792,
    items: pages[0].items,
    skipBands: skip,
  });
  assert.equal(page.text.includes("CS401 Lecture Notes"), false);
  assert.match(page.text, /Body sentence on page 1/);
  assert.equal(page.items.some((entry) => entry.str === "CS401 Lecture Notes"), true);
});

test("a repeated body sentence at different y is not treated as a header", () => {
  const pages = [700, 500, 300].map((y) => ({
    height: 792,
    lines: groupVisualLines([item(0, "Serializable isolation is required.", 72, y, 200)]),
    items: [item(0, "Serializable isolation is required.", 72, y, 200)],
  }));
  const skip = detectRepeatedBands(pages);
  assert.equal(skip.size, 0);
});
