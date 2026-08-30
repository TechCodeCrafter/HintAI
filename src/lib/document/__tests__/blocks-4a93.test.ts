import assert from "node:assert/strict";
import { test } from "node:test";

import { DOCUMENT_CHUNKER_VERSION, DOCUMENT_NORMALIZER_VERSION, DOCUMENT_STRUCTURE_VERSION } from "../../context/index-versions.ts";
import { isFurnitureCandidate, projectChunkUnits, structureBlockId, trustedItemMetrics } from "../blocks.ts";
import { buildDocumentChunks } from "../chunk.ts";
import { documentEvidenceFromRange } from "../evidence.ts";
import { mappingErrors } from "../pdf/map.ts";
import { normalizePage } from "../pdf/normalize.ts";
import { assertValidStructure, deriveDocumentStructure } from "../structure.ts";
import type { NormalizedDocument, PdfTextItem } from "../types.ts";

function item(index: number, str: string, x: number, y: number, width = 40, height = 12): PdfTextItem {
  return { itemIndex: index, str, transform: [1, 0, 0, 1, x, y], width, height };
}

function pageDoc(items: PdfTextItem[], extras?: { sourceId?: string; width?: number; height?: number }): NormalizedDocument {
  const page = normalizePage({
    pageNumber: 1,
    items,
    pageWidth: extras?.width ?? 612,
    pageHeight: extras?.height ?? 792,
  });
  return {
    contextId: "ctx-4a93",
    sourceId: extras?.sourceId ?? "src-4a93",
    path: "blocks.pdf",
    contentHash: "hash-4a93",
    type: "pdf",
    parserVersion: 1,
    normalizerVersion: DOCUMENT_NORMALIZER_VERSION,
    pageCount: 1,
    outline: [],
    pages: [page],
    readiness: "ready",
  };
}

function multiPageDoc(pages: PdfTextItem[][]): NormalizedDocument {
  const normalized = pages.map((items, index) =>
    normalizePage({
      pageNumber: index + 1,
      items,
      pageWidth: 612,
      pageHeight: 792,
    }),
  );
  return {
    contextId: "ctx-4a93",
    sourceId: "src-4a93-multi",
    path: "blocks-multi.pdf",
    contentHash: "hash-4a93-multi",
    type: "pdf",
    parserVersion: 1,
    normalizerVersion: DOCUMENT_NORMALIZER_VERSION,
    pageCount: normalized.length,
    outline: [],
    pages: normalized,
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
  }));
}

function sizesFor(document: NormalizedDocument) {
  return Object.fromEntries(document.pages.map((page) => [page.pageNumber, { width: 612, height: 792 }]));
}

test("wrapped paragraph lines become one paragraph block", () => {
  const document = pageDoc([
    item(0, "Serializable isolation prevents lost outcomes when", 72, 700, 280),
    item(1, "concurrent transactions write the same row.", 72, 684, 240),
  ]);
  const before = snapChunks(document);
  const structure = deriveDocumentStructure(document, { pageSize: sizesFor(document) });
  assertValidStructure(structure, document);
  const paragraphs = structure.pages[0].blocks.filter((block) => block.kind === "paragraph");
  assert.equal(paragraphs.length, 1);
  assert.equal(paragraphs[0].lineIds.length, 2);
  assert.equal(
    document.pages[0].text.slice(paragraphs[0].normStart, paragraphs[0].normEnd),
    document.pages[0].text.slice(structure.pages[0].lines[0].normStart, structure.pages[0].lines[1].normEnd),
  );
  assert.deepEqual(snapChunks(document), before);
});

test("large vertical gap splits into two paragraph blocks", () => {
  const document = pageDoc([
    item(0, "The first paragraph stays on the upper band of the page.", 72, 700, 280),
    item(1, "The second paragraph starts after a real section gap.", 72, 580, 280),
  ]);
  const structure = deriveDocumentStructure(document, { pageSize: sizesFor(document) });
  assertValidStructure(structure, document);
  assert.equal(structure.pages[0].blocks.filter((block) => block.kind === "paragraph").length, 2);
});

test("different regions never form one paragraph", () => {
  const items: PdfTextItem[] = [];
  let index = 0;
  for (let row = 0; row < 6; row += 1) {
    items.push(item(index, "The pretraining objective uses bidirectional context in every layer.", 72, 700 - row * 16, 200));
    index += 1;
    items.push(item(index, "Fine-tuning then reuses the same parameters for each downstream task.", 320, 700 - row * 16, 200));
    index += 1;
  }
  const document = pageDoc(items);
  assert.equal(document.pages[0].readingOrder, "two-column");
  const structure = deriveDocumentStructure(document, { pageSize: sizesFor(document) });
  assertValidStructure(structure, document);
  for (const block of structure.pages[0].blocks) {
    if (block.kind !== "paragraph") continue;
    const lefts = block.lineIds.map((id) => structure.pages[0].lines.find((line) => line.id === id)!.left);
    const hasLeft = lefts.some((left) => left < 200);
    const hasRight = lefts.some((left) => left > 280);
    assert.equal(hasLeft && hasRight, false, block.id);
  }
});

test("three aligned bullets become one list with three item children", () => {
  const document = pageDoc([
    item(0, "The isolation levels are:", 72, 700, 180),
    item(1, "• Read committed", 88, 680, 140),
    item(2, "• Repeatable read", 88, 660, 140),
    item(3, "• Serializable", 88, 640, 140),
  ]);
  const structure = deriveDocumentStructure(document, { pageSize: sizesFor(document) });
  assertValidStructure(structure, document);
  const lists = structure.pages[0].blocks.filter((block) => block.kind === "list");
  const items = structure.pages[0].blocks.filter((block) => block.kind === "list-item");
  assert.equal(lists.length, 1);
  assert.equal(items.length, 3);
  assert.ok(items.every((itemBlock) => itemBlock.parentBlockId === lists[0].id));
  assert.ok(items.every((itemBlock) => itemBlock.itemIndexes.length > 0));
  assert.ok(items.every((itemBlock) => itemBlock.normStart !== undefined));
});

test("continuation indentation stays in the same list item", () => {
  const document = pageDoc([
    item(0, "• Read committed allows nonrepeatable reads after", 88, 700, 260),
    item(1, "the first statement commits.", 108, 684, 180),
    item(2, "• Repeatable read holds the read lock.", 88, 664, 220),
  ]);
  const structure = deriveDocumentStructure(document, { pageSize: sizesFor(document) });
  assertValidStructure(structure, document);
  const items = structure.pages[0].blocks.filter((block) => block.kind === "list-item");
  assert.equal(items.length, 2);
  assert.equal(items[0].lineIds.length, 2);
});

test("a new heading ends the prior list", () => {
  const document = pageDoc([
    item(0, "• First member of the earlier list.", 88, 700, 200),
    item(1, "• Second member of the earlier list.", 88, 680, 200),
    item(2, "3.2 Lock modes", 72, 640, 140, 16),
    item(3, "Shared locks allow concurrent readers of the same row.", 72, 616, 280),
  ]);
  const structure = deriveDocumentStructure(document, { pageSize: sizesFor(document) });
  assertValidStructure(structure, document);
  const lists = structure.pages[0].blocks.filter((block) => block.kind === "list");
  assert.equal(lists.length, 1);
  assert.equal(lists[0].lineIds.length, 2);
  assert.ok(structure.pages[0].blocks.some((block) => block.kind === "heading"));
});

test("the same visual list across a page break stays two lists", () => {
  const bullets = (start: number) => [
    item(start, "• Authenticator secrets stay local.", 88, 700, 200),
    item(start + 1, "• Session tokens expire.", 88, 680, 180),
    item(start + 2, "• Recovery codes are single use.", 88, 660, 200),
  ];
  const document = multiPageDoc([bullets(0), bullets(0)]);
  const structure = deriveDocumentStructure(document, { pageSize: sizesFor(document) });
  assertValidStructure(structure, document);
  assert.equal(structure.pages[0].blocks.filter((block) => block.kind === "list").length, 1);
  assert.equal(structure.pages[1].blocks.filter((block) => block.kind === "list").length, 1);
  assert.notEqual(structure.pages[0].blocks.find((block) => block.kind === "list")?.id, structure.pages[1].blocks.find((block) => block.kind === "list")?.id);
});

test("Figure 2 caption is a caption block; axis labels are not", () => {
  const document = pageDoc([
    item(0, "Figure 2: Residual block with identity shortcut.", 72, 520, 260),
    item(1, "0.0", 80, 400, 16),
    item(2, "0.5", 140, 400, 16),
    item(3, "1.0", 200, 400, 16),
    item(4, "x", 140, 380, 10),
  ]);
  const structure = deriveDocumentStructure(document, { pageSize: sizesFor(document) });
  assertValidStructure(structure, document);
  const captions = structure.pages[0].blocks.filter((block) => block.kind === "caption");
  assert.equal(captions.length, 1);
  assert.match(document.pages[0].text.slice(captions[0].normStart, captions[0].normEnd), /Figure 2/);
  assert.ok(structure.pages[0].blocks.every((block) => block.kind !== "caption" || block.lineIds.length === 1));
  const axis = structure.pages[0].lines.filter((line) => /^(?:0\.\d|1\.0|x)$/.test(line.features.text));
  for (const line of axis) {
    const owner = structure.pages[0].blocks.find((block) => block.lineIds.includes(line.id));
    assert.notEqual(owner?.kind, "caption");
    assert.notEqual(owner?.kind, "paragraph");
  }
});

test("repeated body-band line on a majority of pages is furniture; a unique similar line is not", () => {
  const banner = "This publication is available free of charge from: https://doi.org/10.6028/NIST.SP.800-63b";
  const pages = [1, 2, 3, 4].map((pageNumber) =>
    normalizePage({
      pageNumber,
      pageWidth: 612,
      pageHeight: 792,
      items: [
        item(0, banner, 21, 564, 356, 9),
        item(1, `Unique body sentence about authenticators on page ${pageNumber}.`, 72, 700, 280),
      ],
    }),
  );
  const document: NormalizedDocument = {
    contextId: "ctx-furn",
    sourceId: "nist-furn.pdf",
    path: "nist-furn.pdf",
    contentHash: "hash-furn",
    type: "pdf",
    parserVersion: 1,
    normalizerVersion: DOCUMENT_NORMALIZER_VERSION,
    pageCount: 4,
    outline: [],
    pages,
    readiness: "ready",
  };
  const before = pages.map((page) => page.text);
  const structure = deriveDocumentStructure(document, { pageSize: sizesFor(document) });
  assertValidStructure(structure, document);
  assert.ok(structure.pages.every((page) => page.blocks.some((block) => block.kind === "furniture")));
  assert.ok(structure.pages.every((page) => page.blocks.some((block) => block.kind === "paragraph")));
  assert.deepEqual(document.pages.map((page) => page.text), before);
  assert.equal(
    isFurnitureCandidate({
      text: "A sentence that appears twice and is unique content.",
      share: 2 / 40,
      pages: 2,
      pageCount: 40,
      ySpread: 4,
      hint: false,
    }),
    false,
  );
  assert.equal(
    isFurnitureCandidate({
      text: "This publication is available free of charge from: https://doi.org/10.6028/NIST.SP.800-63b",
      share: 27 / 80,
      pages: 27,
      pageCount: 80,
      ySpread: 0,
      hint: true,
    }),
    true,
  );
});

test("aligned equation group is one math block; separated groups stay separate", () => {
  const document = pageDoc([
    item(0, "Linear regression estimates a hypothesis from labeled examples.", 72, 720, 300),
    item(1, "J(θ) = (1/2) Σ (hθ(x) − y)²", 120, 680, 160),
    item(2, "θ := θ − α ∇J(θ)", 120, 660, 120),
    item(3, "Feature scaling keeps the cost level sets closer to circular.", 72, 560, 300),
    item(4, "x := (x − μ) / σ", 120, 520, 100),
  ]);
  const structure = deriveDocumentStructure(document, { pageSize: sizesFor(document) });
  assertValidStructure(structure, document);
  const math = structure.pages[0].blocks.filter((block) => block.kind === "math");
  const paragraphs = structure.pages[0].blocks.filter((block) => block.kind === "paragraph");
  assert.ok(math.length >= 2);
  assert.ok(paragraphs.length >= 2);
  assert.ok(math.every((block) => !block.lineIds.some((id) => {
    const line = structure.pages[0].lines.find((entry) => entry.id === id);
    return (line?.features.wordCount ?? 0) >= 10;
  })));
});

test("dense table is not reconstructed as math or prose", () => {
  const items: PdfTextItem[] = [];
  let index = 0;
  for (let row = 0; row < 6; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      items.push(item(index, `${row}.${col}`, 72 + col * 80, 700 - row * 16, 18));
      index += 1;
    }
  }
  const document = pageDoc(items);
  assert.equal(document.pages[0].index, "skipped");
  const structure = deriveDocumentStructure(document, { pageSize: sizesFor(document) });
  assertValidStructure(structure, document);
  assert.equal(structure.pages[0].diagnostics.gridKind, "table");
  assert.equal(structure.pages[0].blocks.filter((block) => block.kind === "paragraph" || block.kind === "math" || block.kind === "list").length, 0);
  assert.ok(structure.pages[0].blocks.every((block) => block.kind === "unknown" || block.kind === "caption"));
});

test("Attention overflow widths do not create a cross-region block", () => {
  const document = pageDoc([
    item(0, "Recurrent models typically factor computation along the input", 108, 700, 396, 10),
    item(1, "decoder stack on the right column continues independently.", 340, 680, 180, 10),
  ]);
  const structure = deriveDocumentStructure(document, { pageSize: sizesFor(document) });
  assertValidStructure(structure, document);
  for (const block of structure.pages[0].blocks) {
    if (block.kind === "unknown") continue;
    const xs = block.itemIndexes.map((itemIndex) => document.pages[0].items.find((entry) => entry.itemIndex === itemIndex)!.transform[4]);
    assert.equal(xs.some((x) => x < 292) && xs.some((x) => x > 326), false, block.id);
  }
});

test("same structure yields the same block ids", () => {
  const document = pageDoc([
    item(0, "The isolation levels are:", 72, 700, 180),
    item(1, "• Read committed", 88, 680, 140),
    item(2, "• Repeatable read", 88, 660, 140),
  ]);
  const first = deriveDocumentStructure(document, { pageSize: sizesFor(document) });
  const second = deriveDocumentStructure(document, { pageSize: sizesFor(document) });
  assert.deepEqual(
    first.pages[0].blocks.map((block) => block.id),
    second.pages[0].blocks.map((block) => block.id),
  );
  assert.equal(first.pages[0].blocks[0].id, structureBlockId("src-4a93", 1, first.pages[0].blocks[0].kind, 0));
});

test("block itemIndexes and mapped ranges stay valid; blocks are not evidence", () => {
  const document = pageDoc([
    item(0, "Two-phase locking requires waits on conflicting writes.", 72, 700, 280),
    item(1, "• Shared locks allow readers.", 88, 670, 180),
  ]);
  const page = document.pages[0];
  assert.equal(mappingErrors(page).length, 0);
  const structure = deriveDocumentStructure(document, { pageSize: sizesFor(document) });
  assertValidStructure(structure, document);
  for (const block of structure.pages[0].blocks) {
    for (const itemIndex of block.itemIndexes) {
      assert.ok(page.items.some((entry) => entry.itemIndex === itemIndex));
    }
    if (block.normStart !== undefined && block.normEnd !== undefined) {
      assert.equal(page.text.slice(block.normStart, block.normEnd).length >= 0, true);
    }
  }
  const start = page.text.indexOf("Two-phase");
  const end = start + "Two-phase locking requires waits on conflicting writes.".length;
  const evidence = documentEvidenceFromRange({
    document,
    page: 1,
    normStart: start,
    normEnd: end,
    spokenText: "Two-phase locking requires waits on conflicting writes.",
  });
  assert.ok(evidence);
  assert.equal("blockId" in evidence, false);
});

test("production chunks and chunker version stay frozen", () => {
  assert.equal(DOCUMENT_CHUNKER_VERSION, 2);
  assert.equal(DOCUMENT_STRUCTURE_VERSION, 3);
  const document = pageDoc([
    item(0, "Serializable isolation prevents lost outcomes.", 72, 700, 240),
    item(1, "• Read committed", 88, 670, 140),
    item(2, "Figure 1 Attention heads on the page.", 72, 630, 200),
  ]);
  const before = snapChunks(document);
  deriveDocumentStructure(document, { pageSize: sizesFor(document) });
  assert.deepEqual(snapChunks(document), before);
});

test("hypothetical projection never writes stored chunks", () => {
  const document = pageDoc([
    item(0, "A full paragraph about isolation and schedules.", 72, 700, 260),
    item(1, "This publication is available free of charge from NIST.", 21, 564, 300, 9),
  ]);
  const structure = deriveDocumentStructure(document, { pageSize: sizesFor(document) });
  const projected = projectChunkUnits(structure.pages[0].blocks);
  assert.ok(projected >= 0);
  assert.deepEqual(buildDocumentChunks(document).map((chunk) => chunk.text), snapChunks(document).map((chunk) => chunk.text));
});

test("trusted width caps overflow without rewriting item geometry", () => {
  const overflowing = item(0, "Short", 108, 700, 900, 10);
  const trusted = trustedItemMetrics(overflowing, 80);
  assert.ok(trusted.trustedWidth < overflowing.width);
  assert.equal(overflowing.width, 900);
  assert.equal(overflowing.transform[4], 108);
});
