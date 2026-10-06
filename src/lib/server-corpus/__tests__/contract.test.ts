import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildUploadBatches,
  quotaAfterUpload,
  SERVER_CORPUS_LIMITS,
  validateUploadBatch,
  type ServerDocMeta,
  type ServerUploadBatch,
} from "../contract.ts";
import type { DocumentChunk, NormalizedPage } from "../../document/types.ts";

const meta: ServerDocMeta = {
  spaceId: "space-1",
  sourceId: "offer-letter",
  path: "local-repo/anish-offer-letter.docx",
  kind: "file",
  contentHash: "abc123",
  parserVersion: 1,
  normalizerVersion: 1,
};

function page(n: number): NormalizedPage {
  return {
    pageNumber: n,
    text: `Page ${n} text with enough words to look like content.`,
    items: [],
    segments: [],
    readingOrder: "single-column",
    usefulItemCount: 1,
    index: "full",
  };
}

function chunk(n: number): DocumentChunk {
  return {
    kind: "document",
    id: `c${n}`,
    path: meta.path,
    sourceId: meta.sourceId,
    page: n,
    startOffset: 0,
    endOffset: 10,
    text: `Chunk ${n} Phone: 9931607655`,
    contentHash: meta.contentHash,
    readingOrder: "single-column",
  };
}

function batchOf(pages: NormalizedPage[], chunks: DocumentChunk[]): ServerUploadBatch {
  return { meta, batchIndex: 0, isLast: true, pages, chunks };
}

test("a well-formed batch validates", () => {
  assert.deepEqual(validateUploadBatch(batchOf([page(1)], [chunk(1)])), { ok: true });
});

test("validation rejects hostile shapes", () => {
  assert.equal(validateUploadBatch({ ...batchOf([], []), meta: { ...meta, kind: "exe" as never } }).ok, false);
  assert.equal(
    validateUploadBatch({ ...batchOf([], []), meta: { ...meta, spaceId: "../escape" } }).ok,
    false,
  );
  const foreign = { ...chunk(1), sourceId: "someone-else" };
  assert.equal(validateUploadBatch(batchOf([page(1)], [foreign])).ok, false);
  const huge = { ...page(1), text: "x".repeat(300_000) };
  assert.equal(validateUploadBatch(batchOf([huge], [])).ok, false);
});

test("batching keeps chunks with their page and flags the last batch", () => {
  const pages = [page(1), page(2), page(3)];
  const chunks = [chunk(1), chunk(2), chunk(3)];
  const batches = buildUploadBatches(meta, pages, chunks);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].isLast, true);
  assert.equal(batches[0].chunks.length, 3);

  const many = Array.from({ length: SERVER_CORPUS_LIMITS.maxPagesPerBatch + 2 }, (_, i) => page(i + 1));
  const manyChunks = many.map((p) => ({ ...chunk(p.pageNumber) }));
  const split = buildUploadBatches(meta, many, manyChunks);
  assert.equal(split.length, 2);
  assert.equal(split[0].isLast, false);
  assert.equal(split[1].isLast, true);
  assert.equal(split[0].batchIndex, 0);
  assert.equal(split[1].batchIndex, 1);
  // Every chunk rides with its own page's batch.
  for (const batch of split) {
    const pageNumbers = new Set(batch.pages.map((p) => p.pageNumber));
    for (const c of batch.chunks) assert.ok(pageNumbers.has(c.page));
  }
});

test("quota math blocks past the page budget", () => {
  assert.ok(quotaAfterUpload(100, 50).ok);
  const over = quotaAfterUpload(SERVER_CORPUS_LIMITS.maxPagesPerUser, 1);
  assert.equal(over.ok, false);
});
