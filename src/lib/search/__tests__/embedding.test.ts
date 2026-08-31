import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  EMBEDDING_DIM,
  bagEmbedding384,
  cosineSimilarity,
  embedBatch,
  embedText,
  setEmbedderForTests,
} from "../embedding.ts";

afterEach(() => {
  setEmbedderForTests(null);
});

test("embedText returns a 384-dim vector", async () => {
  setEmbedderForTests(async (text) => bagEmbedding384(text));
  const vec = await embedText("Retry policy for settlement exports.");
  assert.equal(vec.length, EMBEDDING_DIM);
  assert.equal(vec.length, 384);
});

test("cosineSimilarity of identical texts is 1", async () => {
  setEmbedderForTests(async (text) => bagEmbedding384(text));
  const text = "Attempts are capped at three because the payment gateway stalls.";
  const a = await embedText(text);
  const b = await embedText(text);
  assert.ok(Math.abs(cosineSimilarity(a, b) - 1) < 1e-9);
});

test("cosineSimilarity of unrelated texts is below 0.5", async () => {
  setEmbedderForTests(async (text) => bagEmbedding384(text));
  const a = await embedText("settlement export retry backoff payment gateway");
  const b = await embedText("weather forecast tokyo rainfall humidity");
  assert.ok(cosineSimilarity(a, b) < 0.5, `got ${cosineSimilarity(a, b)}`);
});

test("embedBatch preserves order and width", async () => {
  setEmbedderForTests(async (text) => bagEmbedding384(text));
  const batch = await embedBatch(["one", "two"]);
  assert.equal(batch.length, 2);
  assert.equal(batch[0].length, 384);
  assert.deepEqual(batch[0], await embedText("one"));
});
