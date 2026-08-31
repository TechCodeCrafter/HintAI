import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { indexContext } from "../chunk-index.ts";
import { createMemoryRepository } from "../memory.ts";
import { listContextSummaries, persistPackAsContext, setContextRepository } from "../service.ts";
import type { RepoPack } from "../../repo/types.ts";

const PACK: RepoPack = {
  id: "unused",
  name: "northstar-payments",
  description: "Local folder · 2 files",
  commits: [],
  files: [
    {
      path: "src/exporter/retry.ts",
      language: "ts",
      content: "export const RETRIES = 3\n",
    },
    {
      path: "docs/adr/0007.md",
      language: "md",
      content: "# Exporter retries\nRenew the lease.\n",
    },
  ],
};

afterEach(() => {
  setContextRepository(null);
});

test("createContext stores kind and summaries count files and chunks", async () => {
  const repo = createMemoryRepository();
  setContextRepository(repo);
  const named = await repo.createContext({ name: "bert-glue", kind: "research", description: "PDF notes" });
  assert.equal(named.kind, "research");

  const persisted = await persistPackAsContext(PACK, repo, { kind: "work" });
  assert.equal(persisted.context.kind, "work");
  await indexContext(repo, persisted.context.id);

  const attached = await persistPackAsContext(
    {
      ...PACK,
      name: "should-not-rename",
      files: [{ path: "src/only.ts", language: "ts", content: "export const n = 1\n" }],
    },
    repo,
    { contextId: named.id },
  );
  assert.equal(attached.context.id, named.id);
  assert.equal(attached.context.name, "bert-glue");
  await indexContext(repo, named.id);

  const summaries = await listContextSummaries(repo);
  assert.equal(summaries.length, 2);
  const work = summaries.find((item) => item.context.kind === "work");
  const research = summaries.find((item) => item.context.id === named.id);
  assert.ok(work);
  assert.equal(work.fileCount, 2);
  assert.ok(work.chunkCount > 0);
  assert.ok(research);
  assert.equal(research.fileCount, 1);
  assert.equal(research.context.name, "bert-glue");
});
