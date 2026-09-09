import assert from "node:assert/strict";
import { test } from "node:test";

import { isLlmDebug, llmDebug } from "../debug.ts";

test("LLM debug is off unless an explicit flag is set", () => {
  assert.equal(isLlmDebug(), false);
  const logs: unknown[][] = [];
  const original = console.info;
  console.info = (...args: unknown[]) => {
    logs.push(args);
  };
  try {
    llmDebug("[ask] prompt length:", 12);
  } finally {
    console.info = original;
  }
  assert.deepEqual(logs, []);
});
