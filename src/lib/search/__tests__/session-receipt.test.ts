import assert from "node:assert/strict";
import test from "node:test";

import type { AnswerHistoryItem } from "../answer-history.ts";
import {
  buildSessionReceipt,
  formatSessionReceiptText,
  isReceiptAnswer,
} from "../session-receipt.ts";

function item(partial: Partial<AnswerHistoryItem> & Pick<AnswerHistoryItem, "query">): AnswerHistoryItem {
  return {
    id: "1",
    say: null,
    badge: null,
    citations: [],
    timestamp: Date.now(),
    ...partial,
  };
}

test("isReceiptAnswer requires say and citations", () => {
  assert.equal(
    isReceiptAnswer(
      item({
        query: "What is Pascal's law?",
        say: "Pressure is transmitted equally.",
        citations: [{ kind: "file", path: "fluids.pptx", line: 3, label: "" }],
      }),
    ),
    true,
  );
  assert.equal(isReceiptAnswer(item({ query: "Weather?", say: null })), false);
  assert.equal(
    isReceiptAnswer(item({ query: "Guess?", say: "Maybe.", badge: "generated", citations: [] })),
    false,
  );
});

test("formatSessionReceiptText separates cited answers from unsupported", () => {
  const receipt = buildSessionReceipt(
    [
      item({
        id: "a",
        query: "What owns auth?",
        say: "The auth service verifies the session cookie.",
        badge: "from-docs",
        citations: [{ kind: "file", path: "src/auth.ts", line: 47, label: "" }],
        timestamp: 1_700_000_000_000,
      }),
      item({
        id: "b",
        query: "What's the weather?",
        say: null,
        timestamp: 1_700_000_060_000,
      }),
    ],
    "Acme SE pack",
    new Date("2026-09-18T20:00:00.000Z"),
  );
  const text = formatSessionReceiptText(receipt);
  assert.match(text, /Summary: 1 cited answer, 1 unsupported question/);
  assert.match(text, /Question: What owns auth\?/);
  assert.match(text, /Answer: The auth service verifies the session cookie\./);
  assert.match(text, /src\/auth\.ts:47/);
  assert.match(text, /Question: What's the weather\?/);
  assert.match(text, /Not supported — no cited evidence/);
  assert.doesNotMatch(text, /Maybe\./);
});
