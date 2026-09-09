import assert from "node:assert/strict";
import { test } from "node:test";

import { bindAccountId, LOCAL_DEV_ACCOUNT_ID } from "../../auth/account-boundary.ts";
import {
  EXTRACT_DAILY_LIMIT,
  EXTRACT_QUOTA_KEY,
  consumeExtractQuestion,
  extractExhausted,
  extractRemaining,
  localDayKey,
  readExtractQuota,
} from "../extract-quota.ts";

const memory = new Map<string, string>();

function installStorage() {
  memory.clear();
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
  bindAccountId(LOCAL_DEV_ACCOUNT_ID);
}

test("a fresh day has the full Extract allowance", () => {
  installStorage();
  assert.equal(extractRemaining(), EXTRACT_DAILY_LIMIT);
  assert.equal(extractExhausted(), false);
});

test("each Extract question decrements the remaining count", () => {
  installStorage();
  consumeExtractQuestion();
  consumeExtractQuestion();
  assert.equal(readExtractQuota().used, 2);
  assert.equal(extractRemaining(), EXTRACT_DAILY_LIMIT - 2);
});

test("the twentieth question exhausts the free day", () => {
  installStorage();
  for (let i = 0; i < EXTRACT_DAILY_LIMIT; i += 1) consumeExtractQuestion();
  assert.equal(extractRemaining(), 0);
  assert.equal(extractExhausted(), true);
});

test("missing localStorage is a full unused day", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: undefined });
  try {
    assert.equal(extractRemaining(), EXTRACT_DAILY_LIMIT);
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else delete (globalThis as { localStorage?: Storage }).localStorage;
  }
});

test("a new local day resets the counter", () => {
  installStorage();
  memory.set(EXTRACT_QUOTA_KEY, JSON.stringify({ day: "1999-01-01", used: 20 }));
  const now = new Date("2026-09-05T12:00:00");
  assert.equal(localDayKey(now), "2026-09-05");
  assert.equal(extractRemaining(now), EXTRACT_DAILY_LIMIT);
  assert.equal(extractExhausted(now), false);
});
