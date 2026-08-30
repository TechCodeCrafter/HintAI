import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { DOCUMENT_NORMALIZER_VERSION, PDF_PARSER_VERSION } from "../../../context/index-versions.ts";
import { persistPackAsContext, setContextRepository } from "../../../context/service.ts";
import { hydrateContext, packFromSources, runtimeFromPack } from "../../../context/hydrate.ts";
import { indexContext } from "../../../context/chunk-index.ts";
import { createMemoryRepository } from "../../../context/memory.ts";
import { hashBlob } from "../../../context/hash.ts";
import { isPdfSource } from "../../../context/types.ts";
import type { RepoPack } from "../../../repo/types.ts";
import { parseAndPersistPdf } from "../ingest.ts";
import { buildPdfBytes } from "../build-fixture.ts";
import type { NormalizedDocument } from "../../types.ts";

const TEXT_PACK: RepoPack = {
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

test("OLD_HASH normalized document cannot satisfy NEW_HASH", async () => {
  const repo = createMemoryRepository();
  const context = await repo.createContext({ name: "notes" });
  const oldBlob = pdfBlob({ pages: [{ items: [{ str: "Old revision body text.", x: 72, y: 700 }] }] });
  const newBlob = pdfBlob({ pages: [{ items: [{ str: "New revision body text.", x: 72, y: 700 }] }] });
  const [source] = await repo.upsertSources(context.id, [{ path: "a.pdf", kind: "pdf", blob: oldBlob }]);
  assert.ok(isPdfSource(source));
  await parseAndPersistPdf(repo, context.id, source);
  const oldDoc = await repo.getNormalizedDocument(source.id, source.contentHash);
  assert.ok(oldDoc);
  assert.match(oldDoc.pages[0]?.text ?? "", /Old revision/);

  await repo.upsertSources(context.id, [{ path: "a.pdf", kind: "pdf", blob: newBlob }]);
  const staged = (await repo.listSources(context.id))[0];
  assert.ok(isPdfSource(staged));
  assert.equal(staged.contentHash, source.contentHash);
  await parseAndPersistPdf(repo, context.id, staged);
  const newHash = await hashBlob(newBlob);
  const newDoc = await repo.getNormalizedDocument(source.id, newHash);
  assert.ok(newDoc);
  assert.match(newDoc.pages[0]?.text ?? "", /New revision/);
  assert.notEqual(oldDoc.contentHash, newDoc.contentHash);
  assert.equal(await repo.getNormalizedDocument(source.id, source.contentHash).then((doc) => doc?.contentHash), oldDoc.contentHash);
});

test("parser and normalizer version mismatch invalidates cached NormalizedDocument", async () => {
  const repo = createMemoryRepository();
  const context = await repo.createContext({ name: "notes" });
  const stale: NormalizedDocument = {
    contextId: context.id,
    sourceId: "src-stale",
    path: "a.pdf",
    contentHash: "abc",
    type: "pdf",
    parserVersion: PDF_PARSER_VERSION,
    normalizerVersion: DOCUMENT_NORMALIZER_VERSION,
    pageCount: 0,
    outline: [],
    pages: [],
    readiness: "ready",
  };
  await repo.putNormalizedDocument(context.id, stale);
  assert.ok(await repo.getNormalizedDocument("src-stale", "abc"));
  await repo.putNormalizedDocument(context.id, { ...stale, parserVersion: PDF_PARSER_VERSION + 1 });
  assert.equal(await repo.getNormalizedDocument("src-stale", "abc"), null);
  await repo.putNormalizedDocument(context.id, { ...stale, normalizerVersion: DOCUMENT_NORMALIZER_VERSION + 1 });
  assert.equal(await repo.getNormalizedDocument("src-stale", "abc"), null);
});

test("warm code-only hydration never loads Blob or NormalizedDocument", async () => {
  const repo = createMemoryRepository();
  const { context } = await persistPackAsContext(TEXT_PACK, repo);
  const pdf = pdfBlob({ pages: [{ items: [{ str: "Lecture body text here.", x: 72, y: 700 }] }] });
  await repo.upsertSources(context.id, [{ path: "Lecture-08.pdf", kind: "pdf", blob: pdf }]);
  repo.blobLoadCount = 0;
  repo.normalizedLoadCount = 0;
  await hydrateContext(repo, context.id);
  const runtime = await indexContext(repo, context.id);
  runtimeFromPack(runtime.pack);
  const sources = await repo.listSources(context.id);
  packFromSources(context, sources);
  assert.equal(repo.blobLoadCount, 0);
  assert.equal(repo.normalizedLoadCount, 0);
});

test("listSources still does not load blobs after a PDF is parsed", async () => {
  const repo = createMemoryRepository();
  const context = await repo.createContext({ name: "notes" });
  const blob = pdfBlob({ pages: [{ items: [{ str: "Lecture body text here.", x: 72, y: 700 }] }] });
  const [source] = await repo.upsertSources(context.id, [{ path: "a.pdf", kind: "pdf", blob }]);
  assert.ok(isPdfSource(source));
  await parseAndPersistPdf(repo, context.id, source);
  repo.blobLoadCount = 0;
  repo.normalizedLoadCount = 0;
  const listed = await repo.listSources(context.id);
  assert.equal(listed.length, 1);
  assert.equal("blob" in listed[0], false);
  assert.equal(repo.blobLoadCount, 0);
  assert.equal(repo.normalizedLoadCount, 0);
});

test("replacement keeps OLD_HASH active until staged parse is terminal and activation commits", async () => {
  const repo = createMemoryRepository();
  const context = await repo.createContext({ name: "notes" });
  const oldBlob = pdfBlob({ pages: [{ items: [{ str: "Active snapshot body text.", x: 72, y: 700 }] }] });
  const newBlob = pdfBlob({ pages: [{ items: [{ str: "Staged snapshot body text.", x: 72, y: 700 }] }] });
  const [active] = await repo.upsertSources(context.id, [{ path: "a.pdf", kind: "pdf", blob: oldBlob }]);
  assert.ok(isPdfSource(active));
  await parseAndPersistPdf(repo, context.id, active);

  await repo.upsertSources(context.id, [{ path: "a.pdf", kind: "pdf", blob: newBlob }]);
  const pending = (await repo.listSources(context.id))[0];
  assert.ok(isPdfSource(pending));
  assert.equal(pending.contentHash, active.contentHash);
  assert.ok(pending.stagedContentHash);

  const beforeParse = await repo.completeContextActivation(context.id);
  const stillPending = (await repo.listSources(context.id))[0];
  assert.ok(isPdfSource(stillPending));
  assert.equal(stillPending.contentHash, active.contentHash);
  assert.equal(stillPending.stagedContentHash, pending.stagedContentHash);
  assert.equal(beforeParse.status, "indexing");

  const afterParse = await parseAndPersistPdf(repo, context.id, stillPending);
  assert.equal(afterParse.readiness, "ready");
  const parsed = (await repo.listSources(context.id))[0];
  assert.ok(isPdfSource(parsed));
  assert.equal(parsed.contentHash, active.contentHash);
  assert.equal(parsed.stagedReadiness, "ready");
  assert.equal(parsed.stagedChunked, undefined);
  assert.equal((await repo.getContext(context.id))?.status, "indexing");

  const beforeChunks = await repo.completeContextActivation(context.id);
  const stillUnchunked = (await repo.listSources(context.id))[0];
  assert.ok(isPdfSource(stillUnchunked));
  assert.equal(stillUnchunked.contentHash, active.contentHash);
  assert.equal(stillUnchunked.stagedContentHash, pending.stagedContentHash);
  assert.equal(beforeChunks.status, "indexing");

  await indexContext(repo, context.id);
  const chunked = (await repo.listSources(context.id))[0];
  assert.ok(isPdfSource(chunked));
  assert.equal(chunked.stagedChunked, true);
  assert.equal(chunked.contentHash, active.contentHash);

  const committed = await repo.completeContextActivation(context.id);
  const swapped = (await repo.listSources(context.id))[0];
  assert.ok(isPdfSource(swapped));
  assert.equal(swapped.contentHash, pending.stagedContentHash);
  assert.equal(swapped.stagedContentHash, undefined);
  assert.equal(swapped.readiness, "ready");
  assert.equal(committed.status, "ready");
  assert.equal(await repo.getSourceBlob(active.id, active.contentHash), null);
  const live = await repo.getNormalizedDocument(swapped.id, swapped.contentHash);
  assert.match(live?.pages[0]?.text ?? "", /Staged snapshot/);
});

test("parser benchmark on representative fixtures", async () => {
  const fixtures = {
    lecture: buildPdfBytes({
      pages: [{ items: [{ str: "Serializable isolation prevents lost outcomes.", x: 72, y: 700 }] }],
    }),
    multipage: buildPdfBytes({
      pages: [
        { items: [{ str: "Lecture page one body.", x: 72, y: 700 }] },
        { items: [{ str: "Lecture page two body.", x: 72, y: 700 }] },
        { items: [{ str: "Lecture page three body.", x: 72, y: 700 }] },
      ],
    }),
    twocol: buildPdfBytes({
      pages: [
        {
          items: [
            { str: "Left column first sentence is here.", x: 72, y: 700 },
            { str: "Left column second sentence follows.", x: 72, y: 682 },
            { str: "Left column third sentence remains.", x: 72, y: 664 },
            { str: "Right column first sentence is here.", x: 340, y: 700 },
            { str: "Right column second sentence follows.", x: 340, y: 682 },
            { str: "Right column third sentence remains.", x: 340, y: 664 },
          ],
        },
      ],
    }),
  };
  const timings: Record<string, number> = {};
  for (const [name, bytes] of Object.entries(fixtures)) {
    const started = performance.now();
    const result = await parsePdfForBench(bytes);
    timings[name] = performance.now() - started;
    assert.equal(result.readiness, "ready");
  }
  console.log(`pdf-parse-bench ${JSON.stringify(timings)}`);
  assert.ok(Object.values(timings).every((ms) => ms < 10_000));
});

async function parsePdfForBench(bytes: Uint8Array) {
  const { parsePdf } = await import("../parse.ts");
  return parsePdf({
    contextId: "bench",
    sourceId: "bench",
    path: "bench.pdf",
    contentHash: "bench",
    blob: (() => {
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      return new Blob([copy], { type: "application/pdf" });
    })(),
  });
}
