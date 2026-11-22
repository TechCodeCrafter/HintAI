import assert from "node:assert/strict";
import { test } from "node:test";

import { NORTHSTAR } from "../../repo/northstar.ts";
import type { RepoPack } from "../../repo/types.ts";
import { buildChunks, retrieve } from "../retrieve.ts";

const TEST_FILE = {
  path: "tests/test_holds.py",
  language: "py",
  content: "def test_hold_release():\n    marker = 'quokkaledger'\n    assert withRetry(marker)\n",
};

const PACK: RepoPack = { ...NORTHSTAR, files: [...NORTHSTAR.files, TEST_FILE] };
const chunks = buildChunks(PACK);

function topPath(query: string): string | undefined {
  return retrieve(query, chunks, 6)[0]?.path;
}

test("a hyphenated word typed as written finds the text that holds it", () => {
  // `tokenize` keeps "dead-letter" as one term. The text used to hold only
  // "dead" and "letter", so the term matched nothing.
  assert.equal(topPath("dead-letter"), "docs/adr/0007-exporter-retries.md");
  assert.equal(topPath("What is the same-site setting?"), "src/auth/session.ts");
  assert.equal(topPath("Tell me about payment-timeout handling"), "src/exporter/retry.ts");
});

test("a camelCase name inside a question finds its file", () => {
  // Alone, "runExporter" matched through the exact-phrase bonus. Inside a
  // question the phrase no longer matched and the term "runexporter" had
  // nothing to match either.
  assert.equal(topPath("Where is runExporter defined?"), "src/exporter/index.ts");
  assert.ok(retrieve("What does mapSettlementRow return?", chunks, 6).some((hit) => hit.path === "src/exporter/format.ts"));
});

test("a string that exists only in a test file is found", () => {
  assert.equal(topPath("quokkaledger"), TEST_FILE.path);
});

test("a test file still does not surface when real source matches", () => {
  const hits = retrieve("what is withRetry", chunks, 6);
  assert.equal(hits[0]?.path.startsWith("src/exporter/"), true);
  assert.equal(hits.some((hit) => hit.path === TEST_FILE.path), false);
});
