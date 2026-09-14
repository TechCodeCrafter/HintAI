import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import "fake-indexeddb/auto";

import { bindAccountId, contextDatabaseName, currentAccountId } from "../account-boundary.ts";
import {
  ANONYMOUS_WORKSPACE_PREFIX,
  bindAnonymousWorkspace,
  getOrCreateAnonymousWorkspaceId,
  isAnonymousWorkspaceId,
  isAuthenticatedWorkspaceId,
  probeAnonymousTier,
} from "../anonymous-tier.ts";

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
      clear: () => memory.clear(),
    },
  });
}

afterEach(() => {
  bindAccountId(null);
});

test("anonymous workspace id is stable per profile and uses ws_anon prefix", () => {
  installStorage();
  const first = getOrCreateAnonymousWorkspaceId();
  const second = getOrCreateAnonymousWorkspaceId();
  assert.match(first, new RegExp(`^${ANONYMOUS_WORKSPACE_PREFIX}`));
  assert.equal(first, second);
  assert.ok(isAnonymousWorkspaceId(first));
  assert.equal(isAuthenticatedWorkspaceId(first), false);
});

test("bindAnonymousWorkspace uses IndexedDB-backed vault name", async () => {
  installStorage();
  const id = await bindAnonymousWorkspace();
  assert.equal(currentAccountId(), id);
  assert.equal(contextDatabaseName(id), `meethint.${id}`);
});

test("probeAnonymousTier verifies persistence without leaving a bound account", async () => {
  installStorage();
  bindAccountId(null);
  await probeAnonymousTier();
  assert.equal(currentAccountId(), null);
});
