import assert from "node:assert/strict";
import { test } from "node:test";

import { canDetectContradictions, readSubscription, SUBSCRIPTION_KEY, writeSubscription } from "../subscription.ts";

const memory = new Map<string, string>();

test("subscription defaults to free and persists under meethint.subscription", () => {
  const store = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: store });

  assert.equal(readSubscription(), "free");
  writeSubscription("pro");
  assert.equal(memory.get(SUBSCRIPTION_KEY), "pro");
  assert.equal(readSubscription(), "pro");
  writeSubscription("free");
  assert.equal(readSubscription(), "free");
  assert.equal(canDetectContradictions("free"), false);
  assert.equal(canDetectContradictions("pro"), false);
  assert.equal(canDetectContradictions("team"), true);
  assert.equal(canDetectContradictions("enterprise"), true);
});
