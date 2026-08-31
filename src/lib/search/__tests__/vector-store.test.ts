import assert from "node:assert/strict";
import { test } from "node:test";

import "fake-indexeddb/auto";

import { indexContext } from "../../context/chunk-index.ts";
import { createMemoryRepository } from "../../context/memory.ts";
import { persistPackAsContext } from "../../context/service.ts";
import { createIndexedDbVectorStore } from "../../context/storage/vector-store-indexeddb.ts";
import { bagEmbedding384, setEmbedderForTests } from "../embedding.ts";
import { embedIndexedChunks, hashChunk } from "../embed-chunks.ts";
import { createMemoryVectorStore, type VectorStore } from "../vector-store.ts";

function chunk(id: string, text: string) {
  return {
    id,
    kind: "code" as const,
    path: "src/a.ts",
    startLine: 1,
    endLine: 2,
    startOffset: 0,
    text,
  };
}

async function checkStore(store: VectorStore) {
  await store.set([
    { chunkId: "a", embedding: [1, 2, 3], contentHash: "h1" },
    { chunkId: "b", embedding: [0, 1], contentHash: "h2" },
  ]);
  assert.equal(await store.has("a"), true);
  assert.deepEqual((await store.get(["a", "missing"])).get("a"), [1, 2, 3]);
  assert.equal(await store.isStale("a", "h1"), false);
  assert.equal(await store.isStale("a", "changed"), true);
  assert.equal(await store.isStale("missing", "x"), true);
  await store.delete(["a"]);
  assert.equal(await store.has("a"), false);
  assert.equal(await store.has("b"), true);
}

test("memory store and retrieve embeddings, stale hash, and delete", async () => {
  await checkStore(createMemoryVectorStore());
});

test("IndexedDB store and retrieve embeddings, stale hash, and delete", async () => {
  await checkStore(createIndexedDbVectorStore(`meethint-vectors-test-${crypto.randomUUID()}`));
});

test("embedIndexedChunks writes missing vectors and skips a matching hash", async () => {
  setEmbedderForTests(async (text) => bagEmbedding384(text));
  const store = createMemoryVectorStore();
  const chunks = [chunk("a", "Retry policy for settlement exports.")];
  const first = await embedIndexedChunks(chunks, store);
  assert.equal(first.wrote, 1);
  assert.equal(first.reused, 0);
  const second = await embedIndexedChunks(chunks, store);
  assert.equal(second.wrote, 0);
  assert.equal(second.reused, 1);
  assert.equal(await store.isStale("a", hashChunk(chunks[0])), false);
  setEmbedderForTests(null);
});

test("indexContext embeds when asked and never blocks the index", async () => {
  setEmbedderForTests(async (text) => bagEmbedding384(text));
  const store = createMemoryVectorStore();
  const repo = createMemoryRepository();
  const pack = {
    id: "emb",
    name: "emb",
    description: "",
    commits: [],
    files: [{ path: "src/a.ts", language: "ts", content: "/** Retry policy. */\nexport const n = 3\n" }],
  };
  const { context } = await persistPackAsContext(pack, repo);
  const indexed = await indexContext(repo, context.id, { embed: true, vectorStore: store });
  assert.ok(indexed.chunks.length > 0);
  assert.equal(indexed.report.embedMs >= 0, true);
  let stored = 0;
  for (const row of indexed.chunks) {
    if (await store.has(row.id)) stored += 1;
  }
  assert.ok(stored > 0, "index-time embed should write vectors");
  setEmbedderForTests(null);
});
