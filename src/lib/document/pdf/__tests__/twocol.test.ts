import assert from "node:assert/strict";
import { test } from "node:test";

import { DOCUMENT_NORMALIZER_VERSION } from "../../../context/index-versions.ts";
import { buildDocumentChunks } from "../../chunk.ts";
import { reconstructSourceText } from "../../source-text.ts";
import { documentEvidenceFromRange } from "../../evidence.ts";
import { EVAL_PDF_FIXTURES } from "../eval-fixtures.ts";
import { parsePdf } from "../parse.ts";
import { assertMappedCoverage, mappingErrors } from "../map.ts";
import { normalizePage } from "../normalize.ts";
import type { PdfTextItem } from "../../types.ts";

function blobFrom(bytes: Uint8Array): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: "application/pdf" });
}

function item(index: number, str: string, x: number, y: number, width = 40, height = 12): PdfTextItem {
  return { itemIndex: index, str, transform: [1, 0, 0, 1, x, y], width, height };
}

test("paper.pdf two-column fixture is classified and split, not smashed", async () => {
  const result = await parsePdf({
    contextId: "twocol",
    sourceId: "paper.pdf",
    path: "paper.pdf",
    contentHash: "paper.pdf",
    blob: blobFrom(EVAL_PDF_FIXTURES["paper.pdf"]),
  });
  assert.equal(result.document.normalizerVersion, DOCUMENT_NORMALIZER_VERSION);
  const page = result.document.pages[0];
  assert.ok(page);
  assert.equal(page.readingOrder, "two-column");
  assert.equal(typeof page.columnBreakOffset, "number");
  const br = page.columnBreakOffset ?? 0;
  assert.ok(br > 0 && br < page.text.length);
  assert.equal(page.text[br], "\n");
  const left = page.text.slice(0, br);
  const right = page.text.slice(br + 1);
  assert.match(left, /Two-phase locking/);
  assert.match(left, /lock point/);
  assert.match(right, /Snapshot isolation/);
  assert.ok(left.indexOf("Two-phase") < left.indexOf("lock point") || left.includes("lock point"));
  assert.equal(left.includes("Snapshot"), false);
  assert.equal(right.includes("Two-phase"), false);
  assert.equal(page.text.includes("beforeSnapshot"), false);
  assert.equal(page.text.includes("extra ch the lock point"), false);
  assert.equal(mappingErrors(page).length, 0);
  assertMappedCoverage(page);

  const chunks = buildDocumentChunks(result.document);
  assert.ok(chunks.length >= 2);
  assert.equal(
    chunks.some((chunk) => chunk.startOffset < br && chunk.endOffset > br),
    false,
  );
  assert.equal(
    chunks.some((chunk) => chunk.text.includes("Two-phase") && chunk.text.includes("Snapshot")),
    false,
  );

  const spoken = "Two-phase locking requires waits on conflicting writes before the lock point.";
  const start = page.text.indexOf("Two-phase locking");
  const end = page.text.indexOf("lock point.") + "lock point.".length;
  const evidence = documentEvidenceFromRange({
    document: result.document,
    page: 1,
    normStart: start,
    normEnd: end,
    spokenText: spoken,
  });
  assert.ok(evidence);
  assert.equal(reconstructSourceText(result.document, evidence.itemRanges), evidence.sourceText);
});

test("dense grid never becomes two-column prose", () => {
  const items: PdfTextItem[] = [];
  let index = 0;
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      items.push(item(index, `c${index}`, 72 + (col % 4) * 80, 700 - row * 24, 24));
      index += 1;
    }
  }
  const page = normalizePage({ pageNumber: 1, pageWidth: 612, pageHeight: 792, items });
  assert.equal(page.index, "skipped");
  assert.notEqual(page.readingOrder, "two-column");
  assert.equal(page.text, "");
});

test("ambiguous scattered tokens stay uncertain, not two-column stream", () => {
  const items = [
    item(0, "Alpha token", 40, 700, 40),
    item(1, "Beta token", 400, 690, 40),
    item(2, "Gamma token", 80, 500, 40),
    item(3, "Delta token", 420, 480, 40),
  ];
  const page = normalizePage({ pageNumber: 1, pageWidth: 612, pageHeight: 792, items });
  assert.equal(page.readingOrder, "uncertain");
  assert.notEqual(page.index, "full");
  assert.equal(page.text.includes("Alpha token Beta token"), false);
});
