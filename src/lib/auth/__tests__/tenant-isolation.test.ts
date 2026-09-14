import assert from "node:assert/strict";
import { test } from "node:test";

import { bindAccountId } from "../account-boundary.ts";
import { indexContext } from "../../context/chunk-index.ts";
import { createMemoryRepository } from "../../context/memory.ts";
import { persistPackAsContext } from "../../context/service.ts";
import { localCard } from "../../search/local-card.ts";
import { retrieve, retrieveHits } from "../../search/retrieve.ts";
import { tagChunksForScope } from "../../search/retrieval-scope.ts";
import type { RepoPack } from "../../repo/types.ts";

const MARKER_A = "TENANT_A_SECRET_77102";
const MARKER_B = "TENANT_B_SECRET_88319";

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
      content: `export const token = "${MARKER_B}";\n`,
    },
  ],
};

test("retrieve rejects chunks stamped for another workspace", async () => {
  bindAccountId("user-a");
  const repo = createMemoryRepository();
  const savedA = await persistPackAsContext(PACK_A, repo);
  const runtimeA = await indexContext(repo, savedA.context.id, { embed: false });
  const scopedA = tagChunksForScope(runtimeA.chunks, {
    workspaceId: "user-a",
    contextId: savedA.context.id,
  });

  bindAccountId("user-b");
  await assert.rejects(
    async () =>
      retrieveHits("What is the token?", scopedA, {
        excludePatterns: undefined,
        scope: { workspaceId: "user-b", contextId: savedA.context.id },
      }),
    /retrieve blocked/,
  );
});

test("activating B chunks cannot answer with A-only material", async () => {
  bindAccountId("user-a");
  const repo = createMemoryRepository();
  const savedA = await persistPackAsContext(PACK_A, repo);
  const savedB = await persistPackAsContext(PACK_B, repo);
  const runtimeB = await indexContext(repo, savedB.context.id, { embed: false });
  const scopedB = tagChunksForScope(runtimeB.chunks, {
    workspaceId: "user-a",
    contextId: savedB.context.id,
  });

  assert.equal(
    scopedB.some((chunk) => chunk.text.includes(MARKER_A)),
    false,
    "B index must not contain A marker",
  );

  const hits = retrieve(MARKER_A, scopedB);
  assert.equal(hits.filter((hit) => hit.text.includes(MARKER_A)).length, 0);

  const card = localCard(`What is ${MARKER_A}?`, hits, runtimeB.pack, 0, null);
  assert.equal(card.say, null);

  const runtimeA = await indexContext(repo, savedA.context.id, { embed: false });
  assert.ok(runtimeA.chunks.some((chunk) => chunk.text.includes(MARKER_A)));
});
