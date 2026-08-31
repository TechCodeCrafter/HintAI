import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import "fake-indexeddb/auto";

import { persistPackAsContext, setContextRepository } from "../service.ts";
import { createIndexedDbRepository } from "../storage/indexeddb.ts";
import { createMemoryRepository } from "../memory.ts";
import type { ContextRepository } from "../repository.ts";
import type { RepoPack } from "../../repo/types.ts";
import { isTextSource } from "../types.ts";

const PACK_A: RepoPack = {
  id: "unused-a",
  name: "payments-backend",
  description: "Local folder · 2 files",
  commits: [],
  files: [
    {
      path: "src/index.ts",
      language: "ts",
      content: "export function settle() { return 'quorum-lease-alpha' }\n",
    },
    {
      path: "src/retry.ts",
      language: "ts",
      content: "/** Renew the quorum lease before the exporter retries. */\nexport const RETRIES = 3\n",
    },
  ],
};

const PACK_B: RepoPack = {
  id: "unused-b",
  name: "cs401-notes",
  description: "Local folder · 2 files",
  commits: [],
  files: [
    {
      path: "src/index.ts",
      language: "ts",
      content: "export const course = 'lamport-clock-beta'\n",
    },
    {
      path: "notes/lecture.md",
      language: "md",
      content: "# CS401\nLamport clocks order events without a shared timeline.\n",
    },
  ],
};

let dbSerial = 0;

function repos(): Array<{ name: string; repo: ContextRepository }> {
  dbSerial += 1;
  return [
    { name: "memory", repo: createMemoryRepository() },
    { name: "indexeddb", repo: createIndexedDbRepository(`meethint-test-${dbSerial}`) },
  ];
}

afterEach(() => {
  setContextRepository(null);
});

test("context ids are random UUIDs, not folder names", async () => {
  for (const { name, repo } of repos()) {
    const created = await repo.createContext({ name: "backend", kind: "work" });
    assert.match(created.id, /^[0-9a-f-]{36}$/, name);
    assert.notEqual(created.id, "backend");
    assert.notEqual(created.id, "folder-backend");
    assert.equal(created.sourceCount, 0);
    assert.equal(created.status, "indexing");
    assert.equal(created.kind, "work", name);
  }
});

test("sourceCount is derived from stored sources in the same write", async () => {
  for (const { name, repo } of repos()) {
    const context = await repo.createContext({ name: "backend" });
    await repo.replaceSources(context.id, [
      { path: "src/a.ts", language: "ts", content: "a" },
      { path: "src/b.ts", language: "ts", content: "b" },
    ]);
    const after = await repo.getContext(context.id);
    assert.equal(after?.sourceCount, 2, name);
    assert.equal(await repo.countSources(context.id), 2, name);
    assert.equal(after?.status, "ready", name);
  }
});

test("the same path can exist in two contexts without colliding", async () => {
  for (const { name, repo } of repos()) {
    const a = await persistPackAsContext(PACK_A, repo);
    const b = await persistPackAsContext(PACK_B, repo);
    const sourcesA = await repo.listSources(a.context.id);
    const sourcesB = await repo.listSources(b.context.id);
    assert.ok(sourcesA.some((s) => s.path === "src/index.ts"), name);
    assert.ok(sourcesB.some((s) => s.path === "src/index.ts"), name);
    const fileA = sourcesA.find((s) => s.path === "src/index.ts");
    const fileB = sourcesB.find((s) => s.path === "src/index.ts");
    assert.ok(fileA && isTextSource(fileA) && fileB && isTextSource(fileB), name);
    assert.notEqual(fileA.content, fileB.content, name);
    assert.notEqual(a.context.id, b.context.id, name);
  }
});

test("source ids are UUIDs and uniqueness is (contextId, path)", async () => {
  for (const { name, repo } of repos()) {
    const context = await repo.createContext({ name: "dupes" });
    await repo.replaceSources(context.id, [
      { path: "src/index.ts", content: "one" },
      { path: "./src/index.ts", content: "two" },
    ]);
    const sources = await repo.listSources(context.id);
    assert.equal(sources.length, 1, name);
    assert.match(sources[0].id, /^[0-9a-f-]{36}$/, name);
    assert.ok(isTextSource(sources[0]), name);
    assert.equal(sources[0].content, "one", name);
    assert.equal((await repo.getContext(context.id))?.sourceCount, 1, name);
  }
});
