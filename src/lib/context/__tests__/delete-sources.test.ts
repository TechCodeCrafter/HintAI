import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import "fake-indexeddb/auto";

import { bindAccountId, wipeBrowserAccountData } from "../../auth/account-boundary.ts";
import type { RepoPack } from "../../repo/types.ts";
import { indexContext } from "../chunk-index.ts";
import { createMemoryRepository } from "../memory.ts";
import type { ContextRepository } from "../repository.ts";
import { persistPackAsContext, setContextRepository } from "../service.ts";
import { createIndexedDbRepository } from "../storage/indexeddb.ts";
import { isPdfSource, isTextSource } from "../types.ts";

let dbSerial = 0;

function repos(): Array<{ name: string; repo: ContextRepository }> {
  dbSerial += 1;
  return [
    { name: "memory", repo: createMemoryRepository() },
    { name: "indexeddb", repo: createIndexedDbRepository(`meethint-delete-sources-${dbSerial}`) },
  ];
}

const PACK: RepoPack = {
  id: "unused",
  name: "local-repo",
  description: "",
  commits: [],
  files: [
    { path: "auth.ts", language: "ts", content: "export const token = 'DELETE_TOKEN_A';\n" },
    { path: "billing.ts", language: "ts", content: "export const timeout = 'DELETE_TIMEOUT_B';\n" },
  ],
};

afterEach(async () => {
  setContextRepository(null);
  await wipeBrowserAccountData().catch(() => undefined);
});

test("deleteSources removes one PDF row, its blob and its ledger, and recounts rows", async () => {
  bindAccountId("user-a");
  for (const { name, repo } of repos()) {
    const { context } = await persistPackAsContext(PACK, repo);
    await repo.upsertSources(context.id, [
      { path: "broken.pdf", kind: "pdf", blob: new Blob(["%PDF-1.4\nnot a pdf"], { type: "application/pdf" }) },
    ]);
    await indexContext(repo, context.id, { embed: false });
    const before = await repo.listSources(context.id);
    const pdf = before.find(isPdfSource);
    assert.ok(pdf, name);
    assert.equal(before.length, 3, name);
    assert.ok(await repo.getSourceBlob(pdf.id, pdf.contentHash), `${name}: blob stored`);
    const textLedgers = (await repo.listIndexed(context.id)).filter((row) => row.sourceId !== pdf.id).length;
    assert.ok(textLedgers >= 2, `${name}: text indexed`);

    const after = await repo.deleteSources(context.id, [pdf.id, "not-a-source"]);
    assert.equal(after.length, 2, name);
    assert.ok(after.every(isTextSource), name);
    assert.deepEqual(await repo.listSources(context.id), after, name);
    // Counted per stored row, like every other write.
    assert.equal((await repo.getContext(context.id))?.sourceCount, 2, name);
    assert.equal(await repo.countSources(context.id), 2, name);
    assert.equal(await repo.getSourceBlob(pdf.id, pdf.contentHash), null, `${name}: blob gone`);
    const ledgers = await repo.listIndexed(context.id);
    assert.ok(ledgers.every((row) => row.sourceId !== pdf.id), `${name}: pdf ledger gone`);
    assert.equal(ledgers.length, textLedgers, `${name}: text ledgers kept`);
  }
});

test("deleteSources ignores rows from another context and leaves a context empty but present", async () => {
  bindAccountId("user-a");
  for (const { name, repo } of repos()) {
    const { context: a } = await persistPackAsContext(PACK, repo);
    const { context: b } = await persistPackAsContext({ ...PACK, name: "other" }, repo);
    const fromB = (await repo.listSources(b.id)).map((row) => row.id);
    assert.equal((await repo.deleteSources(a.id, fromB)).length, 2, name);
    assert.equal((await repo.listSources(b.id)).length, 2, `${name}: other context untouched`);

    const all = (await repo.listSources(a.id)).map((row) => row.id);
    assert.deepEqual(await repo.deleteSources(a.id, all), [], name);
    const record = await repo.getContext(a.id);
    assert.ok(record, name);
    assert.equal(record.sourceCount, 0, name);
    await assert.rejects(repo.deleteSources("missing-context", []), name);
  }
});
