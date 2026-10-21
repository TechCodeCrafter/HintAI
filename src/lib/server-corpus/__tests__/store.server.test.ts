import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { PGlite } from "@electric-sql/pglite";

import type { Sql } from "../../db.ts";
import type { DocumentChunk, NormalizedPage } from "../../document/types.ts";
import { SERVER_CORPUS_LIMITS, type ServerDocMeta, type ServerUploadBatch } from "../contract.ts";
import { UPLOAD_TIMED_OUT, corpusStatus, storeUploadBatch } from "../store.server.ts";

const migration = readFileSync(
  join(import.meta.dirname, "../../../../migrations/0003_server_corpus.sql"),
  "utf8",
);

type Runner = { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }> };

/** Same shape as `db.ts`; `delayMs` slows every statement to let a deadline expire mid-batch. */
function sqlOver(runner: Runner, begin?: Sql["transaction"], delayMs = 0): Sql {
  const run = async (text: string, params: unknown[]) => {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    return (await runner.query(text, params)).rows as never;
  };
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = strings[0];
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`;
    return run(text, values);
  }) as unknown as Sql;
  sql.query = async (text: string, params: unknown[] = []) => run(text, params);
  sql.transaction = begin ?? ((fn) => fn(sql));
  return sql;
}

async function freshSql(delayMs = 0): Promise<Sql> {
  const pg = new PGlite({ parsers: { 20: Number } });
  await pg.exec(migration);
  return sqlOver(pg, (fn) => pg.transaction((tx) => fn(sqlOver(tx, undefined, delayMs))));
}

async function rowCounts(sql: Sql) {
  const [pages] = await sql<{ n: number }>`select count(*)::int as n from server_pages`;
  const [chunks] = await sql<{ n: number }>`select count(*)::int as n from server_chunks`;
  return { pages: pages?.n, chunks: chunks?.n };
}

function metaFor(sourceId: string): ServerDocMeta {
  return {
    spaceId: "space-1",
    sourceId,
    path: `${sourceId}.pdf`,
    kind: "pdf",
    contentHash: `hash-${sourceId}`,
    parserVersion: 1,
    normalizerVersion: 1,
  };
}

function page(n: number): NormalizedPage {
  return {
    pageNumber: n,
    text: `Page ${n}`,
    items: [],
    segments: [],
    readingOrder: "single-column",
    usefulItemCount: 1,
    index: "full",
  };
}

function chunk(meta: ServerDocMeta, n: number): DocumentChunk {
  return {
    kind: "document",
    id: `${meta.sourceId}-c${n}`,
    path: meta.path,
    sourceId: meta.sourceId,
    page: n,
    startOffset: 0,
    endOffset: 6,
    text: `Chunk ${n}`,
    contentHash: meta.contentHash,
    readingOrder: "single-column",
  };
}

function batch(meta: ServerDocMeta, batchIndex: number, pages: number[], isLast: boolean): ServerUploadBatch {
  return {
    meta,
    batchIndex,
    isLast,
    pages: pages.map(page),
    chunks: pages.map((n) => chunk(meta, n)),
  };
}

test("a retried batch replaces its rows instead of duplicating them", async () => {
  const sql = await freshSql();
  const meta = metaFor("doc");
  assert.deepEqual(await storeUploadBatch(sql, "user-a", batch(meta, 0, [1, 2], false)), { ok: true });
  assert.deepEqual(await storeUploadBatch(sql, "user-a", batch(meta, 1, [3, 4], false)), { ok: true });
  // Same batch again, as after a client-side timeout.
  assert.deepEqual(await storeUploadBatch(sql, "user-a", batch(meta, 1, [3, 4], false)), { ok: true });
  assert.deepEqual(await storeUploadBatch(sql, "user-a", batch(meta, 2, [5], true)), { ok: true });

  const [chunks] = await sql<{ n: number }>`select count(*)::int as n from server_chunks`;
  assert.equal(chunks?.n, 5);
  const status = await corpusStatus(sql, "user-a", "space-1");
  assert.equal(status.sources[0]?.pageCount, 5);
  assert.equal(status.sources[0]?.chunkCount, 5);
  assert.equal(status.sources[0]?.status, "ready");
  assert.equal(status.totalPages, 5);
});

test("the page budget applies to every batch, including uploads never finished", async () => {
  const sql = await freshSql();
  const per = SERVER_CORPUS_LIMITS.maxPagesPerBatch;
  const budget = SERVER_CORPUS_LIMITS.maxPagesPerUser;
  // Fill the budget with sources that never send `isLast`.
  let stored = 0;
  for (let s = 0; stored < budget; s += 1) {
    const meta = metaFor(`filler-${s}`);
    const numbers = Array.from({ length: Math.min(per, budget - stored) }, (_, i) => i + 1);
    assert.deepEqual(await storeUploadBatch(sql, "user-a", batch(meta, 0, numbers, false)), { ok: true });
    stored += numbers.length;
  }
  const over = await storeUploadBatch(sql, "user-a", batch(metaFor("one-more"), 0, [1], false));
  assert.equal(over.ok, false);
  // Another user's budget is untouched.
  assert.deepEqual(await storeUploadBatch(sql, "user-b", batch(metaFor("theirs"), 0, [1], true)), { ok: true });
});

test("a batch that fails partway leaves the source exactly as it was", async () => {
  const sql = await freshSql();
  const meta = metaFor("doc");
  assert.deepEqual(await storeUploadBatch(sql, "user-a", batch(meta, 0, [1, 2], false)), { ok: true });
  // A restart (batch 0) clears the old attempt first; its third page breaks the
  // insert after that delete and the first two pages have already run.
  const broken = batch(meta, 0, [3, 4, 5], false);
  (broken.pages[2] as { pageNumber: number | null }).pageNumber = null;
  await assert.rejects(storeUploadBatch(sql, "user-a", broken));

  assert.deepEqual(await rowCounts(sql), { pages: 2, chunks: 2 });
  const status = await corpusStatus(sql, "user-a", "space-1");
  assert.equal(status.sources[0]?.pageCount, 2);
  assert.equal(status.sources[0]?.chunkCount, 2);
});

test("a rejected batch writes nothing, not even its restart", async () => {
  const sql = await freshSql();
  const meta = metaFor("doc");
  assert.deepEqual(await storeUploadBatch(sql, "user-a", batch(meta, 0, [1, 2], true)), { ok: true });
  const tooMany = Array.from({ length: SERVER_CORPUS_LIMITS.maxPagesPerSource + 1 }, (_, i) => i + 1);
  const over = await storeUploadBatch(sql, "user-a", batch(meta, 0, tooMany, false));
  assert.equal(over.ok, false);

  assert.deepEqual(await rowCounts(sql), { pages: 2, chunks: 2 });
  assert.equal((await corpusStatus(sql, "user-a", "space-1")).sources[0]?.status, "ready");
});

test("a batch past its deadline does not start writing", async () => {
  const sql = await freshSql();
  const result = await storeUploadBatch(sql, "user-a", batch(metaFor("doc"), 0, [1, 2], true), {
    deadline: Date.now() - 1,
  });
  assert.deepEqual(result, { ok: false, reason: UPLOAD_TIMED_OUT });
  assert.deepEqual(await rowCounts(sql), { pages: 0, chunks: 0 });
  assert.equal((await corpusStatus(sql, "user-a", "space-1")).sources.length, 0);
});

test("a deadline that runs out mid-batch rolls the whole batch back", async () => {
  const sql = await freshSql(10);
  const meta = metaFor("doc");
  assert.deepEqual(await storeUploadBatch(sql, "user-a", batch(meta, 0, [1, 2], false)), { ok: true });
  // 20 pages + 20 chunks at 10ms a statement cannot finish in 100ms.
  const numbers = Array.from({ length: 20 }, (_, i) => i + 3);
  const result = await storeUploadBatch(sql, "user-a", batch(meta, 1, numbers, true), {
    deadline: Date.now() + 100,
  });
  assert.deepEqual(result, { ok: false, reason: UPLOAD_TIMED_OUT });

  assert.deepEqual(await rowCounts(sql), { pages: 2, chunks: 2 });
  const source = (await corpusStatus(sql, "user-a", "space-1")).sources[0];
  assert.equal(source?.pageCount, 2);
  assert.equal(source?.status, "uploading");
  // Nothing was left running: a retry with time to spare completes normally.
  assert.deepEqual(await storeUploadBatch(sql, "user-a", batch(meta, 1, numbers, true)), { ok: true });
  assert.deepEqual(await rowCounts(sql), { pages: 22, chunks: 22 });
});
