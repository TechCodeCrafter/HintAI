import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";

import "fake-indexeddb/auto";

import {
  bindAccountId,
  contextDatabaseName,
  currentAccountId,
  readAccountStorage,
  wipeBrowserAccountData,
  writeAccountStorage,
} from "../account-boundary.ts";
import { persistPackAsContext, setContextRepository, listStoredContexts, loadPersistedPack } from "../../context/service.ts";
import type { RepoPack } from "../../repo/types.ts";

const MARKER = "USER_A_PRIVATE_92817";

const PACK_A: RepoPack = {
  id: "a-private",
  name: "user-a-private-92817",
  description: "A",
  commits: [],
  files: [
    {
      path: "src/secret.ts",
      language: "ts",
      content: `export const token = "${MARKER}";\n`,
    },
  ],
};

function installStorage() {
  const memory = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return memory.size;
      },
      key(index: number) {
        return [...memory.keys()][index] ?? null;
      },
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
      removeItem: (key: string) => {
        memory.delete(key);
      },
    },
  });
}

afterEach(async () => {
  setContextRepository(null);
  bindAccountId(null);
  await wipeBrowserAccountData();
});

test("a second account cannot list or read the first account's repo", async () => {
  installStorage();
  bindAccountId("user-a");
  const saved = await persistPackAsContext(PACK_A);
  assert.equal(saved.context.name, "user-a-private-92817");
  const fromA = await loadPersistedPack(saved.context.id);
  assert.ok(fromA.files.some((file) => file.content.includes(MARKER)));

  bindAccountId("user-b");
  const listedB = await listStoredContexts();
  assert.equal(listedB.length, 0);
  await assert.rejects(() => loadPersistedPack(saved.context.id));

  bindAccountId("user-a");
  const listedA = await listStoredContexts();
  assert.equal(listedA.length, 1);
  assert.equal(listedA[0]?.name, "user-a-private-92817");
  const again = await loadPersistedPack(saved.context.id);
  assert.ok(again.files.some((file) => file.content.includes(MARKER)));
});

test("API keys stay in the bound account's key slot", () => {
  installStorage();
  bindAccountId("user-a");
  writeAccountStorage("meethint.providerKeys", JSON.stringify({ openai: "sk-a" }));
  bindAccountId("user-b");
  assert.equal(readAccountStorage("meethint.providerKeys"), null);
  writeAccountStorage("meethint.providerKeys", JSON.stringify({ openai: "sk-b" }));
  bindAccountId("user-a");
  assert.equal(readAccountStorage("meethint.providerKeys"), JSON.stringify({ openai: "sk-a" }));
});

test("logout wipes the vault so the next account starts empty", async () => {
  installStorage();
  bindAccountId("user-a");
  await persistPackAsContext(PACK_A);
  writeAccountStorage("meethint.providerKeys", JSON.stringify({ openai: "sk-a" }));
  assert.equal(readAccountStorage("meethint.providerKeys"), JSON.stringify({ openai: "sk-a" }));

  await wipeBrowserAccountData();
  bindAccountId(null);
  assert.equal(currentAccountId(), null);
  assert.equal(readAccountStorage("meethint.providerKeys"), null);

  bindAccountId("user-b");
  assert.equal((await listStoredContexts()).length, 0);
  assert.equal(readAccountStorage("meethint.providerKeys"), null);
  assert.equal(contextDatabaseName("user-a"), "meethint.user-a");
  assert.equal(contextDatabaseName("dev-user"), "meethint");
});

test("account change cancels in-flight search and drops session memory", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const store = readFileSync(join(root, "store.ts"), "utf8");
  const client = readFileSync(join(root, "auth/client.ts"), "utf8");
  const body = store.slice(store.indexOf("resetForAccountChange:"));
  assert.match(body, /searchEpoch \+= 1/);
  assert.match(body, /nextHydrationEpoch/);
  assert.match(body, /contexts: \[\]/);
  assert.match(body, /answerHistory/);
  assert.match(body, /meetingHistory: \[\]/);
  assert.match(body, /card: null/);
  assert.match(client, /wipeLocal: \(\) => import\("\.\/account-session"\)/);
});
