import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import "fake-indexeddb/auto";

import Dexie, { type Table } from "dexie";
import { reconstructSourceText } from "../../document/source-text.ts";
import type { NormalizedDocument } from "../../document/types.ts";
import { hashBlob, hashBytes } from "../hash.ts";
import { persistPackAsContext, setContextRepository } from "../service.ts";
import { createMemoryRepository } from "../memory.ts";
import { createIndexedDbRepository } from "../storage/indexeddb.ts";
import {
  CONTEXT_INDEXES,
  INDEXED_SOURCE_INDEXES,
  SOURCE_INDEXES,
  STORED_CHUNK_INDEXES,
} from "../storage/schema.ts";
import { hydrateContext, packFromSources, runtimeFromPack } from "../hydrate.ts";
import { indexContext } from "../chunk-index.ts";
import type { ContextRepository } from "../repository.ts";
import type { ContextRecord, StoredSource } from "../types.ts";
import { isPdfSource, isTextSource } from "../types.ts";
import { citationText } from "../../search/cite.ts";
import { documentIsCurrent, type DocumentEvidence } from "../../search/evidence.ts";
import {
  DOCUMENT_NORMALIZER_VERSION,
  PDF_PARSER_VERSION,
} from "../index-versions.ts";
import type { RepoPack } from "../../repo/types.ts";

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

let dbSerial = 0;

function repos(): Array<{ name: string; repo: ContextRepository }> {
  dbSerial += 1;
  return [
    { name: "memory", repo: createMemoryRepository() },
    { name: "indexeddb", repo: createIndexedDbRepository(`meethint-docs-${dbSerial}`) },
  ];
}

function pdfBlob(bytes: string): Blob {
  return new Blob([bytes], { type: "application/pdf" });
}

afterEach(() => {
  setContextRepository(null);
});

test("text sources still persist exactly as before", async () => {
  for (const { name, repo } of repos()) {
    const { context, pack } = await persistPackAsContext(TEXT_PACK, repo);
    const sources = await repo.listSources(context.id);
    assert.equal(sources.length, 1, name);
    assert.equal(sources[0].kind, "file", name);
    assert.ok(isTextSource(sources[0]));
    assert.equal(sources[0].content, TEXT_PACK.files[0].content, name);
    assert.equal(pack.files[0].content, TEXT_PACK.files[0].content, name);
    assert.equal((await repo.getContext(context.id))?.status, "ready", name);
  }
});

test("PdfStoredSource metadata round-trips without a blob field", async () => {
  for (const { name, repo } of repos()) {
    const context = await repo.createContext({ name: "notes" });
    const blob = pdfBlob("%PDF-1.4 lecture-08-aaa");
    const written = await repo.upsertSources(context.id, [
      { path: "Lecture-08.pdf", kind: "pdf", mimeType: "application/pdf", blob },
    ]);
    assert.equal(written.length, 1, name);
    const source = written[0];
    assert.equal(source.kind, "pdf", name);
    assert.ok(isPdfSource(source));
    assert.equal(source.path, "Lecture-08.pdf", name);
    assert.equal(source.mimeType, "application/pdf", name);
    assert.equal(source.readiness, "pending", name);
    assert.equal(source.contentHash, await hashBlob(blob), name);
    assert.equal("blob" in source, false, name);
    assert.equal("content" in source, false, name);
    const listed = await repo.listSources(context.id);
    assert.deepEqual(listed, written, name);
    assert.equal((await repo.getContext(context.id))?.status, "indexing", name);
  }
});

test("listSources does not return Blobs", async () => {
  for (const { name, repo } of repos()) {
    const context = await repo.createContext({ name: "notes" });
    await repo.upsertSources(context.id, [{ path: "a.pdf", kind: "pdf", blob: pdfBlob("%PDF-old") }]);
    const sources = await repo.listSources(context.id);
    for (const source of sources) {
      assert.equal("blob" in source, false, name);
    }
  }
});

test("Blob round-trips through getSourceBlob(sourceId, contentHash)", async () => {
  for (const { name, repo } of repos()) {
    const context = await repo.createContext({ name: "notes" });
    const bytes = "%PDF-1.4 exact-bytes-xyz";
    const blob = pdfBlob(bytes);
    const [source] = await repo.upsertSources(context.id, [{ path: "a.pdf", kind: "pdf", blob }]);
    assert.ok(isPdfSource(source));
    const loaded = await repo.getSourceBlob(source.id, source.contentHash);
    assert.ok(loaded, name);
    assert.equal(await loaded.text(), bytes, name);
    assert.equal(await hashBlob(loaded), source.contentHash, name);
  }
});

test("two Blob revisions for the same sourceId can coexist", async () => {
  for (const { name, repo } of repos()) {
    const context = await repo.createContext({ name: "notes" });
    const oldBlob = pdfBlob("%PDF-old-revision");
    const newBlob = pdfBlob("%PDF-new-revision");
    const [first] = await repo.upsertSources(context.id, [{ path: "a.pdf", kind: "pdf", blob: oldBlob }]);
    assert.ok(isPdfSource(first));
    const oldHash = first.contentHash;
    const [staged] = await repo.upsertSources(context.id, [{ path: "a.pdf", kind: "pdf", blob: newBlob }]);
    assert.ok(isPdfSource(staged));
    const newHash = await hashBlob(newBlob);
    assert.equal(staged.contentHash, oldHash, name);
    assert.equal(staged.stagedContentHash, newHash, name);
    const oldBytes = await repo.getSourceBlob(first.id, oldHash);
    const newBytes = await repo.getSourceBlob(first.id, newHash);
    assert.equal(await oldBytes?.text(), "%PDF-old-revision", name);
    assert.equal(await newBytes?.text(), "%PDF-new-revision", name);
  }
});

test("OLD_HASH and NEW_HASH resolve their own bytes while staged", async () => {
  for (const { name, repo } of repos()) {
    const context = await repo.createContext({ name: "notes" });
    const oldBlob = pdfBlob("%PDF-alpha");
    const newBlob = pdfBlob("%PDF-beta");
    const [source] = await repo.upsertSources(context.id, [{ path: "a.pdf", kind: "pdf", blob: oldBlob }]);
    await repo.upsertSources(context.id, [{ path: "a.pdf", kind: "pdf", blob: newBlob }]);
    const oldHash = await hashBlob(oldBlob);
    const newHash = await hashBlob(newBlob);
    assert.equal(await (await repo.getSourceBlob(source.id, oldHash))?.text(), "%PDF-alpha", name);
    assert.equal(await (await repo.getSourceBlob(source.id, newHash))?.text(), "%PDF-beta", name);
  }
});

test("removing a Context removes its PDF blob revisions", async () => {
  for (const { name, repo } of repos()) {
    const context = await repo.createContext({ name: "notes" });
    const oldBlob = pdfBlob("%PDF-gone-old");
    const newBlob = pdfBlob("%PDF-gone-new");
    const [source] = await repo.upsertSources(context.id, [{ path: "a.pdf", kind: "pdf", blob: oldBlob }]);
    await repo.upsertSources(context.id, [{ path: "a.pdf", kind: "pdf", blob: newBlob }]);
    const oldHash = await hashBlob(oldBlob);
    const newHash = await hashBlob(newBlob);
    await repo.deleteContext(context.id);
    assert.equal(await repo.getContext(context.id), null, name);
    assert.equal(await repo.getSourceBlob(source.id, oldHash), null, name);
    assert.equal(await repo.getSourceBlob(source.id, newHash), null, name);
  }
});

test("Dexie v2 → v3 preserves existing Contexts and text sources", async () => {
  const name = `meethint-v2-v3-${crypto.randomUUID()}`;
  class V2Database extends Dexie {
    contexts!: Table<ContextRecord, string>;
    sources!: Table<StoredSource, string>;
    constructor() {
      super(name);
      this.version(1).stores({
        contexts: CONTEXT_INDEXES,
        sources: SOURCE_INDEXES,
      });
      this.version(2).stores({
        contexts: CONTEXT_INDEXES,
        sources: SOURCE_INDEXES,
        indexedSources: INDEXED_SOURCE_INDEXES,
        storedChunks: STORED_CHUNK_INDEXES,
      });
    }
  }
  const v2 = new V2Database();
  const context: ContextRecord = {
    id: crypto.randomUUID(),
    name: "legacy-v2",
    createdAt: 1,
    updatedAt: 1,
    sourceCount: 1,
    status: "ready",
    schemaVersion: 1,
  };
  const source: StoredSource = {
    id: crypto.randomUUID(),
    contextId: context.id,
    path: "src/keep.ts",
    language: "ts",
    kind: "file",
    byteLength: 12,
    contentHash: await hashBytes(new TextEncoder().encode("export const keep = 1\n")),
    content: "export const keep = 1\n",
    createdAt: 1,
    updatedAt: 1,
  };
  await v2.contexts.add(context);
  await v2.sources.add(source);
  v2.close();

  const v3 = createIndexedDbRepository(name);
  const restored = await v3.getContext(context.id);
  const sources = await v3.listSources(context.id);
  assert.equal(restored?.name, "legacy-v2");
  assert.equal(sources.length, 1);
  assert.ok(isTextSource(sources[0]));
  assert.equal(sources[0].content, source.content);
  assert.equal(await v3.getSourceBlob(sources[0].id, sources[0].contentHash), null);
});

test("upsertSources does not replace unrelated sources", async () => {
  for (const { name, repo } of repos()) {
    const { context } = await persistPackAsContext(TEXT_PACK, repo);
    await repo.upsertSources(context.id, [{ path: "Lecture-08.pdf", kind: "pdf", blob: pdfBlob("%PDF-notes") }]);
    const sources = await repo.listSources(context.id);
    assert.equal(sources.length, 2, name);
    assert.ok(sources.some((row) => isTextSource(row) && row.path === "src/retry.ts"), name);
    assert.ok(sources.some((row) => isPdfSource(row) && row.path === "Lecture-08.pdf"), name);
    const text = sources.find(isTextSource);
    assert.equal(text?.content, TEXT_PACK.files[0].content, name);
  }
});

test("same PDF path + same hash is a no-op", async () => {
  for (const { name, repo } of repos()) {
    const context = await repo.createContext({ name: "notes" });
    const blob = pdfBlob("%PDF-same");
    const first = await repo.upsertSources(context.id, [{ path: "a.pdf", kind: "pdf", blob }]);
    const after = await repo.getContext(context.id);
    const second = await repo.upsertSources(context.id, [{ path: "a.pdf", kind: "pdf", blob }]);
    const again = await repo.getContext(context.id);
    assert.equal(first[0].id, second[0].id, name);
    assert.ok(isPdfSource(first[0]) && isPdfSource(second[0]));
    assert.equal(first[0].contentHash, second[0].contentHash, name);
    assert.equal(first[0].updatedAt, second[0].updatedAt, name);
    assert.equal(after?.updatedAt, again?.updatedAt, name);
  }
});

test("same PDF path + new hash stages a revision without invalidating the active one", async () => {
  for (const { name, repo } of repos()) {
    const context = await repo.createContext({ name: "notes" });
    const oldBlob = pdfBlob("%PDF-active");
    const newBlob = pdfBlob("%PDF-staged");
    const [active] = await repo.upsertSources(context.id, [{ path: "a.pdf", kind: "pdf", blob: oldBlob }]);
    assert.ok(isPdfSource(active));
    const [pending] = await repo.upsertSources(context.id, [{ path: "a.pdf", kind: "pdf", blob: newBlob }]);
    assert.ok(isPdfSource(pending));
    assert.equal(pending.id, active.id, name);
    assert.equal(pending.contentHash, active.contentHash, name);
    assert.equal(pending.stagedContentHash, await hashBlob(newBlob), name);
    assert.notEqual(pending.stagedContentHash, pending.contentHash, name);
    assert.equal(await (await repo.getSourceBlob(active.id, active.contentHash))?.text(), "%PDF-active", name);
    const after = await repo.completeContextActivation(context.id);
    const still = (await repo.listSources(context.id))[0];
    assert.ok(isPdfSource(still));
    assert.equal(still.contentHash, active.contentHash, name);
    assert.equal(still.stagedContentHash, pending.stagedContentHash, name);
    assert.equal(still.readiness, "pending", name);
    assert.equal(after.status, "indexing", name);
    assert.equal(await (await repo.getSourceBlob(active.id, active.contentHash))?.text(), "%PDF-active", name);
    assert.equal(await (await repo.getSourceBlob(active.id, still.stagedContentHash!))?.text(), "%PDF-staged", name);
  }
});

test("code-only runtime paths do not load sourceBlobs or normalizedDocuments", async () => {
  const repo = createMemoryRepository();
  const { context } = await persistPackAsContext(TEXT_PACK, repo);
  assert.equal(repo.blobLoadCount, 0);
  assert.equal(repo.normalizedLoadCount, 0);
  await hydrateContext(repo, context.id);
  assert.equal(repo.blobLoadCount, 0);
  assert.equal(repo.normalizedLoadCount, 0);
  const runtime = await indexContext(repo, context.id);
  assert.equal(repo.blobLoadCount, 0);
  assert.equal(repo.normalizedLoadCount, 0);
  runtimeFromPack(runtime.pack);
  assert.equal(repo.blobLoadCount, 0);
  assert.equal(repo.normalizedLoadCount, 0);
  const sources = await repo.listSources(context.id);
  packFromSources(context, sources);
  assert.equal(repo.blobLoadCount, 0);
  assert.equal(repo.normalizedLoadCount, 0);
});

test("document currentness reads cached items, not a reparse", () => {
  const document: NormalizedDocument = {
    contextId: "ctx-1",
    sourceId: "src-1",
    path: "Lecture-08.pdf",
    contentHash: "abc",
    type: "pdf",
    parserVersion: PDF_PARSER_VERSION,
    normalizerVersion: DOCUMENT_NORMALIZER_VERSION,
    pageCount: 1,
    outline: [],
    readiness: "ready",
    pages: [
      {
        pageNumber: 18,
        text: "Serializable isolation prevents lost outcomes.",
        items: [
          {
            itemIndex: 0,
            str: "Serializable",
            transform: [1, 0, 0, 1, 0, 0],
            width: 10,
            height: 10,
          },
          {
            itemIndex: 1,
            str: "isolation",
            transform: [1, 0, 0, 1, 20, 0],
            width: 10,
            height: 10,
          },
        ],
        segments: [],
        readingOrder: "single-column",
        usefulItemCount: 2,
        index: "full",
      },
    ],
  };
  const evidence: DocumentEvidence = {
    kind: "document",
    id: "e1",
    sourceId: "src-1",
    sourceType: "pdf",
    path: "Lecture-08.pdf",
    page: 18,
    sourceText: "Serializableisolation",
    supportText: "Serializable isolation",
    spokenText: "Serializable isolation",
    contentHash: "abc",
    parserVersion: PDF_PARSER_VERSION,
    normalizerVersion: DOCUMENT_NORMALIZER_VERSION,
    itemRanges: [
      { page: 18, itemIndex: 0, charStart: 0, charEnd: 12 },
      { page: 18, itemIndex: 1, charStart: 0, charEnd: 9 },
    ],
  };
  assert.equal(reconstructSourceText(document, evidence.itemRanges), "Serializableisolation");
  assert.equal(documentIsCurrent(evidence, document), true);
  assert.equal(documentIsCurrent({ ...evidence, parserVersion: PDF_PARSER_VERSION + 1 }, document), false);
  assert.equal(documentIsCurrent({ ...evidence, normalizerVersion: DOCUMENT_NORMALIZER_VERSION + 1 }, document), false);
  assert.equal(documentIsCurrent({ ...evidence, contentHash: "other" }, document), false);
  assert.equal(
    citationText({
      kind: "document",
      sourceId: "src-1",
      path: "Lecture-08.pdf",
      page: 18,
      label: "",
    }),
    "Lecture-08.pdf · Page 18",
  );
});
