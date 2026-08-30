import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DOCUMENT_CHUNK_CAP,
  assertChunkMatchesPage,
  buildDocumentChunks,
  documentChunkId,
  isolatedLineEligible,
} from "../chunk.ts";
import { DOCUMENT_NORMALIZER_VERSION, PDF_PARSER_VERSION } from "../../context/index-versions.ts";
import type { NormalizedDocument, NormalizedPage } from "../types.ts";

function page(partial: Partial<NormalizedPage> & Pick<NormalizedPage, "text">): NormalizedPage {
  return {
    pageNumber: 1,
    items: [],
    segments: [],
    readingOrder: "single-column",
    usefulItemCount: 1,
    index: "full",
    ...partial,
  };
}

function document(partial: Partial<NormalizedDocument> & Pick<NormalizedDocument, "pages">): NormalizedDocument {
  return {
    contextId: "ctx",
    sourceId: "src-doc",
    path: "Lecture-08.pdf",
    contentHash: "hash-aaa",
    type: "pdf",
    parserVersion: PDF_PARSER_VERSION,
    normalizerVersion: DOCUMENT_NORMALIZER_VERSION,
    pageCount: partial.pages.length,
    outline: [],
    readiness: "ready",
    ...partial,
  };
}

function assertAllChunks(doc: NormalizedDocument) {
  const chunks = buildDocumentChunks(doc);
  for (const chunk of chunks) {
    assertChunkMatchesPage(doc, chunk);
    assert.equal(chunk.kind, "document");
    assert.equal("startLine" in chunk, false);
    assert.equal("endLine" in chunk, false);
    assert.ok(chunk.text.length <= DOCUMENT_CHUNK_CAP);
    assert.equal(
      chunk.id,
      documentChunkId(chunk.sourceId, chunk.page, chunk.startOffset, chunk.endOffset, chunk.contentHash),
    );
  }
  const pages = new Set(chunks.map((chunk) => chunk.page));
  for (const pageNumber of pages) {
    const onPage = chunks.filter((chunk) => chunk.page === pageNumber);
    const text = doc.pages.find((entry) => entry.pageNumber === pageNumber)?.text ?? "";
    for (const chunk of onPage) {
      assert.ok(chunk.startOffset >= 0);
      assert.ok(chunk.endOffset <= text.length);
    }
  }
  return chunks;
}

test("deterministic IDs, exact offsets, and no fake line coordinates", () => {
  const doc = document({
    pages: [
      page({
        text: "Serializable isolation prevents lost outcomes.\nTwo-phase locking requires waits.",
      }),
    ],
  });
  const first = assertAllChunks(doc);
  const second = buildDocumentChunks(doc);
  assert.deepEqual(
    first.map((chunk) => chunk.id),
    second.map((chunk) => chunk.id),
  );
  assert.ok(first.length >= 2);
});

test("a DocumentChunk never spans pages", () => {
  const doc = document({
    pages: [
      page({ pageNumber: 1, text: "Serializable isolation continues onto the next page." }),
      page({ pageNumber: 2, text: "prevents anomalies when writes conflict." }),
    ],
  });
  const chunks = assertAllChunks(doc);
  assert.equal(chunks.some((chunk) => chunk.text.includes("continues") && chunk.text.includes("anomalies")), false);
  assert.ok(chunks.some((chunk) => chunk.page === 1 && chunk.text.includes("Serializable")));
  assert.ok(chunks.some((chunk) => chunk.page === 2 && chunk.text.includes("anomalies")));
});

test("full pages split on paragraph then sentence and stay under the cap", () => {
  const long = `${"Serializable isolation prevents lost outcomes. ".repeat(40).trim()}`;
  assert.ok(long.length > DOCUMENT_CHUNK_CAP);
  const doc = document({
    pages: [page({ text: `${long}\n\nPredicate locks protect phantoms.` })],
  });
  const chunks = assertAllChunks(doc);
  assert.ok(chunks.every((chunk) => chunk.text.length <= DOCUMENT_CHUNK_CAP));
  assert.ok(chunks.some((chunk) => chunk.text.includes("Predicate locks")));
  const joined = chunks.map((chunk) => chunk.text).join(" ");
  assert.match(joined, /Serializable isolation/);
  assert.match(joined, /Predicate locks protect phantoms/);
});

test("two-column pages never merge left-end with right-start", () => {
  const left = "Two-phase locking requires waits on conflicting writes.";
  const right = "Predicate locks protect phantoms under serializable isolation.";
  const doc = document({
    pages: [
      page({
        readingOrder: "two-column",
        columnBreakOffset: left.length,
        text: `${left}\n${right}`,
      }),
    ],
  });
  const chunks = assertAllChunks(doc);
  assert.equal(
    chunks.some((chunk) => chunk.text.includes("conflicting writes") && chunk.text.includes("Predicate locks")),
    false,
  );
  assert.ok(chunks.some((chunk) => chunk.text.includes("Two-phase locking")));
  assert.ok(chunks.some((chunk) => chunk.text.includes("Predicate locks")));
});

test("isolated-lines without visual structure do not emit fragment chunks", () => {
  const blocks = [
    "Serializable isolation prevents lost outcomes.",
    "18",
    "Fig.",
    "A",
    "•",
    "Four meaningful words here",
  ];
  const doc = document({
    pages: [page({ index: "isolated-lines", text: blocks.join("\n") })],
  });
  const chunks = assertAllChunks(doc);
  assert.equal(chunks.length, 0);
  assert.equal(isolatedLineEligible("18"), false);
  assert.equal(isolatedLineEligible("Fig."), false);
  assert.equal(isolatedLineEligible("A"), false);
  assert.equal(isolatedLineEligible("Serializable isolation prevents lost outcomes."), true);
});

test("skipped pages produce zero chunks", () => {
  const chunks = assertAllChunks(
    document({
      pages: [page({ index: "skipped", text: "Hidden grid prose must not be indexed." })],
    }),
  );
  assert.equal(chunks.length, 0);
});

test("grid / skipped regions produce zero unsafe prose chunks", () => {
  const chunks = buildDocumentChunks(
    document({
      pages: [
        page({ index: "skipped", readingOrder: "uncertain", text: "A B C D E F G H I J K L" }),
        page({ pageNumber: 2, text: "Lecture prose that stays searchable." }),
      ],
    }),
  );
  assert.equal(chunks.some((chunk) => chunk.page === 1), false);
  assert.ok(chunks.some((chunk) => chunk.page === 2));
});

test("scanned, unreadable, and refused documents produce zero chunks", () => {
  for (const readiness of ["scanned", "unreadable", "refused"] as const) {
    const chunks = buildDocumentChunks(
      document({
        readiness,
        pages: [page({ text: "This text must not become a retrieval chunk." })],
      }),
    );
    assert.equal(chunks.length, 0, readiness);
  }
});

test("outline heading is metadata only and is not injected into chunk text", () => {
  const body = "Serializable isolation prevents lost outcomes.";
  const doc = document({
    outline: [{ title: "Isolation", page: 1 }],
    pages: [page({ text: body })],
  });
  const chunks = assertAllChunks(doc);
  assert.ok(chunks.length > 0);
  assert.ok(chunks.every((chunk) => chunk.heading === "Isolation"));
  assert.ok(chunks.every((chunk) => chunk.text === body || body.includes(chunk.text.trim())));
  assert.equal(chunks.some((chunk) => chunk.text.startsWith("Isolation\n")), false);
  assert.equal(chunks.some((chunk) => chunk.text === "Isolation"), false);
});
