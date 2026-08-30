import assert from "node:assert/strict";
import { test } from "node:test";

import { DOCUMENT_CHUNKER_VERSION, DOCUMENT_NORMALIZER_VERSION } from "../../context/index-versions.ts";
import { assertChunkMatchesPage, buildDocumentChunks, DOCUMENT_CHUNK_CAP } from "../chunk.ts";
import { normalizePage } from "../pdf/normalize.ts";
import { deriveDocumentStructure } from "../structure.ts";
import type { NormalizedDocument, PdfTextItem } from "../types.ts";

function item(index: number, str: string, x: number, y: number, width = 40, height = 12): PdfTextItem {
  return { itemIndex: index, str, transform: [1, 0, 0, 1, x, y], width, height };
}

function pageDoc(items: PdfTextItem[], extras?: { sourceId?: string }): NormalizedDocument {
  const page = normalizePage({ pageNumber: 1, items, pageWidth: 612, pageHeight: 792 });
  return {
    contextId: "ctx-4a94",
    sourceId: extras?.sourceId ?? "src-4a94",
    path: "blocks.pdf",
    contentHash: "hash-4a94",
    type: "pdf",
    parserVersion: 1,
    normalizerVersion: DOCUMENT_NORMALIZER_VERSION,
    pageCount: 1,
    outline: [],
    pages: [page],
    readiness: "ready",
  };
}

function sizes(document: NormalizedDocument) {
  return Object.fromEntries(document.pages.map((page) => [page.pageNumber, { width: 612, height: 792 }]));
}

function chunksOf(document: NormalizedDocument) {
  const structure = deriveDocumentStructure(document, { pageSize: sizes(document) });
  const chunks = buildDocumentChunks(document, structure);
  for (const chunk of chunks) assertChunkMatchesPage(document, chunk);
  return { structure, chunks };
}

test("mapped paragraph becomes one chunk; large paragraph splits on sentences", () => {
  assert.equal(DOCUMENT_CHUNKER_VERSION, 2);
  const short = pageDoc([item(0, "Serializable isolation prevents lost outcomes.", 72, 700, 260)]);
  const { chunks } = chunksOf(short);
  assert.equal(chunks.length, 1);
  assert.match(chunks[0].text, /Serializable isolation/);

  const sentence = "Serializable isolation prevents lost outcomes. ";
  const long = pageDoc([item(0, sentence.repeat(40).trim(), 72, 700, 400)]);
  const split = chunksOf(long).chunks;
  assert.ok(split.length >= 2);
  assert.ok(split.every((chunk) => chunk.text.length <= DOCUMENT_CHUNK_CAP));
  assert.ok(split.every((chunk) => chunk.page === 1));
});

test("furniture and unknown emit zero chunks", () => {
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
  const { structure, chunks } = chunksOf(document);
  assert.ok(structure.pages.every((page) => page.blocks.some((block) => block.kind === "furniture")));
  assert.equal(chunks.some((chunk) => /available free of charge/i.test(chunk.text)), false);
  assert.ok(chunks.some((chunk) => /authenticators/i.test(chunk.text)));
  assert.ok(pages.every((page) => /available free of charge/i.test(page.text)));
});

test("NIST banner substring is stripped from a mixed paragraph slice", () => {
  const banner = "This publication is available free of charge from: https://doi.org/10.6028/NIST.SP.800-207";
  const pages = [1, 2, 3, 4].map((pageNumber) =>
    normalizePage({
      pageNumber,
      pageWidth: 612,
      pageHeight: 792,
      items: [
        item(0, `${banner} Unique body sentence about zero trust on page ${pageNumber}.`, 21, 564, 500, 9),
      ],
    }),
  );
  const document: NormalizedDocument = {
    contextId: "ctx-mixed-furn",
    sourceId: "nist-mixed.pdf",
    path: "nist-mixed.pdf",
    contentHash: "hash-mixed",
    type: "pdf",
    parserVersion: 1,
    normalizerVersion: DOCUMENT_NORMALIZER_VERSION,
    pageCount: 4,
    outline: [],
    pages,
    readiness: "ready",
  };
  const { chunks } = chunksOf(document);
  assert.equal(chunks.some((chunk) => /available free of charge/i.test(chunk.text)), false);
  assert.ok(chunks.some((chunk) => /zero trust/i.test(chunk.text)));
  assert.ok(pages.every((page) => /available free of charge/i.test(page.text)));
});

test("pure math and unknown lines emit zero chunks", () => {
  const document = pageDoc([
    item(0, "J(θ) = (1/2) Σ (hθ(x) − y)²", 120, 680, 160),
    item(1, "θ := θ − α ∇J(θ)", 120, 660, 120),
    item(2, "x", 80, 400, 10),
  ]);
  const { structure, chunks } = chunksOf(document);
  assert.ok(structure.pages[0].blocks.some((block) => block.kind === "math" || block.kind === "unknown"));
  assert.equal(
    chunks.some((chunk) => structure.pages[0].blocks.some((block) => block.kind === "math" && chunk.startOffset === block.normStart)),
    false,
  );
});

test("mapped caption emits a chunk; axis labels do not", () => {
  const document = pageDoc([
    item(0, "Figure 2: Residual block with identity shortcut.", 72, 520, 260),
    item(1, "0.0", 80, 400, 16),
    item(2, "1.0", 200, 400, 16),
  ]);
  const { chunks } = chunksOf(document);
  assert.ok(chunks.some((chunk) => /Figure 2/.test(chunk.text)));
  assert.equal(chunks.some((chunk) => chunk.text.trim() === "0.0"), false);
});

test("small contiguous list becomes one coherent chunk", () => {
  const document = pageDoc([
    item(0, "The isolation levels are:", 72, 700, 180),
    item(1, "• Read committed", 88, 680, 140),
    item(2, "• Repeatable read", 88, 660, 140),
    item(3, "• Serializable", 88, 640, 140),
  ]);
  const { structure, chunks } = chunksOf(document);
  const lists = structure.pages[0].blocks.filter((block) => block.kind === "list");
  assert.equal(lists.length, 1);
  assert.ok(chunks.some((chunk) => /Read committed/.test(chunk.text) && /Serializable/.test(chunk.text)));
});

test("large list splits on member boundaries, not mid-item", () => {
  const items: PdfTextItem[] = [item(0, "The controls are:", 72, 720, 160)];
  for (let i = 0; i < 20; i += 1) {
    items.push(
      item(
        i + 1,
        `• Member ${i + 1} ${"requires a long independently complete sentence about authenticators. ".repeat(4)}`,
        88,
        700 - i * 18,
        300,
      ),
    );
  }
  const document = pageDoc(items);
  const { chunks } = chunksOf(document);
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((chunk) => chunk.text.length <= DOCUMENT_CHUNK_CAP || chunk.text.startsWith("The controls")));
  assert.ok(chunks.every((chunk) => !/Member \d+ requires[\s\S]+Member/.test(chunk.text) || chunk.text.includes("•")));
});

test("non-contiguous list does not synthesize concatenated text", () => {
  const document = pageDoc([
    item(0, "• First isolated member about locks.", 88, 700, 200),
    item(1, "Unrelated paragraph sits between members on purpose.", 72, 640, 280),
    item(2, "• Second isolated member about waits.", 88, 500, 200),
  ]);
  const { structure, chunks } = chunksOf(document);
  const lists = structure.pages[0].blocks.filter((block) => block.kind === "list");
  for (const list of lists) {
    if (list.normStart === undefined || list.normEnd === undefined) continue;
    const slice = document.pages[0].text.slice(list.normStart, list.normEnd);
    assert.equal(chunks.some((chunk) => chunk.text === `• First isolated member about locks.\n• Second isolated member about waits.`), false);
    assert.ok(slice.includes("First") || slice.includes("Second"));
  }
});

test("dense table structure emits zero prose chunks", () => {
  const items: PdfTextItem[] = [];
  let index = 0;
  for (let row = 0; row < 6; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      items.push(item(index, `${row}.${col}`, 72 + col * 80, 700 - row * 16, 18));
      index += 1;
    }
  }
  const document = pageDoc(items);
  const { structure, chunks } = chunksOf(document);
  assert.equal(structure.pages[0].diagnostics.gridKind, "table");
  assert.equal(chunks.length, 0);
});

test("two-column mapped paragraphs never cross the gutter", () => {
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
  const { chunks } = chunksOf(document);
  const br = document.pages[0].columnBreakOffset;
  assert.ok(typeof br === "number");
  assert.equal(chunks.some((chunk) => chunk.startOffset < br! && chunk.endOffset > br!), false);
  assert.equal(chunks.some((chunk) => /pretraining/.test(chunk.text) && /Fine-tuning/.test(chunk.text)), false);
});

test("chunks never cross pages and IDs follow the new ranges", () => {
  const first = normalizePage({
    pageNumber: 1,
    pageWidth: 612,
    pageHeight: 792,
    items: [item(0, "Serializable isolation prevents lost outcomes.", 72, 700, 260)],
  });
  const second = normalizePage({
    pageNumber: 2,
    pageWidth: 612,
    pageHeight: 792,
    items: [item(0, "Predicate locks protect phantoms.", 72, 700, 220)],
  });
  const document: NormalizedDocument = {
    contextId: "ctx-pages",
    sourceId: "src-pages",
    path: "pages.pdf",
    contentHash: "hash-pages",
    type: "pdf",
    parserVersion: 1,
    normalizerVersion: DOCUMENT_NORMALIZER_VERSION,
    pageCount: 2,
    outline: [],
    pages: [first, second],
    readiness: "ready",
  };
  const { chunks } = chunksOf(document);
  assert.ok(chunks.some((chunk) => chunk.page === 1));
  assert.ok(chunks.some((chunk) => chunk.page === 2));
  assert.equal(chunks.some((chunk) => chunk.page === 1 && /phantoms/.test(chunk.text)), false);
  assert.ok(chunks.every((chunk) => chunk.id.includes(`:${chunk.startOffset}-${chunk.endOffset}:`)));
});
