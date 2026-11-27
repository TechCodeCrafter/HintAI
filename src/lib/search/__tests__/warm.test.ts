import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import "fake-indexeddb/auto";

import { createMemoryRepository } from "../../context/memory.ts";
import { persistPackAsContext, setContextRepository } from "../../context/service.ts";
import { indexSpace } from "../../context/space-index.ts";
import type { Chunk, IndexedChunk, RepoPack } from "../../repo/types.ts";
import { embedInBackground, embeddingIdle, hashChunk } from "../embed-chunks.ts";
import { bagEmbedding384, setEmbedderForTests } from "../embedding.ts";
import { listenGate, searchModeFor, warmPhase, type SearchWarmth } from "../readiness.ts";
import { hybridRetrieve, retrieve, retrieveHits, searchIndexWarm, warmSearchIndex } from "../retrieve.ts";
import { testRetrievalScope, vectorCacheKey } from "../retrieval-scope.ts";
import { createMemoryVectorStore, type VectorStore } from "../vector-store.ts";
import { expectsVectors, warmSearch, warmWords } from "../warm.ts";

afterEach(() => {
  setEmbedderForTests(null);
});

/** Chunks of a stored space: tagged, so they are embedded when indexed. */
function spaceChunks(count: number, label = "a"): IndexedChunk[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${label}-${i}`,
    kind: "code" as const,
    path: `src/${label}/mod${i % 20}.ts`,
    startLine: 1,
    endLine: 3,
    startOffset: 0,
    text: `export function handler${i}() {\n  // settlement export retries with backoff number ${i}\n}\n`,
    workspaceId: "ws-test",
    spaceId: "space-test",
    contextId: "ctx-test",
  })) as IndexedChunk[];
}

function plainChunk(id: string, path: string, text: string): Chunk {
  return { id, kind: "code", path, startLine: 1, endLine: 4, startOffset: 0, text };
}

async function storeVectors(store: VectorStore, chunks: IndexedChunk[]): Promise<void> {
  await store.set(
    chunks.map((chunk) => ({
      chunkId: vectorCacheKey(chunk),
      embedding: bagEmbedding384(chunk.text),
      contentHash: hashChunk(chunk),
    })),
  );
}

/** A store that counts how often its vectors are read. */
function counting(inner: VectorStore): VectorStore & { reads: number } {
  const counted = {
    ...inner,
    reads: 0,
    async get(ids: string[]) {
      counted.reads += 1;
      return inner.get(ids);
    },
  };
  return counted;
}

const gateFor = (warmth: SearchWarmth) => listenGate({ working: false, errored: false, searchable: true, warmth });
const states = (seen: SearchWarmth[]) => seen.map((w) => `${warmPhase(w)}:${w.vectors.state}`);
/** The distinct steps a run reported, in order. */
const steps = (seen: SearchWarmth[]) => states(seen).filter((step, i, all) => step !== all[i - 1]);

// ── Warming: the word index, the vectors, the model ───────────────────────

test("material with no vectors to wait for: the word index is built in the background, then Ready", async () => {
  // The same chunks without a space behind them: nothing embeds these.
  const chunks = spaceChunks(300).map(
    (chunk) => ({ ...chunk, workspaceId: undefined, contextId: undefined }) as unknown as IndexedChunk,
  );
  assert.equal(expectsVectors(chunks, createMemoryVectorStore()), false);
  assert.equal(searchIndexWarm(chunks), false);

  const seen: SearchWarmth[] = [];
  let clock = 0;
  const done = warmSearch(chunks, {
    vectorStore: null,
    sliceMs: 0,
    now: () => (clock += 50),
    onChange: (warmth) => seen.push(warmth),
  });
  // The first report is written before warmSearch returns, and it is not Ready.
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].words, { done: 0, total: 300, ready: false });
  assert.equal(gateFor(seen[0]).ready, false);

  const final = await done;
  assert.equal(final.words.ready, true);
  assert.equal(final.vectors.state, "off");
  assert.equal(gateFor(final).ready, true);
  assert.equal(searchIndexWarm(chunks), true);
  // Progress was reported on the way, and only the last report is Ready.
  const counts = seen.map((w) => w.words.done);
  assert.ok(counts.some((n) => n > 0 && n < 300), `progress: ${counts.slice(0, 8)}`);
  assert.deepEqual(counts, [...counts].sort((a, b) => a - b));
  assert.deepEqual(
    seen.map((w) => gateFor(w).ready),
    [...seen.slice(0, -1).map(() => false), true],
  );
  assert.deepEqual(searchModeFor(final), { semantic: true, lexicalOnly: false });
});

test("vectors already on the device: read into memory with the model loaded, then Ready and hybrid", async () => {
  const chunks = spaceChunks(60, "b");
  const store = counting(createMemoryVectorStore());
  await storeVectors(store, chunks);
  assert.equal(expectsVectors(chunks, store), true);

  let modelLoads = 0;
  const seen: SearchWarmth[] = [];
  const final = await warmSearch(chunks, {
    vectorStore: store,
    embed: async () => {
      modelLoads += 1;
      return [1];
    },
    onChange: (warmth) => seen.push(warmth),
  });
  assert.deepEqual(final.vectors, { state: "ready", have: 60, total: 60 });
  assert.equal(modelLoads, 1, "the model that embeds a question is loaded once, ahead of the question");
  assert.ok(store.reads > 0, "the vectors were read ahead of the first question");
  assert.deepEqual(steps(seen), ["words:warming", "vectors:warming", "ready:ready"]);
  assert.equal(gateFor(final).ready, true);
  assert.deepEqual(searchModeFor(final), { semantic: true, lexicalOnly: false });
});

test("vectors that are late: Listen is held for a moment, then opens on the lexical path, then hybrid by itself", async () => {
  const chunks = spaceChunks(40, "c");
  const store = createMemoryVectorStore();
  // The index pass is still embedding: the model answers only when released.
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  setEmbedderForTests(async (text) => {
    await held;
    return bagEmbedding384(text);
  });
  void embedInBackground(chunks, store);

  const seen: SearchWarmth[] = [];
  let onLexical = () => {};
  const lexical = new Promise<void>((resolve) => {
    onLexical = resolve;
  });
  const done = warmSearch(chunks, {
    vectorStore: store,
    vectorWaitMs: 30,
    pollMs: 5,
    embed: async () => [1],
    onChange: (warmth) => {
      seen.push(warmth);
      if (warmth.vectors.state === "lexical") onLexical();
    },
  });

  await lexical;
  const waiting = seen.at(-1)!;
  assert.deepEqual(steps(seen), ["words:warming", "vectors:warming", "ready:lexical"]);
  // Ready, on word search: Listen may start, and the next question says so.
  assert.equal(gateFor(waiting).ready, true);
  assert.deepEqual(searchModeFor(waiting), { semantic: false, lexicalOnly: true });
  assert.equal(waiting.vectors.have, 0);

  release();
  const final = await done;
  assert.deepEqual(final.vectors, { state: "ready", have: 40, total: 40 });
  assert.deepEqual(steps(seen), ["words:warming", "vectors:warming", "ready:lexical", "ready:ready"]);
  // Nothing was switched by hand: the question after this one is hybrid.
  assert.deepEqual(searchModeFor(final), { semantic: true, lexicalOnly: false });
  assert.equal(gateFor(final).ready, true);
});

test("an index pass that was cut short: what is missing is embedded under the warm-up", async () => {
  const chunks = spaceChunks(30, "d");
  const store = createMemoryVectorStore();
  await storeVectors(store, chunks.slice(0, 10));
  setEmbedderForTests(async (text) => bagEmbedding384(text));
  assert.equal((await store.get(chunks.map(vectorCacheKey))).size, 10);

  const final = await warmSearch(chunks, { vectorStore: store, pollMs: 5, onChange: () => {} });
  assert.deepEqual(final.vectors, { state: "ready", have: 30, total: 30 });
});

test("a model that will not load: Ready on the lexical path, and it stays there", async () => {
  const chunks = spaceChunks(20, "e");
  const store = createMemoryVectorStore();
  await storeVectors(store, chunks);
  const final = await warmSearch(chunks, {
    vectorStore: store,
    pollMs: 5,
    embed: async () => {
      throw new Error("model unavailable offline");
    },
    onChange: () => {},
  });
  // The vectors are there, but a question cannot be embedded to compare with them.
  assert.equal(final.vectors.state, "lexical");
  assert.equal(gateFor(final).ready, true);
  assert.deepEqual(searchModeFor(final), { semantic: false, lexicalOnly: true });
});

test("chunks that are replaced end their warm-up: nothing more is reported for them", async () => {
  const chunks = spaceChunks(200, "f");
  const seen: SearchWarmth[] = [];
  let replaced = false;
  const final = await warmSearch(chunks, {
    vectorStore: null,
    sliceMs: 0,
    isCancelled: () => replaced,
    onChange: (warmth) => {
      seen.push(warmth);
      replaced = true;
    },
  });
  assert.equal(seen.length, 1);
  assert.equal(final.words.ready, false);
  assert.equal(searchIndexWarm(chunks), false);
});

// ── The lexical fast path ─────────────────────────────────────────────────

test("the lexical fast path reads no vector and embeds nothing, and still ranks the right chunk first", async () => {
  const chunks = [
    plainChunk("retry", "src/exporter/retry.ts", "export const MAX_ATTEMPTS = 3; // the settlement export retries three times"),
    plainChunk("format", "src/exporter/format.ts", "Column order is locked for finance imports."),
    plainChunk("land", "src/s3.ts", "Objects land in the merchant prefix after the gateway accepts the file."),
  ];
  const store = counting(createMemoryVectorStore());
  await store.set(chunks.map((chunk) => ({ chunkId: chunk.id, embedding: bagEmbedding384(chunk.text), contentHash: chunk.id })));
  let embedded = 0;
  setEmbedderForTests(async (text) => {
    embedded += 1;
    return bagEmbedding384(text);
  });
  const options = { excludePatterns: undefined, vectorStore: store, scope: testRetrievalScope("ctx") };
  const query = "How many times does the settlement export retry?";

  const lexical = await retrieveHits(query, chunks, { ...options, semantic: false });
  assert.equal(store.reads, 0, "no vector was read");
  assert.equal(embedded, 0, "the question was not embedded");
  assert.equal(lexical[0]?.id, "retry");
  assert.ok(lexical.every((hit) => !hit.semanticScore), "no hit carries a vector score");
  // The same top hit the word channel gives on its own.
  assert.equal(lexical[0]?.id, retrieve(query, chunks)[0]?.id);

  // The next question, once the vectors are ready, uses them again.
  const hybrid = await retrieveHits(query, chunks, { ...options, semantic: true });
  assert.ok(store.reads > 0);
  assert.equal(embedded, 1);
  assert.equal(hybrid[0]?.id, "retry");
  assert.ok(hybrid.some((hit) => (hit.semanticScore ?? 0) > 0), "the vector channel is back in the ranking");
});

test("the lexical fast path answers at once while the vector store is still busy", async () => {
  const chunks = spaceChunks(50, "g");
  // A store whose read never comes back, like a first read of a large space.
  const stuck: VectorStore = { ...createMemoryVectorStore(), get: () => new Promise(() => {}) };
  let embedded = 0;
  setEmbedderForTests(async () => {
    embedded += 1;
    return new Promise<number[]>(() => {});
  });
  const hits = await hybridRetrieve("settlement export retries backoff number 7", chunks, stuck, 6, undefined, {
    semantic: false,
  });
  assert.ok(hits.length > 0);
  assert.equal(embedded, 0);
});

// ── Re-indexing behind a session ──────────────────────────────────────────

const PACK: RepoPack = {
  id: "folder-acme",
  name: "acme",
  description: "acme",
  commits: [],
  files: [
    { path: "README.md", language: "md", content: "# Retry service\n\nSettlement export retries are capped at three attempts.\n" },
    { path: "src/retry.ts", language: "ts", content: "export const MAX_ATTEMPTS = 3;\n" },
  ],
};

test("files added mid-session: the new index is warmed beside the one in use, then takes over warm", async () => {
  const repo = createMemoryRepository();
  setContextRepository(repo);
  setEmbedderForTests(async (text) => bagEmbedding384(text));
  const store = createMemoryVectorStore();
  const { context } = await persistPackAsContext(PACK, repo);

  const inUse = (await indexSpace(repo, context.id, { vectorStore: store })).chunks;
  const first = await warmSearch(inUse, { vectorStore: store, pollMs: 5, onChange: () => {} });
  assert.equal(first.vectors.state, "ready");
  const question = "How many attempts are settlement export retries capped at?";
  const before = await hybridRetrieve(question, inUse, store);
  assert.ok(before.some((hit) => hit.path.endsWith("README.md")));

  // The add: stored, then indexed. Search has not been handed the result yet.
  await persistPackAsContext(
    {
      ...PACK,
      name: "extra",
      files: [{ path: "docs/runbook.md", language: "md", content: "# Runbook\n\nReplay failed jobs from the okapi queue.\n" }],
    },
    repo,
    { contextId: context.id },
  );
  const incoming = (await indexSpace(repo, context.id, { vectorStore: store })).chunks;
  assert.ok(incoming.length > inUse.length);
  // A re-index hands back new chunk objects: nothing is indexed for them yet,
  // even for the files that did not change.
  assert.equal(searchIndexWarm(incoming), false);
  assert.equal(searchIndexWarm(inUse), true);

  // Meanwhile the session's material is untouched: the same question, the same answer.
  const during = await hybridRetrieve(question, inUse, store);
  assert.deepEqual(
    during.map((hit) => hit.id),
    before.map((hit) => hit.id),
  );

  assert.equal(await warmWords(incoming, { vectorStore: store }), true);
  assert.equal(searchIndexWarm(incoming), true);
  assert.equal(searchIndexWarm(inUse), true);

  // The swap. The warm-up for the new chunks finds the words already indexed,
  // so its first report, the one written as the chunks change, says so.
  const seen: SearchWarmth[] = [];
  const done = warmSearch(incoming, { vectorStore: store, pollMs: 5, onChange: (warmth) => seen.push(warmth) });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].words.ready, true);
  const final = await done;
  await embeddingIdle(store);
  assert.deepEqual(final.vectors, { state: "ready", have: incoming.length, total: incoming.length });
  assert.equal(seen.some((warmth) => !warmth.words.ready), false);

  const after = await hybridRetrieve("Where are failed jobs replayed from?", incoming, store);
  assert.ok(after.some((hit) => hit.path.endsWith("runbook.md")), after.map((hit) => hit.path).join(", "));
  const kept = await hybridRetrieve(question, incoming, store);
  assert.ok(kept.some((hit) => hit.path.endsWith("README.md")));
});

test("warming a re-index does not end the warm-up of the chunks in use, and is not ended by it", async () => {
  const inUse = spaceChunks(200, "h");
  const incoming = spaceChunks(120, "i");
  let beside: Promise<boolean> | null = null;
  const indexed = await warmSearchIndex(inUse, {
    sliceMs: 0,
    pause: async () => {
      beside ??= warmWords(incoming, { vectorStore: null, sliceMs: 0 });
    },
  });
  assert.equal(indexed, 200, "the warm-up in use ran to the end");
  assert.equal(await beside, true);
  assert.equal(searchIndexWarm(incoming), true);

  // And the other way round: a new warm-up for the chunks in use starts while
  // the re-index is still being warmed.
  const next = spaceChunks(150, "j");
  let exclusive: Promise<number> | null = null;
  let pauses = 0;
  const finished = await warmSearchIndex(next, {
    exclusive: false,
    sliceMs: 0,
    pause: async () => {
      pauses += 1;
      if (pauses === 3) exclusive = warmSearchIndex(spaceChunks(10, "k"), { sliceMs: 1000 });
    },
  });
  assert.equal(finished, 150);
  assert.equal(await exclusive, 10);
});

test("a cancelled re-index warm-up reports that it did not finish", async () => {
  const incoming = spaceChunks(100, "l");
  let cancelled = false;
  let reports = 0;
  const finished = await warmWords(incoming, {
    vectorStore: null,
    sliceMs: 0,
    isCancelled: () => cancelled,
    onProgress: () => {
      reports += 1;
      if (reports === 5) cancelled = true;
    },
  });
  assert.equal(finished, false);
  assert.equal(searchIndexWarm(incoming), false);
});
