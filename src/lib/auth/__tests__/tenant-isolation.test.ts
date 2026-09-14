import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import "fake-indexeddb/auto";

import { bindAccountId, wipeBrowserAccountData } from "../account-boundary.ts";
import { indexContext } from "../../context/chunk-index.ts";
import { createMemoryRepository } from "../../context/memory.ts";
import { getContextRepository, persistPackAsContext, setContextRepository } from "../../context/service.ts";
import { routeSearchAnswer } from "../../search/answer-route.ts";
import { localCard } from "../../search/local-card.ts";
import { embedIndexedChunks } from "../../search/embed-chunks.ts";
import { retrieve, retrieveHits } from "../../search/retrieve.ts";
import {
  filterChunksForScope,
  tagChunksForScope,
  testRetrievalScope,
  vectorCacheKey,
} from "../../search/retrieval-scope.ts";
import { createMemoryVectorStore } from "../../search/vector-store.ts";
import type { RepoPack } from "../../repo/types.ts";

const MARKER_A = "TENANT_A_SECRET_77102";
const QUESTION = `What is ${MARKER_A}?`;

const PACK_A: RepoPack = {
  id: "tenant-a",
  name: "tenant-a-repo",
  description: "A",
  commits: [],
  files: [
    {
      path: "src/secret.ts",
      language: "ts",
      content: `export const token = "${MARKER_A}";\n`,
    },
  ],
};

const PACK_B: RepoPack = {
  id: "tenant-b",
  name: "tenant-b-repo",
  description: "B",
  commits: [],
  files: [
    {
      path: "src/other.ts",
      language: "ts",
      content: `export const note = "nothing here";\n`,
    },
  ],
};

afterEach(async () => {
  setContextRepository(null);
  bindAccountId(null);
  await wipeBrowserAccountData();
});

test("acceptance: User B cannot search User A secret or get a sourced answer", async () => {
  bindAccountId("user-a");
  const repo = createMemoryRepository();
  const savedA = await persistPackAsContext(PACK_A, repo);
  const runtimeA = await indexContext(repo, savedA.context.id, { embed: false });
  const scopeA = { workspaceId: "user-a", contextId: savedA.context.id };
  const scopedA = tagChunksForScope(runtimeA.chunks, scopeA);

  bindAccountId("user-b");
  setContextRepository(null);
  const repoB = createMemoryRepository();
  setContextRepository(repoB);
  const savedB = await persistPackAsContext(PACK_B, repoB);
  const runtimeB = await indexContext(repoB, savedB.context.id, { embed: false });
  const scopeB = { workspaceId: "user-b", contextId: savedB.context.id };
  const scopedB = tagChunksForScope(runtimeB.chunks, scopeB);

  const crossSearch = await retrieveHits(MARKER_A, scopedB, {
    excludePatterns: undefined,
    scope: scopeB,
  });
  assert.equal(crossSearch.filter((hit) => hit.text.includes(MARKER_A)).length, 0);

  const leakedHits = filterChunksForScope(scopedA, scopeB);
  assert.equal(leakedHits.length, 0);

  const card = localCard(QUESTION, crossSearch, runtimeB.pack, 0, null);
  assert.equal(card.say, null, "Hint must stay silent when only A holds the answer");

  const routed = await routeSearchAnswer(QUESTION, crossSearch, performance.now(), {
    pack: runtimeB.pack,
    retrieveMs: 1,
  });
  assert.equal(routed.card.say, null);
});

test("acceptance: direct context id guess returns null for foreign workspace", async () => {
  bindAccountId("user-a");
  const savedA = await persistPackAsContext(PACK_A);

  bindAccountId("user-b");
  setContextRepository(null);
  const ctx = await getContextRepository().getContext(savedA.context.id);
  assert.equal(ctx, null);
});

test("acceptance: retrieve drops foreign stamped chunks before ranking", async () => {
  bindAccountId("user-a");
  const repo = createMemoryRepository();
  const savedA = await persistPackAsContext(PACK_A, repo);
  const runtimeA = await indexContext(repo, savedA.context.id, { embed: false });
  const scopedA = tagChunksForScope(runtimeA.chunks, {
    workspaceId: "user-a",
    contextId: savedA.context.id,
  });

  bindAccountId("user-b");
  const hits = await retrieveHits("secret", scopedA, {
    excludePatterns: undefined,
    scope: { workspaceId: "user-b", contextId: savedA.context.id },
    hybrid: false,
  });
  assert.equal(hits.length, 0, "foreign-stamped chunks must not rank under another workspace");
});

test("acceptance: embedding cache keys never cross workspaces", async () => {
  bindAccountId("user-a");
  const repo = createMemoryRepository();
  const savedA = await persistPackAsContext(PACK_A, repo);
  const runtimeA = await indexContext(repo, savedA.context.id, { embed: false });
  const scopedA = tagChunksForScope(runtimeA.chunks, {
    workspaceId: "user-a",
    contextId: savedA.context.id,
  });
  const store = createMemoryVectorStore();
  await embedIndexedChunks(scopedA, store);
  const keyA = vectorCacheKey(scopedA[0]!);
  assert.match(keyA, /^user-a:/);

  bindAccountId("user-b");
  const chunkB = tagChunksForScope(runtimeA.chunks, {
    workspaceId: "user-b",
    contextId: "other-context",
  });
  const keyB = vectorCacheKey(chunkB[0]!);
  assert.notEqual(keyA, keyB);
  const hit = await store.get([keyB]);
  assert.equal(hit.size, 0, "B must not read A embedding cache entry");
});

test("retrieveHits filters stamped foreign chunks silently when scopes align on untagged mix", async () => {
  bindAccountId("user-a");
  const repo = createMemoryRepository();
  const savedA = await persistPackAsContext(PACK_A, repo);
  const runtimeA = await indexContext(repo, savedA.context.id, { embed: false });
  const scope = testRetrievalScope(savedA.context.id);
  const mixed = [
    ...tagChunksForScope(runtimeA.chunks, scope),
    ...tagChunksForScope(runtimeA.chunks, { workspaceId: "user-b", contextId: savedA.context.id }),
  ];
  const hits = await retrieveHits("secret", mixed, {
    excludePatterns: undefined,
    scope,
    hybrid: false,
  });
  assert.ok(hits.some((hit) => hit.text.includes(MARKER_A)), "in-scope chunks still rank after foreign drop");
  assert.equal(
    filterChunksForScope(mixed, { workspaceId: "user-b", contextId: savedA.context.id }).length,
    runtimeA.chunks.length,
    "foreign workspace half is droppable without touching in-scope rows",
  );
});

test("activating B chunks cannot answer with A-only material", async () => {
  bindAccountId("user-a");
  const repo = createMemoryRepository();
  await persistPackAsContext(PACK_A, repo);
  const savedB = await persistPackAsContext(PACK_B, repo);
  const runtimeB = await indexContext(repo, savedB.context.id, { embed: false });
  const scopedB = tagChunksForScope(runtimeB.chunks, testRetrievalScope(savedB.context.id));

  assert.equal(scopedB.some((chunk) => chunk.text.includes(MARKER_A)), false);
  const hits = retrieve(MARKER_A, scopedB);
  assert.equal(hits.filter((hit) => hit.text.includes(MARKER_A)).length, 0);
});
