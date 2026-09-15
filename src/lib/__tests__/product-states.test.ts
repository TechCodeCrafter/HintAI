import assert from "node:assert/strict";
import { test } from "node:test";

import { inferProductStateFromReason, productState } from "../product-states.ts";

test("product states use plain language without stack traces", () => {
  const state = productState("indexing");
  assert.match(state.message, /Indexing/i);
  assert.doesNotMatch(state.message, /Error:|stack/i);
});

test("inferProductStateFromReason maps api key and coverage messages", () => {
  assert.equal(inferProductStateFromReason("Add an OpenAI API key to continue")?.code, "missing-api-key");
  assert.equal(inferProductStateFromReason("No matching material in this pack")?.code, "unsupported-answer");
});
