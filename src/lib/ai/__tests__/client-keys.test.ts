import assert from "node:assert/strict";
import { test } from "node:test";

import { clientHasKey, readClientKeys, writeClientKeys } from "../client-keys.ts";

const memory = new Map<string, string>();

function installStorage() {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
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

test("client keys persist only the providers that have a value", () => {
  memory.clear();
  installStorage();
  writeClientKeys({ openai: " sk-test ", anthropic: "  ", xai: undefined });
  const keys = readClientKeys();
  assert.equal(keys.openai, "sk-test");
  assert.equal(keys.anthropic, undefined);
  assert.equal(clientHasKey("openai"), true);
  assert.equal(clientHasKey("anthropic"), false);
});
