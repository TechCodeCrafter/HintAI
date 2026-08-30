import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { indexContext } from "../chunk-index.ts";
import { hashBlob } from "../hash.ts";
import {
  DOCUMENT_CHUNKER_VERSION,
  DOCUMENT_NORMALIZER_VERSION,
  PDF_PARSER_VERSION,
} from "../index-versions.ts";
import { createMemoryRepository } from "../memory.ts";
import { persistPackAsContext, setContextRepository } from "../service.ts";
import { isPdfSource } from "../types.ts";
import { buildDocumentChunks } from "../../document/chunk.ts";
import { parseAndPersistPdf } from "../../document/pdf/ingest.ts";
import { buildPdfBytes } from "../../document/pdf/build-fixture.ts";
import { pdfjsDocumentOpenCount, resetPdfjsDocumentOpenCount } from "../../document/pdf/pdfjs.ts";
import { PDF_LIMITS } from "../../document/pdf/limits.ts";
import type { NormalizedDocument } from "../../document/types.ts";
import type { RepoPack } from "../../repo/types.ts";
import { isDocumentChunk } from "../../repo/types.ts";
import { retrieve } from "../../search/retrieve.ts";
import { retrieveTrace } from "../../search/retrieve-trace.ts";

const CODE_PACK: RepoPack = {
  id: "unused",
  name: "payments-backend",
  description: "Local folder · 1 files",
  commits: [],
  files: [
    {
      path: "src/retry.ts",
      language: "ts",
      content: "/** Renew the quorum lease. */\nexport const RETRIES = 3\n",
    },
  ],
};

function pdfBlob(spec: Parameters<typeof buildPdfBytes>[0]): Blob {
  const bytes = buildPdfBytes(spec);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: "application/pdf" });
}

afterEach(() => {
  setContextRepository(null);
});

test("same PDF bytes and versions reuse stored document chunks", async () => {
  const repo = createMemoryRepository();
  const context = await repo.createContext({ name: "notes" });
  const blob = pdfBlob({
    pages: [{ items: [{ str: "Serializable isolation prevents lost outcomes.", x: 72, y: 700 }] }],
  });
  const [source] = await repo.upsertSources(context.id, [{ path: "Lecture-08.pdf", kind: "pdf", blob }]);
  assert.ok(isPdfSource(source));
  await parseAndPersistPdf(repo, context.id, source);
  const first = await indexContext(repo, context.id);
  assert.ok(first.chunks.some(isDocumentChunk));
  repo.blobLoadCount = 0;
  repo.normalizedLoadCount = 0;
  resetPdfjsDocumentOpenCount();
  const opens = pdfjsDocumentOpenCount();
  const second = await indexContext(repo, context.id);
  assert.ok(second.report.reusedSourceCount >= 1);
  assert.equal(second.report.rebuiltSourceCount, 0);
  assert.equal(repo.blobLoadCount, 0);
  assert.equal(repo.normalizedLoadCount, 0);
  assert.equal(pdfjsDocumentOpenCount(), opens);
  assert.ok(second.chunks.some(isDocumentChunk));
});

test("structure version mismatch rebuilds chunks from NormalizedDocument without Blob or PDF.js", async () => {
  const repo = createMemoryRepository();
  const context = await repo.createContext({ name: "notes" });
  const blob = pdfBlob({
    pages: [{ items: [{ str: "Serializable isolation prevents lost outcomes.", x: 72, y: 700 }] }],
  });
  const [source] = await repo.upsertSources(context.id, [{ path: "Lecture-08.pdf", kind: "pdf", blob }]);
  assert.ok(isPdfSource(source));
  await parseAndPersistPdf(repo, context.id, source);
  await indexContext(repo, context.id);
  repo.blobLoadCount = 0;
  repo.normalizedLoadCount = 0;
  resetPdfjsDocumentOpenCount();
  const opens = pdfjsDocumentOpenCount();
  const rebuilt = await indexContext(repo, context.id, { structureVersion: 99 });
  assert.ok(rebuilt.report.rebuiltSourceCount >= 1);
  assert.ok(repo.normalizedLoadCount >= 1);
  assert.equal(repo.blobLoadCount, 0);
  assert.equal(pdfjsDocumentOpenCount(), opens);
});

test("document chunker version bump rebuilds from IR without Blob or PDF.js", async () => {
  const repo = createMemoryRepository();
  const context = await repo.createContext({ name: "notes" });
  const blob = pdfBlob({
    pages: [{ items: [{ str: "Serializable isolation prevents lost outcomes.", x: 72, y: 700 }] }],
  });
  const [source] = await repo.upsertSources(context.id, [{ path: "Lecture-08.pdf", kind: "pdf", blob }]);
  assert.ok(isPdfSource(source));
  await parseAndPersistPdf(repo, context.id, source);
  await indexContext(repo, context.id);
  repo.blobLoadCount = 0;
  repo.normalizedLoadCount = 0;
  resetPdfjsDocumentOpenCount();
  const opens = pdfjsDocumentOpenCount();
  const rebuilt = await indexContext(repo, context.id, {
    documentChunkerVersion: DOCUMENT_CHUNKER_VERSION + 1,
  });
  assert.ok(rebuilt.report.rebuiltSourceCount >= 1);
  assert.ok(repo.normalizedLoadCount >= 1);
  assert.equal(repo.blobLoadCount, 0);
  assert.equal(pdfjsDocumentOpenCount(), opens);
  assert.ok(rebuilt.chunks.some(isDocumentChunk));
});

test("parser version mismatch invalidates IR and does not parse from index", async () => {
  const repo = createMemoryRepository();
  const context = await repo.createContext({ name: "notes" });
  const blob = pdfBlob({
    pages: [{ items: [{ str: "Serializable isolation prevents lost outcomes.", x: 72, y: 700 }] }],
  });
  const [source] = await repo.upsertSources(context.id, [{ path: "Lecture-08.pdf", kind: "pdf", blob }]);
  assert.ok(isPdfSource(source));
  await parseAndPersistPdf(repo, context.id, source);
  await indexContext(repo, context.id);
  const live = await repo.getNormalizedDocument(source.id, source.contentHash);
  assert.ok(live);
  await repo.putNormalizedDocument(context.id, { ...live, parserVersion: PDF_PARSER_VERSION + 1 });
  assert.equal(await repo.getNormalizedDocument(source.id, source.contentHash), null);
  repo.blobLoadCount = 0;
  resetPdfjsDocumentOpenCount();
  const opens = pdfjsDocumentOpenCount();
  const next = await indexContext(repo, context.id, { parserVersion: PDF_PARSER_VERSION + 1 });
  assert.equal(next.chunks.filter(isDocumentChunk).length, 0);
  assert.equal(repo.blobLoadCount, 0);
  assert.equal(pdfjsDocumentOpenCount(), opens);
});

test("ready staged revision cannot activate before chunks exist", async () => {
  const repo = createMemoryRepository();
  const context = await repo.createContext({ name: "notes" });
  const oldBlob = pdfBlob({ pages: [{ items: [{ str: "Active snapshot body text.", x: 72, y: 700 }] }] });
  const newBlob = pdfBlob({ pages: [{ items: [{ str: "Staged snapshot body text.", x: 72, y: 700 }] }] });
  const [active] = await repo.upsertSources(context.id, [{ path: "a.pdf", kind: "pdf", blob: oldBlob }]);
  assert.ok(isPdfSource(active));
  await parseAndPersistPdf(repo, context.id, active);
  await indexContext(repo, context.id);
  await repo.completeContextActivation(context.id);

  await repo.upsertSources(context.id, [{ path: "a.pdf", kind: "pdf", blob: newBlob }]);
  const staged = (await repo.listSources(context.id))[0];
  assert.ok(isPdfSource(staged));
  await parseAndPersistPdf(repo, context.id, staged);
  const afterParse = (await repo.listSources(context.id))[0];
  assert.ok(isPdfSource(afterParse));
  assert.equal(afterParse.stagedReadiness, "ready");
  assert.notEqual(afterParse.stagedChunked, true);

  await repo.completeContextActivation(context.id);
  const stillOld = (await repo.listSources(context.id))[0];
  assert.ok(isPdfSource(stillOld));
  assert.equal(stillOld.contentHash, active.contentHash);
  assert.equal(stillOld.stagedContentHash, await hashBlob(newBlob));

  await indexContext(repo, context.id);
  await repo.completeContextActivation(context.id);
  const swapped = (await repo.listSources(context.id))[0];
  assert.ok(isPdfSource(swapped));
  assert.equal(swapped.contentHash, stillOld.stagedContentHash);
  assert.equal(swapped.chunked, true);
});

test("mixed Context retrieves PDF pages and still prefers code for code questions", async () => {
  const repo = createMemoryRepository();
  const { context } = await persistPackAsContext(CODE_PACK, repo);
  const blob = pdfBlob({
    pages: [
      { items: [{ str: "Serializable isolation prevents lost outcomes.", x: 72, y: 700 }] },
      { items: [{ str: "Predicate locks protect phantoms.", x: 72, y: 700 }] },
    ],
  });
  const [source] = await repo.upsertSources(context.id, [{ path: "Lecture-08.pdf", kind: "pdf", blob }]);
  assert.ok(isPdfSource(source));
  await parseAndPersistPdf(repo, context.id, source);
  const runtime = await indexContext(repo, context.id);
  assert.ok(runtime.chunks.some((chunk) => chunk.kind === "code"));
  assert.ok(runtime.chunks.some(isDocumentChunk));

  const pdfHits = retrieve("What does serializable isolation prevent?", runtime.chunks);
  assert.ok(pdfHits[0] && isDocumentChunk(pdfHits[0]));
  assert.equal(pdfHits[0].page, 1);

  const codeHits = retrieve("What does RETRIES mean in retry.ts?", runtime.chunks);
  assert.ok(codeHits[0] && codeHits[0].kind === "code");
  assert.equal(codeHits[0].path, "src/retry.ts");

  const trace = retrieveTrace("What does serializable isolation prevent?", runtime.chunks);
  assert.equal(trace[0]?.kind, "document");
  assert.equal(trace[0]?.page, 1);
  assert.equal(typeof trace[0]?.score, "number");
});

test("exceeding the per-PDF chunk budget refuses instead of truncating", async () => {
  const repo = createMemoryRepository();
  const context = await repo.createContext({ name: "notes" });
  const [source] = await repo.upsertSources(context.id, [
    { path: "huge.pdf", kind: "pdf", blob: pdfBlob({ pages: [{ items: [{ str: "placeholder", x: 72, y: 700 }] }] }) },
  ]);
  assert.ok(isPdfSource(source));
  const oversized: NormalizedDocument = {
    contextId: context.id,
    sourceId: source.id,
    path: "huge.pdf",
    contentHash: source.contentHash,
    type: "pdf",
    parserVersion: PDF_PARSER_VERSION,
    normalizerVersion: DOCUMENT_NORMALIZER_VERSION,
    pageCount: PDF_LIMITS.maxDocumentChunksPerPdf + 5,
    outline: [],
    readiness: "ready",
    pages: Array.from({ length: PDF_LIMITS.maxDocumentChunksPerPdf + 5 }, (_, index) => ({
      pageNumber: index + 1,
      text: `Unique lecture paragraph number ${index + 1} stays independently searchable.`,
      items: [],
      segments: [],
      readingOrder: "single-column",
      usefulItemCount: 1,
      index: "full",
    })),
  };
  assert.ok(buildDocumentChunks(oversized).length > PDF_LIMITS.maxDocumentChunksPerPdf);
  await repo.applyPdfParseResult(context.id, source.id, source.contentHash, {
    readiness: "ready",
    document: oversized,
  });
  const runtime = await indexContext(repo, context.id);
  assert.equal(runtime.chunks.filter(isDocumentChunk).length, 0);
  const refused = (await repo.listSources(context.id))[0];
  assert.ok(isPdfSource(refused));
  assert.equal(refused.readiness, "refused");
  assert.match(refused.readinessNote ?? "", /too many passages/i);
});

test("scanned and unreadable PDFs persist zero chunks and may activate", async () => {
  const repo = createMemoryRepository();
  const context = await repo.createContext({ name: "notes" });
  const scanned: NormalizedDocument = {
    contextId: context.id,
    sourceId: "src-scan",
    path: "scan.pdf",
    contentHash: "hash-scan",
    type: "pdf",
    parserVersion: PDF_PARSER_VERSION,
    normalizerVersion: DOCUMENT_NORMALIZER_VERSION,
    pageCount: 1,
    outline: [],
    readiness: "scanned",
    pages: [
      {
        pageNumber: 1,
        text: "",
        items: [],
        segments: [],
        readingOrder: "single-column",
        usefulItemCount: 0,
        index: "skipped",
      },
    ],
  };
  const [source] = await repo.upsertSources(context.id, [
    { path: "scan.pdf", kind: "pdf", blob: pdfBlob({ pages: [{ items: [] }] }) },
  ]);
  assert.ok(isPdfSource(source));
  await repo.applyPdfParseResult(context.id, source.id, source.contentHash, {
    readiness: "scanned",
    document: { ...scanned, sourceId: source.id, contentHash: source.contentHash },
  });
  const runtime = await indexContext(repo, context.id);
  assert.equal(runtime.chunks.filter(isDocumentChunk).length, 0);
  const listed = (await repo.listSources(context.id))[0];
  assert.ok(isPdfSource(listed));
  assert.equal(listed.chunked, true);
  const done = await repo.completeContextActivation(context.id);
  assert.equal(done.status, "ready");
});
