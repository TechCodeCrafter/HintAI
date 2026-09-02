import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { NORTHSTAR } from "../../repo/northstar.ts";
import type { RepoPack } from "../../repo/types.ts";
import { createMemoryRepository } from "../memory.ts";
import {
  ACTIVE_CONTEXT_KEY,
  MIGRATION_MARKER_KEY,
  PACK_KEY,
  migrateLegacyPack,
  readActiveContextId,
} from "../migration.ts";
import { hydrateContext } from "../hydrate.ts";
import { hashContent } from "../hash.ts";

const USER_PACK: RepoPack = {
  id: "folder-payments-backend",
  name: "payments-backend",
  description: "Local folder · 1 files",
  commits: [],
  files: [
    {
      path: "src/retry.ts",
      language: "ts",
      content: "/** quorum-lease-alpha lives here */\nexport const n = 3\n",
    },
  ],
};

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  } satisfies Storage;
}

const original = globalThis.localStorage;

afterEach(() => {
  Object.defineProperty(globalThis, "localStorage", { value: original, configurable: true });
});

function installStorage(initial: Record<string, string> = {}) {
  const storage = memoryStorage();
  for (const [key, value] of Object.entries(initial)) storage.setItem(key, value);
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  return storage;
}

test("a Northstar demo save is ignored and deleted", async () => {
  const storage = installStorage({ [PACK_KEY]: JSON.stringify(NORTHSTAR) });
  const repo = createMemoryRepository();
  const result = await migrateLegacyPack(repo);
  assert.equal(result.kind, "ignored-demo");
  assert.equal(storage.getItem(PACK_KEY), null);
  assert.equal((await repo.listContexts()).length, 0);
});

test("a user pack is migrated only after a read-back fingerprint matches", async () => {
  const storage = installStorage({ [PACK_KEY]: JSON.stringify(USER_PACK) });
  const repo = createMemoryRepository();
  const result = await migrateLegacyPack(repo);
  assert.equal(result.kind, "migrated");
  if (result.kind !== "migrated") return;

  assert.equal(storage.getItem(PACK_KEY), null);
  assert.equal(storage.getItem(MIGRATION_MARKER_KEY), null);
  assert.equal(storage.getItem(ACTIVE_CONTEXT_KEY), result.context.id);
  assert.notEqual(result.context.id, "folder-payments-backend");

  const reconstructed = await hydrateContext(repo, result.context.id);
  assert.equal(reconstructed.files.length, USER_PACK.files.length);
  assert.deepEqual(
    reconstructed.files.map((f) => f.path),
    USER_PACK.files.map((f) => f.path),
  );
  assert.equal(
    await hashContent(reconstructed.files[0].content),
    await hashContent(USER_PACK.files[0].content),
  );
});

test("a failed write leaves the legacy pack in place", async () => {
  const storage = installStorage({ [PACK_KEY]: JSON.stringify(USER_PACK) });
  const repo = createMemoryRepository();
  const broken = {
    ...repo,
    async replaceSources() {
      throw new Error("disk full");
    },
  };
  const result = await migrateLegacyPack(broken);
  assert.equal(result.kind, "failed");
  assert.ok(storage.getItem(PACK_KEY));
  assert.equal((await repo.listContexts()).length, 0);
});

test("an old ground.activeContextId is rewritten to meethint.activeContextId", () => {
  const storage = installStorage({ "ground.activeContextId": "ctx-legacy" });
  assert.equal(readActiveContextId(), "ctx-legacy");
  assert.equal(storage.getItem(ACTIVE_CONTEXT_KEY), "ctx-legacy");
  assert.equal(storage.getItem("ground.activeContextId"), null);
});

test("no legacy pack is a no-op", async () => {
  installStorage();
  const repo = createMemoryRepository();
  const result = await migrateLegacyPack(repo);
  assert.equal(result.kind, "none");
  assert.equal((await repo.listContexts()).length, 0);
});
