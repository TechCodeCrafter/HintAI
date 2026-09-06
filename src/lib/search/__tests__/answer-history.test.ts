import assert from "node:assert/strict";
import { test } from "node:test";

import type { Card, FileCitation } from "../../repo/types.ts";
import {
  ANSWER_HISTORY_LIMIT,
  appendAnswerHistory,
  badgeFromAnswerMode,
  cardFromHistory,
  findHistoryItem,
  historyItemFromCard,
} from "../answer-history.ts";

const cite: FileCitation = {
  kind: "file",
  path: "src/exporter/retry.ts",
  line: 12,
  label: "src/exporter/retry.ts",
};

function card(partial: Partial<Card>): Card {
  return {
    say: "Retries stop at three.",
    citations: [cite],
    query: "Why does that retry three times?",
    latencyMs: 8,
    source: "local",
    answerMode: "docs",
    ...partial,
  };
}

test("history items keep the query, badge, citations, and timestamp", () => {
  const item = historyItemFromCard(card({ answerMode: "synthesized" }), 1_700_000_000_000);
  assert.equal(item.query, "Why does that retry three times?");
  assert.equal(item.say, "Retries stop at three.");
  assert.equal(item.badge, "synthesized");
  assert.equal(item.citations[0]?.kind, "file");
  assert.equal(item.timestamp, 1_700_000_000_000);
  assert.match(item.id, /^1700000000000-/);
});

test("badge mapping covers the three answer paths", () => {
  assert.equal(badgeFromAnswerMode("docs"), "from-docs");
  assert.equal(badgeFromAnswerMode("synthesized"), "synthesized");
  assert.equal(badgeFromAnswerMode("generated"), "generated");
  assert.equal(badgeFromAnswerMode(undefined), null);
});

test("append keeps the newest first and caps at 50", () => {
  let history = appendAnswerHistory([], card({ query: "one" }));
  history = appendAnswerHistory(history, card({ query: "two" }));
  history = appendAnswerHistory(history, card({ query: "three" }));
  assert.deepEqual(
    history.map((item) => item.query),
    ["three", "two", "one"],
  );
  assert.equal(appendAnswerHistory([], card({ query: "   " })).length, 0);

  let filled = history;
  for (let i = 0; i < ANSWER_HISTORY_LIMIT; i += 1) {
    filled = appendAnswerHistory(filled, card({ query: `q${i}` }));
  }
  assert.equal(filled.length, ANSWER_HISTORY_LIMIT);
  assert.equal(filled[0]?.query, `q${ANSWER_HISTORY_LIMIT - 1}`);
});

test("restore rebuilds a Card from a history item", () => {
  const item = historyItemFromCard(card({ answerMode: "generated", say: "Rain in Paris." }));
  const restored = cardFromHistory(item);
  assert.equal(restored.say, "Rain in Paris.");
  assert.equal(restored.answerMode, "generated");
  assert.equal(restored.query, item.query);
  assert.equal(restored.latencyMs, 0);
  assert.equal(findHistoryItem(item.id, [item])?.say, "Rain in Paris.");
  assert.equal(findHistoryItem("missing", [item]), undefined);
});
