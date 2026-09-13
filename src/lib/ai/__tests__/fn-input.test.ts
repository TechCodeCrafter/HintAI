import assert from "node:assert/strict";
import { test } from "node:test";

import { unwrapFnInput } from "../fn-input.ts";

test("unwrapFnInput keeps an already-unwrapped prompt payload", () => {
  const inner = unwrapFnInput({ prompt: "QUESTION: hello", modelId: "gpt-4o-mini" });
  assert.equal(inner.prompt, "QUESTION: hello");
});

test("unwrapFnInput reads prompt from data when query is missing", () => {
  type Payload = { prompt: string; keys: { openai: string } };
  const inner = unwrapFnInput<Payload>({
    data: { prompt: "QUESTION: hello", keys: { openai: "sk-test" } },
  } as unknown as Payload & { data?: Payload });
  assert.equal(inner.prompt, "QUESTION: hello");
});

test("unwrapFnInput does not drop prompt just because query is absent", () => {
  const dropped = unwrapFnInput({ prompt: "keep me" } as { query?: string; prompt?: string; data?: { prompt?: string } });
  assert.equal(dropped.prompt, "keep me");
});
