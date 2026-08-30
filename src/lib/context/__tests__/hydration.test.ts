import assert from "node:assert/strict";
import { test } from "node:test";

import type { RepoPack } from "../../repo/types.ts";
import { buildChunks } from "../../search/retrieve.ts";
import { persistPackAsContext } from "../service.ts";
import { createMemoryRepository } from "../memory.ts";
import { hydrateContext, packFromSources, runtimeFromPack } from "../hydrate.ts";

const PACK: RepoPack = {
  id: "folder-payments-backend",
  name: "payments-backend",
  description: "Local folder · 2 files",
  commits: [],
  files: [
    {
      path: "src/exporter/retry.ts",
      language: "ts",
      content: `/**
 * Renew the quorum lease before the exporter retries a failed settlement.
 */
export const MAX_ATTEMPTS = 3;

export function retry() {
  return MAX_ATTEMPTS;
}
`,
    },
    {
      path: "src/exporter/index.ts",
      language: "ts",
      content: `/** Settlement exporter for merchant payouts. */
export function exportSettlement() {
  return "csv";
}
`,
    },
  ],
};

test("persisted sources reconstruct a RepoPack and reuse buildChunks", async () => {
  const repo = createMemoryRepository();
  const { context } = await persistPackAsContext(PACK, repo);
  const reconstructed = await hydrateContext(repo, context.id);

  assert.equal(reconstructed.id, context.id);
  assert.notEqual(reconstructed.id, "folder-payments-backend");
  assert.equal(reconstructed.name, "payments-backend");
  assert.equal(reconstructed.commits.length, 0);
  assert.equal(reconstructed.files.length, PACK.files.length);
  assert.deepEqual(
    reconstructed.files.map((f) => f.path).sort(),
    PACK.files.map((f) => f.path).sort(),
  );

  const byId = (chunks: ReturnType<typeof buildChunks>) =>
    [...chunks]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((c) => ({ id: c.id, path: c.path, text: c.text, startOffset: c.startOffset }));
  const expected = buildChunks({ ...PACK, id: context.id, files: [...PACK.files].sort((a, b) => a.path.localeCompare(b.path)) });
  const actual = buildChunks(reconstructed);
  assert.deepEqual(byId(actual), byId(expected));
});

test("runtime hydration is still prune → chunks → vocabulary", async () => {
  const runtime = runtimeFromPack(PACK);
  assert.ok(runtime.chunks.length > 0);
  assert.ok(runtime.vocab.has("retry") || runtime.vocab.has("exporter"));
  assert.equal(runtime.pack.commits.length, 0);
});

test("chunks are never written to the repository", async () => {
  const repo = createMemoryRepository();
  const { context } = await persistPackAsContext(PACK, repo);
  const sources = await repo.listSources(context.id);
  for (const source of sources) {
    assert.equal("chunks" in source, false);
    assert.equal(source.kind, "file");
    assert.ok(source.kind === "file" && typeof source.content === "string");
  }
  const stored = await repo.getContext(context.id);
  assert.ok(stored);
  assert.equal("chunks" in stored, false);
  const pack = packFromSources(stored, sources);
  assert.ok(!("chunks" in pack));
});
