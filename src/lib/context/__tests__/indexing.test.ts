import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import "fake-indexeddb/auto";

import Dexie, { type Table } from "dexie";
import type { Chunk, Citation, RepoPack } from "../../repo/types.ts";
import type { Evidence } from "../../search/evidence.ts";
import { NORTHSTAR } from "../../repo/northstar.ts";
import { localCard } from "../../search/local-card.ts";
import { buildChunks, retrieve } from "../../search/retrieve.ts";
import { chunksEquivalent, indexContext, lastIndexReport } from "../chunk-index.ts";
import { persistPackAsContext, setContextRepository } from "../service.ts";
import { createMemoryRepository } from "../memory.ts";
import { createIndexedDbRepository } from "../storage/indexeddb.ts";
import { CONTEXT_INDEXES, SOURCE_INDEXES } from "../storage/schema.ts";
import { isTextSource, type ContextRecord, type StoredSource } from "../types.ts";

function snapEvidence(item: Evidence) {
  if (item.kind === "commit") return { kind: item.kind, sha: item.sha };
  if (item.kind === "document") {
    return { kind: item.kind, sourceId: item.sourceId, page: item.page, sourceText: item.sourceText };
  }
  return {
    kind: item.kind,
    path: item.path,
    startLine: item.startLine,
    endLine: item.endLine,
    startOffset: item.startOffset,
    endOffset: item.endOffset,
    text: item.text,
  };
}

function snapCitation(cite: Citation) {
  if (cite.kind === "file") return `${cite.path}:${cite.line}`;
  if (cite.kind === "document") return `${cite.path}:${cite.page}`;
  return cite.sha;
}

function file(path: string, content: string) {
  return { path, language: "ts", content };
}

function pack(name: string, files: RepoPack["files"], id = name): RepoPack {
  return { id, name, description: name, commits: [], files };
}

const ALPHA = "ALPHA_ONLY_92817";
const BETA = "BETA_ONLY_38111";

const PACK_A = pack("alpha-ctx", [
  file("src/a.ts", `/** Unique token ${ALPHA} lives only in context A. */\nexport const a = 1\n`),
  file("src/shared.ts", `/** Shared helper for exports. */\nexport function help() { return 1 }\n`),
]);

const PACK_B = pack("beta-ctx", [
  file("src/b.ts", `/** Unique token ${BETA} lives only in context B. */\nexport const b = 2\n`),
  file("src/shared.ts", `/** Shared helper for notes. */\nexport function help() { return 2 }\n`),
]);

afterEach(() => {
  setContextRepository(null);
});

test("same source + same hash + same versions reuses chunks", async () => {
  const repo = createMemoryRepository();
  const { context } = await persistPackAsContext(PACK_A, repo);
  const first = await indexContext(repo, context.id);
  assert.equal(first.report.rebuiltSourceCount, 2);
  assert.equal(first.report.reusedSourceCount, 0);
  const second = await indexContext(repo, context.id);
  assert.equal(second.report.reusedSourceCount, 2);
  assert.equal(second.report.rebuiltSourceCount, 0);
  assert.ok(chunksEquivalent(first.chunks, second.chunks));
});

test("changed hash rebuilds only that source", async () => {
  const repo = createMemoryRepository();
  const { context } = await persistPackAsContext(PACK_A, repo);
  await indexContext(repo, context.id);
  const next = pack("alpha-ctx", [
    file("src/a.ts", `/** Unique token ${ALPHA} was edited. */\nexport const a = 2\n`),
    file("src/shared.ts", PACK_A.files[1].content),
  ]);
  await repo.replaceSources(context.id, next.files);
  const report = (await indexContext(repo, context.id)).report;
  assert.equal(report.rebuiltSourceCount, 1);
  assert.equal(report.reusedSourceCount, 1);
});

test("a new source is indexed alone", async () => {
  const repo = createMemoryRepository();
  const { context } = await persistPackAsContext(PACK_A, repo);
  await indexContext(repo, context.id);
  const next = pack("alpha-ctx", [
    ...PACK_A.files,
    file("src/new.ts", "/** Brand new source for the exporter. */\nexport const n = 3\n"),
  ]);
  await repo.replaceSources(context.id, next.files);
  const report = (await indexContext(repo, context.id)).report;
  assert.equal(report.newSourceCount, 1);
  assert.equal(report.reusedSourceCount, 2);
  assert.equal(report.rebuiltSourceCount, 1);
});

test("deleted sources drop their cached chunks", async () => {
  const repo = createMemoryRepository();
  const { context } = await persistPackAsContext(PACK_A, repo);
  await indexContext(repo, context.id);
  await repo.replaceSources(context.id, [PACK_A.files[1]]);
  const report = (await indexContext(repo, context.id)).report;
  assert.equal(report.deletedSourceCount, 1);
  assert.equal(report.reusedSourceCount, 1);
  const leftover = await repo.listIndexed(context.id);
  assert.equal(leftover.length, 1);
});

test("chunker version invalidation rebuilds", async () => {
  const repo = createMemoryRepository();
  const { context } = await persistPackAsContext(PACK_A, repo);
  await indexContext(repo, context.id);
  const report = (await indexContext(repo, context.id, { chunkerVersion: 2 })).report;
  assert.equal(report.rebuiltSourceCount, 2);
  assert.equal(report.reusedSourceCount, 0);
});

test("index version invalidation rebuilds", async () => {
  const repo = createMemoryRepository();
  const { context } = await persistPackAsContext(PACK_A, repo);
  await indexContext(repo, context.id);
  const report = (await indexContext(repo, context.id, { indexVersion: 2 })).report;
  assert.equal(report.rebuiltSourceCount, 2);
  assert.equal(report.reusedSourceCount, 0);
});

test("cached chunks round-trip to equivalent runtime chunks", async () => {
  const repo = createMemoryRepository();
  const { context, pack: stored } = await persistPackAsContext(PACK_A, repo);
  const fresh = buildChunks(stored);
  const first = await indexContext(repo, context.id);
  const warm = await indexContext(repo, context.id);
  assert.ok(chunksEquivalent(fresh, first.chunks));
  assert.ok(chunksEquivalent(fresh, warm.chunks));
});

test("cached chunks never cross contexts", async () => {
  const repo = createMemoryRepository();
  const a = await persistPackAsContext(PACK_A, repo);
  const b = await persistPackAsContext(PACK_B, repo);
  await indexContext(repo, a.context.id);
  const indexedB = await indexContext(repo, b.context.id);
  assert.equal(
    indexedB.chunks.some((chunk) => chunk.text.includes(ALPHA)),
    false,
  );
  const hits = retrieve(ALPHA, indexedB.chunks);
  assert.equal(hits.filter((hit) => hit.text.includes(ALPHA)).length, 0);
});

test("corrupt cache rebuilds that source and still becomes ready", async () => {
  const repo = createMemoryRepository();
  const { context } = await persistPackAsContext(PACK_A, repo);
  await indexContext(repo, context.id);
  const sources = await repo.listSources(context.id);
  repo.corruptChunks(context.id, sources[0].id, [{ id: "bad" } as Chunk]);
  const runtime = await indexContext(repo, context.id);
  assert.ok(runtime.chunks.length > 0);
  assert.equal(runtime.report.rebuiltSourceCount, 1);
  assert.equal(runtime.report.reusedSourceCount, 1);
  assert.ok(runtime.chunks.every((chunk) => chunk.id !== "bad"));
});

test("late A must not replace B's runtime", async () => {
  const repo = createMemoryRepository();
  const a = await persistPackAsContext(PACK_A, repo);
  const b = await persistPackAsContext(PACK_B, repo);
  const finishedA = await indexContext(repo, a.context.id, { isCancelled: () => true });
  const runtimeB = await indexContext(repo, b.context.id);
  assert.equal(finishedA.cancelled, true);
  assert.equal(runtimeB.cancelled, false);
  assert.equal(runtimeB.chunks.some((chunk) => chunk.text.includes(ALPHA)), false);
  assert.ok(runtimeB.chunks.some((chunk) => chunk.text.includes(BETA)));
});

test("A finishing after B must not become the applied runtime", async () => {
  const base = createMemoryRepository();
  const a = await persistPackAsContext(PACK_A, base);
  const b = await persistPackAsContext(PACK_B, base);
  let releaseA = () => {};
  const holdA = new Promise<void>((resolve) => {
    releaseA = resolve;
  });
  const gated = {
    ...base,
    listSources: async (id: string) => {
      if (id === a.context.id) await holdA;
      return base.listSources(id);
    },
  };
  let epoch = 0;
  async function activate(id: string) {
    const mine = (epoch += 1);
    const runtime = await indexContext(gated, id, { isCancelled: () => mine !== epoch });
    if (mine !== epoch || runtime.cancelled) return { applied: false, runtime };
    return { applied: true, runtime };
  }
  const startedA = activate(a.context.id);
  const finishedB = await activate(b.context.id);
  releaseA();
  const finishedA = await startedA;
  assert.equal(finishedA.applied, false);
  assert.equal(finishedB.applied, true);
  assert.equal(finishedB.runtime.chunks.some((chunk) => chunk.text.includes(ALPHA)), false);
  assert.ok(finishedB.runtime.chunks.some((chunk) => chunk.text.includes(BETA)));
});

test("Phase 2 database upgrades without losing sources", async () => {
  const name = `meethint-upgrade-${crypto.randomUUID()}`;
  class Phase2Database extends Dexie {
    contexts!: Table<ContextRecord, string>;
    sources!: Table<StoredSource, string>;
    constructor() {
      super(name);
      this.version(1).stores({
        contexts: CONTEXT_INDEXES,
        sources: SOURCE_INDEXES,
      });
    }
  }
  const v1 = new Phase2Database();
  const context: ContextRecord = {
    id: crypto.randomUUID(),
    name: "legacy",
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
    contentHash: "abc",
    content: "export const keep = 1\n",
    createdAt: 1,
    updatedAt: 1,
  };
  await v1.contexts.add(context);
  await v1.sources.add(source);
  v1.close();

  const v2 = createIndexedDbRepository(name);
  const restored = await v2.getContext(context.id);
  const sources = await v2.listSources(context.id);
  assert.equal(restored?.name, "legacy");
  assert.equal(sources.length, 1);
  assert.ok(isTextSource(sources[0]));
  assert.equal(sources[0].content, source.content);
  const indexed = await indexContext(v2, context.id);
  assert.ok(indexed.chunks.length >= 0);
  assert.equal((await v2.listIndexed(context.id)).length, 1);
});

test("Northstar commit evidence still comes from a fresh buildChunks", () => {
  const chunks = buildChunks(NORTHSTAR);
  assert.ok(chunks.some((chunk) => chunk.kind === "why" && chunk.sha));
  const hits = retrieve("Who touched the auth flow?", chunks);
  const card = localCard("Who touched the auth flow?", hits, NORTHSTAR, 0, null);
  assert.ok(card.say);
  assert.ok(card.citations.some((cite) => cite.kind === "commit"));
});

test("IndexedDB reuses chunks and stays isolated after reopen", async () => {
  const name = `meethint-index-${crypto.randomUUID()}`;
  const repo = createIndexedDbRepository(name);
  const a = await persistPackAsContext(PACK_A, repo);
  const b = await persistPackAsContext(PACK_B, repo);
  await indexContext(repo, a.context.id);
  const firstB = await indexContext(repo, b.context.id);
  const warmB = await indexContext(repo, b.context.id);
  assert.equal(warmB.report.reusedSourceCount, 2);
  assert.equal(warmB.report.rebuiltSourceCount, 0);
  assert.ok(chunksEquivalent(firstB.chunks, warmB.chunks));

  const reopened = createIndexedDbRepository(name);
  const reloadedB = await indexContext(reopened, b.context.id);
  assert.equal(reloadedB.report.reusedSourceCount, 2);
  assert.equal(
    reloadedB.chunks.some((chunk) => chunk.text.includes(ALPHA)),
    false,
  );
  const hits = retrieve(ALPHA, reloadedB.chunks);
  assert.equal(hits.filter((hit) => hit.text.includes(ALPHA)).length, 0);
});

test("fresh and cached indexes produce the same Card", async () => {
  const repo = createMemoryRepository();
  const { context, pack: stored } = await persistPackAsContext(PACK_A, repo);
  const query = `What is ${ALPHA}?`;
  const freshChunks = buildChunks(stored);
  const fresh = localCard(query, retrieve(query, freshChunks), stored, 0, null);
  await indexContext(repo, context.id);
  const cached = await indexContext(repo, context.id);
  assert.equal(lastIndexReport()?.reusedSourceCount, 2);
  const warm = localCard(query, retrieve(query, cached.chunks), cached.pack, 0, null);
  assert.equal(warm.query, fresh.query);
  assert.equal(warm.say, fresh.say);
  assert.deepEqual(
    (warm.evidence ?? []).map((item) => snapEvidence(item)),
    (fresh.evidence ?? []).map((item) => snapEvidence(item)),
  );
  assert.deepEqual(
    warm.citations.map((c) => snapCitation(c)),
    fresh.citations.map((c) => snapCitation(c)),
  );
});
