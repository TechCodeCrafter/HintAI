import assert from "node:assert/strict";
import { test } from "node:test";

import { DOCUMENT_NORMALIZER_VERSION, DOCUMENT_STRUCTURE_VERSION } from "../../context/index-versions.ts";
import { buildDocumentChunks } from "../chunk.ts";
import { documentEvidenceFromRange } from "../evidence.ts";
import { EVAL_PDF_FIXTURES } from "../pdf/eval-fixtures.ts";
import { mappingErrors } from "../pdf/map.ts";
import { normalizePage } from "../pdf/normalize.ts";
import { parsePdf } from "../pdf/parse.ts";
import { pdfjsDocumentOpenCount, resetPdfjsDocumentOpenCount } from "../pdf/pdfjs.ts";
import { reconstructSourceText } from "../source-text.ts";
import { assertValidStructure, deriveDocumentStructure, structureVisualLineId } from "../structure.ts";
import type { NormalizedDocument, PdfTextItem } from "../types.ts";

function blobFrom(bytes: Uint8Array): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: "application/pdf" });
}

function item(index: number, str: string, x: number, y: number, width = 40, height = 12): PdfTextItem {
  return { itemIndex: index, str, transform: [1, 0, 0, 1, x, y], width, height };
}

function pageDoc(items: PdfTextItem[], extras?: { width?: number; height?: number }): NormalizedDocument {
  const page = normalizePage({
    pageNumber: 1,
    items,
    pageWidth: extras?.width ?? 612,
    pageHeight: extras?.height ?? 792,
  });
  return {
    contextId: "ctx-struct",
    sourceId: "src-struct",
    path: "struct.pdf",
    contentHash: "hash-struct",
    type: "pdf",
    parserVersion: 1,
    normalizerVersion: DOCUMENT_NORMALIZER_VERSION,
    pageCount: 1,
    outline: [],
    pages: [page],
    readiness: "ready",
  };
}

function snapChunks(document: NormalizedDocument) {
  return buildDocumentChunks(document).map((chunk) => ({
    id: chunk.id,
    page: chunk.page,
    startOffset: chunk.startOffset,
    endOffset: chunk.endOffset,
    text: chunk.text,
    readingOrder: chunk.readingOrder,
    heading: chunk.heading,
    contentHash: chunk.contentHash,
  }));
}

test("same document yields deterministic VisualLine and region ids", () => {
  const document = pageDoc([
    item(0, "Serializable isolation prevents lost outcomes.", 72, 700, 220),
    item(1, "Two-phase locking requires waits.", 72, 680, 180),
  ]);
  const first = deriveDocumentStructure(document, { pageSize: { 1: { width: 612, height: 792 } } });
  const second = deriveDocumentStructure(document, { pageSize: { 1: { width: 612, height: 792 } } });
  assert.equal(first.structureVersion, DOCUMENT_STRUCTURE_VERSION);
  assert.deepEqual(
    first.pages[0].lines.map((line) => line.id),
    second.pages[0].lines.map((line) => line.id),
  );
  assert.deepEqual(
    first.pages[0].regions.map((region) => region.id),
    second.pages[0].regions.map((region) => region.id),
  );
  assert.equal(first.pages[0].lines[0].id, structureVisualLineId("src-struct", 1, 0));
});

test("VisualLine itemIndexes are real PDF.js indexes and are never renumbered", () => {
  const later = item(0, "isolation", 200, 700, 50);
  const earlier = item(1, "serializable", 72, 700, 70);
  const document = pageDoc([later, earlier]);
  const structure = deriveDocumentStructure(document, { pageSize: { 1: { width: 612, height: 792 } } });
  assertValidStructure(structure, document);
  assert.equal(document.pages[0].items[0].itemIndex, 0);
  assert.equal(document.pages[0].items[1].itemIndex, 1);
  const line = structure.pages[0].lines[0];
  assert.deepEqual(line.itemIndexes, [1, 0]);
  for (const itemIndex of line.itemIndexes) {
    assert.ok(document.pages[0].items.some((entry) => entry.itemIndex === itemIndex));
  }
});

test("VisualLine norm range is the mapped slice, not a text search", () => {
  const document = pageDoc([item(0, "Serializable", 72, 700, 80), item(1, "isolation", 170, 700, 60)]);
  const page = document.pages[0];
  assert.equal(mappingErrors(page).length, 0);
  const structure = deriveDocumentStructure(document, { pageSize: { 1: { width: 612, height: 792 } } });
  const line = structure.pages[0].lines[0];
  assert.equal(typeof line.normStart, "number");
  assert.equal(typeof line.normEnd, "number");
  assert.equal(page.text.slice(line.normStart, line.normEnd), "Serializable isolation");
  assert.ok(Number.isFinite(line.left) && line.left < line.right);
  assert.ok(line.bottom <= line.top);
});

test("PDF user-space geometry: y-up, origin bottom-left", () => {
  const document = pageDoc([item(0, "Higher line", 72, 700, 80, 12), item(1, "Lower line", 72, 640, 80, 12)]);
  const structure = deriveDocumentStructure(document, { pageSize: { 1: { width: 612, height: 792 } } });
  const [higher, lower] = structure.pages[0].lines;
  assert.ok(higher.y > lower.y);
  assert.ok(higher.top > lower.top);
});

test("Attention-style overflow is never false single-column and never same-line joined", () => {
  const left = item(0, "Recurrent models typically factor computation along the input", 108, 700, 396, 10);
  const right = item(1, "decoder stack.", 340, 700, 80, 10);
  const document = pageDoc([left, right]);
  const page = document.pages[0];
  assert.notEqual(page.readingOrder, "single-column");
  assert.equal(page.text.includes("input decoder"), false);
  assert.equal(page.text.includes("inputdecoder"), false);
  const structure = deriveDocumentStructure(document, { pageSize: { 1: { width: 612, height: 792 } } });
  assert.equal(page.readingOrder, structure.pages[0].diagnostics.readingOrder);
  assert.equal(structure.pages[0].diagnostics.crossGutterRisk, true);
  assert.ok(structure.pages[0].diagnostics.widthDistrust);
});

test("BERT-like extra x clusters still show two dominant prose candidates", () => {
  const items: PdfTextItem[] = [];
  let index = 0;
  for (let row = 0; row < 8; row += 1) {
    items.push(item(index, "The pretraining objective uses bidirectional context in every layer.", 72, 700 - row * 16, 200));
    index += 1;
    items.push(item(index, "Fine-tuning then reuses the same parameters for each downstream task.", 320, 700 - row * 16, 200));
    index += 1;
  }
  items.push(item(index, "See appendix C for the ablation details.", 190, 690, 90));
  items.push(item(index + 1, "More appendix notes sit in this gutter.", 190, 674, 90));
  items.push(item(index + 2, "Cited as Devlin et al. in the margin.", 430, 690, 90));
  items.push(item(index + 3, "Second margin cite continues the same rail.", 430, 674, 90));
  const document = pageDoc(items);
  const structure = deriveDocumentStructure(document, { pageSize: { 1: { width: 612, height: 792 } } });
  assert.ok(structure.pages[0].diagnostics.regionCandidates.length > 2);
  assert.equal(structure.pages[0].diagnostics.twoDominantProse, true);
  assert.equal(structure.pages[0].diagnostics.readingOrder, document.pages[0].readingOrder);
  assert.equal(document.pages[0].readingOrder, "two-column");
  assert.equal(mappingErrors(document.pages[0]).length, 0);
});

test("aligned lecture math is not skipped as a dense table", () => {
  const items: PdfTextItem[] = [];
  let index = 0;
  for (let row = 0; row < 6; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      items.push(item(index, `x${index}`, 72 + col * 80, 700 - row * 20, 16));
      index += 1;
    }
  }
  const lecture = [
    "Linear regression estimates a hypothesis from labeled training examples.",
    "The normal equations solve for theta when the design matrix has full rank.",
    "Gradient descent updates each parameter using the residual of the fit.",
    "Feature scaling keeps the level sets of the cost closer to circular.",
    "Polynomial features let a linear model fit a curved decision surface.",
    "Regularization then shrinks weights so the fit does not chase noise.",
    "Cross validation picks the penalty that generalizes to unseen data.",
    "Those paragraphs sit between aligned symbols, not inside a data table.",
  ];
  lecture.forEach((text, offset) => {
    items.push(item(index + offset, text, 72, 520 - offset * 18, 300));
  });
  const document = pageDoc(items);
  assert.notEqual(document.pages[0].index, "skipped");
  const structure = deriveDocumentStructure(document, { pageSize: { 1: { width: 612, height: 792 } } });
  assert.equal(structure.pages[0].diagnostics.denseGrid, true);
  assert.equal(structure.pages[0].diagnostics.gridKind, "math");
  assert.equal(structure.pages[0].diagnostics.gridMath.hypothesis, "likely-math");
  assert.ok(structure.pages[0].diagnostics.gridMath.longProseLineCount >= 3);
  assert.ok(buildDocumentChunks(document).length > 0);
});

test("list and caption diagnostics emit derived blocks without changing production chunks", () => {
  const document = pageDoc([
    item(0, "The isolation levels are:", 72, 700, 160),
    item(1, "• Read committed", 88, 680, 120),
    item(2, "• Repeatable read", 88, 660, 120),
    item(3, "Figure 1 Attention heads", 72, 620, 160),
  ]);
  const before = snapChunks(document);
  const structure = deriveDocumentStructure(document, { pageSize: { 1: { width: 612, height: 792 } } });
  assert.ok(structure.pages[0].diagnostics.listCandidates.length >= 2);
  assert.ok(structure.pages[0].diagnostics.captionCandidates.length >= 1);
  assert.ok(structure.pages[0].blocks.some((block) => block.kind === "list"));
  assert.ok(structure.pages[0].blocks.some((block) => block.kind === "caption"));
  assert.deepEqual(snapChunks(document), before);
});

test("repeated body-band furniture is visible and not stripped", () => {
  const line = "This publication is available free of charge from: https://doi.org/10.6028/NIST.SP.800-63b";
  const pages = [1, 2, 3].map((pageNumber) =>
    normalizePage({
      pageNumber,
      pageWidth: 612,
      pageHeight: 792,
      items: [
        item(0, line, 21, 564, 356, 9),
        item(1, `Body sentence on page ${pageNumber} about authenticators.`, 72, 700, 240),
      ],
    }),
  );
  const document: NormalizedDocument = {
    contextId: "ctx-nist",
    sourceId: "nist-800-63b.pdf",
    path: "nist-800-63b.pdf",
    contentHash: "hash-nist",
    type: "pdf",
    parserVersion: 1,
    normalizerVersion: DOCUMENT_NORMALIZER_VERSION,
    pageCount: 3,
    outline: [],
    pages,
    readiness: "ready",
  };
  const before = pages.map((page) => page.text);
  const structure = deriveDocumentStructure(document, {
    pageSize: { 1: { width: 612, height: 792 }, 2: { width: 612, height: 792 }, 3: { width: 612, height: 792 } },
  });
  const hit = structure.furnitureCandidates.find((row) => /available free of charge/i.test(row.text));
  assert.ok(hit);
  assert.equal(hit.pages, 3);
  assert.ok(hit.yValues.every((y) => y > 72 && y < 792 - 72));
  assert.ok(hit.likelyFurnitureScore > 0);
  assert.ok(structure.pages.every((page) => page.blocks.some((block) => block.kind === "furniture")));
  assert.deepEqual(
    document.pages.map((page) => page.text),
    before,
  );
});

test("mapped coverage and evidence reconstruction are unchanged after structure derive", async () => {
  const result = await parsePdf({
    contextId: "ctx-paper",
    sourceId: "paper.pdf",
    path: "paper.pdf",
    contentHash: "paper.pdf",
    blob: blobFrom(EVAL_PDF_FIXTURES["paper.pdf"]),
  });
  const page = result.document.pages[0];
  assert.equal(mappingErrors(page).length, 0);
  const before = page.text;
  const chunksBefore = snapChunks(result.document);
  const structure = deriveDocumentStructure(result.document, { pageSize: { 1: { width: 612, height: 792 } } });
  assertValidStructure(structure, result.document);
  assert.equal(result.document.pages[0].text, before);
  assert.equal(mappingErrors(result.document.pages[0]).length, 0);
  assert.deepEqual(snapChunks(result.document), chunksBefore);
  const start = before.indexOf("Two-phase");
  const end = before.indexOf("lock point.") + "lock point.".length;
  const evidence = documentEvidenceFromRange({
    document: result.document,
    page: 1,
    normStart: start,
    normEnd: end,
    spokenText: "Two-phase locking requires waits on conflicting writes before the lock point.",
  });
  assert.ok(evidence);
  assert.equal(reconstructSourceText(result.document, evidence.itemRanges), evidence.sourceText);
  assert.equal("blockId" in evidence, false);
});

test("structure rebuild from NormalizedDocument does not open PDF.js", async () => {
  const result = await parsePdf({
    contextId: "ctx-lecture",
    sourceId: "lecture.pdf",
    path: "lecture.pdf",
    contentHash: "lecture.pdf",
    blob: blobFrom(EVAL_PDF_FIXTURES["lecture.pdf"]),
  });
  resetPdfjsDocumentOpenCount();
  const structure = deriveDocumentStructure(result.document);
  assertValidStructure(structure, result.document);
  assert.equal(pdfjsDocumentOpenCount(), 0);
  assert.equal(structure.pages[0].sizeSource, "inferred-items");
});

test("structure-version mismatch rebuilds from NormalizedDocument with no PDF.js", async () => {
  const result = await parsePdf({
    contextId: "ctx-lecture-v",
    sourceId: "lecture.pdf",
    path: "lecture.pdf",
    contentHash: "lecture.pdf",
    blob: blobFrom(EVAL_PDF_FIXTURES["lecture.pdf"]),
  });
  const stale = deriveDocumentStructure(result.document);
  stale.structureVersion = 2;
  assert.ok(stale.structureVersion !== DOCUMENT_STRUCTURE_VERSION);
  resetPdfjsDocumentOpenCount();
  const rebuilt = deriveDocumentStructure(result.document);
  assertValidStructure(rebuilt, result.document);
  assert.equal(rebuilt.structureVersion, DOCUMENT_STRUCTURE_VERSION);
  assert.equal(pdfjsDocumentOpenCount(), 0);
  assert.equal(rebuilt.pages[0].blocks.length > 0, true);
});
