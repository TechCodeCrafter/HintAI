import assert from "node:assert/strict";
import { test } from "node:test";

import { EVIDENCE_OPEN_KEY, readEvidenceOpen, writeEvidenceOpen } from "../evidence-open.ts";

function memoryStore() {
  const held = new Map<string, string>();
  return {
    held,
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => void held.set(key, value),
    removeItem: (key: string) => void held.delete(key),
  };
}

test("the open evidence view is remembered by the answer's name and forgotten when closed", () => {
  const store = memoryStore();
  assert.equal(readEvidenceOpen(store), null);

  writeEvidenceOpen("answer-a", store);
  assert.equal(readEvidenceOpen(store), "answer-a");
  // Only the name is kept: one key, no question, no file text.
  assert.deepEqual([...store.held.entries()], [[EVIDENCE_OPEN_KEY, "answer-a"]]);

  // Opening another answer's view replaces it. One view is remembered, not a history.
  writeEvidenceOpen("answer-b", store);
  assert.equal(readEvidenceOpen(store), "answer-b");

  writeEvidenceOpen(null, store);
  assert.equal(readEvidenceOpen(store), null);
  assert.equal(store.held.size, 0);
});

test("storage that is missing or throws leaves the view working and nothing remembered", () => {
  assert.equal(readEvidenceOpen(null), null);
  assert.doesNotThrow(() => writeEvidenceOpen("answer-a", null));

  const blocked = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("quota");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
  assert.equal(readEvidenceOpen(blocked), null);
  assert.doesNotThrow(() => writeEvidenceOpen("answer-a", blocked));
  assert.doesNotThrow(() => writeEvidenceOpen(null, blocked));
});
