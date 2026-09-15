import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import "fake-indexeddb/auto";

import { createMemoryRepository } from "../memory.ts";
import { createIndexedDbRepository } from "../storage/indexeddb.ts";
import { persistPackAsContext, setContextRepository } from "../service.ts";
import type { ContextRepository } from "../repository.ts";
import { isPdfSource, isTextSource } from "../types.ts";
import type { RepoPack } from "../../repo/types.ts";

let dbSerial = 0;

function repos(): Array<{ name: string; repo: ContextRepository }> {
  dbSerial += 1;
  return [
    { name: "memory", repo: createMemoryRepository() },
    { name: "indexeddb", repo: createIndexedDbRepository(`meethint-parity-${dbSerial}`) },
  ];
}

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

afterEach(() => {
  setContextRepository(null);
});

test("upsertSources preserves repo bundle text when adding a PDF", async () => {
  for (const { name, repo } of repos()) {
    const { context } = await persistPackAsContext(TEXT_PACK, repo);
    await repo.upsertSources(context.id, [
      { path: "Lecture-08.pdf", kind: "pdf", blob: new Blob(["%PDF-notes"], { type: "application/pdf" }) },
    ]);
    const sources = await repo.listSources(context.id);
    assert.equal(sources.length, 2, name);
    const text = sources.find(isTextSource);
    const pdf = sources.find(isPdfSource);
    assert.ok(text, name);
    assert.ok(pdf, name);
    assert.equal(text.path, "payments-backend/src/retry.ts", name);
    assert.equal(pdf.path, "Lecture-08.pdf", name);
    assert.notEqual(text.sourceId, pdf.sourceId, name);
  }
});

test("upsertRepoBundle updates one file without removing sibling files or PDFs", async () => {
  for (const { name, repo } of repos()) {
    const { context } = await persistPackAsContext(TEXT_PACK, repo);
    await repo.upsertSources(context.id, [
      { path: "Lecture-08.pdf", kind: "pdf", blob: new Blob(["%PDF-notes"], { type: "application/pdf" }) },
    ]);
    const bundleSourceId = (await repo.listSources(context.id)).find(isTextSource)!.sourceId;
    await repo.upsertRepoBundle(context.id, {
      displayName: TEXT_PACK.name,
      bundleSourceId,
      files: [
        {
          path: "src/retry.ts",
          language: "ts",
          content: "/** Updated lease. */\nexport const RETRIES = 4\n",
        },
      ],
    });
    const sources = await repo.listSources(context.id);
    assert.equal(sources.length, 2, name);
    const text = sources.find(isTextSource);
    assert.ok(text?.content.includes("RETRIES = 4"), name);
    assert.equal(sources.filter(isPdfSource).length, 1, name);
  }
});
