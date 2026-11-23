import assert from "node:assert/strict";
import { test } from "node:test";

import { NORTHSTAR } from "../../repo/northstar.ts";
import type { Card, RepoPack } from "../../repo/types.ts";
import { isFileHit } from "../../repo/types.ts";
import { cardFromHistory, historyItemFromCard } from "../answer-history.ts";
import { commitEvidence } from "../evidence.ts";
import { localCard } from "../local-card.ts";
import { buildChunks, retrieve } from "../retrieve.ts";
import { highlight, whyAnswer } from "../why-answer.ts";

const RETRY = `/**
 * Retries a failed export up to three times with exponential backoff.
 */
export function retryExport(job: Job) {
  return schedule(job, 3);
}

/**
 * After the last attempt the export job is moved to the dead letter queue.
 */
export function parkJob(job: Job) {
  return deadLetter.push(job);
}
`;

const pack: RepoPack = {
  id: "why",
  name: "why",
  description: "",
  commits: [],
  files: [{ path: "src/export/retry.ts", language: "ts", content: RETRY }],
};
const chunks = buildChunks(pack);

function ask(question: string): Card {
  return localCard(question, retrieve(question, chunks).filter(isFileHit), pack, 1, null);
}

test("highlight marks the words the spoken line uses and loses no character", () => {
  const text = " * Retries a failed export up to three times with exponential backoff.\n */";
  const segments = highlight(text, "Retries a failed export up to three times with exponential backoff.");
  assert.equal(segments.map((s) => s.text).join(""), text);
  const marked = segments.filter((s) => s.hit).map((s) => s.text);
  assert.ok(marked.includes("failed export"), marked.join("|"));
  assert.ok(marked.some((m) => m.includes("exponential backoff")), marked.join("|"));
  // Comment markers and filler words are not part of what was said.
  assert.ok(!marked.some((m) => m.includes("*")));
  assert.ok(!marked.includes("a"));
});

test("highlight leaves text alone when nothing was spoken from it", () => {
  assert.deepEqual(highlight("const LIMIT = 3;", ""), [{ text: "const LIMIT = 3;", hit: false }]);
  assert.deepEqual(highlight("", "anything at all"), []);
  const none = highlight("Builds the monthly invoice.", "Retries a failed export.");
  assert.ok(none.every((s) => !s.hit));
});

test("a local card opens to the exact span it spoke from", () => {
  const card = ask("How many times is a failed export retried?");
  assert.ok(card.say);
  const spans = whyAnswer(card);
  assert.equal(spans.length, 1);
  const [span] = spans;
  assert.equal(span.kind, "text");
  assert.equal(span.label, "src/export/retry.ts:2");
  // The text shown is the span as the file holds it, at the offsets it claims.
  const evidence = card.evidence?.[0];
  assert.ok(evidence && evidence.kind === "text");
  assert.equal(span.text, RETRY.slice(evidence.startOffset, evidence.endOffset));
  assert.equal(span.segments.map((s) => s.text).join(""), span.text);
  assert.ok(span.segments.some((s) => s.hit));
});

test("a combined card lists one span per spoken sentence, each with its own sentence", () => {
  const card = ask("How many times is a failed export retried and what happens after the last attempt?");
  const spans = whyAnswer(card);
  assert.equal(spans.length, 2);
  assert.deepEqual(spans.map((s) => s.label), ["src/export/retry.ts:2", "src/export/retry.ts:9"]);
  assert.equal(spans[0].said, "Retries a failed export up to three times with exponential backoff.");
  assert.equal(spans[1].said, "After the last attempt the export job is moved to the dead letter queue.");
  // Each span is marked with its own sentence, not with the other one.
  const marks = (i: number) => spans[i].segments.filter((s) => s.hit).map((s) => s.text).join(" ");
  assert.match(marks(0), /backoff/);
  assert.doesNotMatch(marks(0), /queue/);
  assert.match(marks(1), /dead letter queue/);
});

test("a silent card has no answer to explain", () => {
  const card = ask("Which region hosts the export workers?");
  assert.equal(card.say, null);
  assert.deepEqual(whyAnswer(card), []);
  assert.deepEqual(whyAnswer(null), []);
});

test("commit evidence is shown as a commit, with who and when", () => {
  const commit = NORTHSTAR.commits[0];
  const evidence = commitEvidence(commit, commit.message);
  assert.ok(evidence);
  const spans = whyAnswer({ say: commit.message, evidence: [evidence] });
  assert.equal(spans.length, 1);
  assert.equal(spans[0].kind, "commit");
  assert.equal(spans[0].label, `commit ${evidence.shortSha}`);
  assert.equal(spans[0].text, commit.message);
  assert.ok(spans[0].detail?.includes(commit.author));
});

test("an answer restored from history still opens to its evidence", () => {
  const card = ask("How many times is a failed export retried and what happens after the last attempt?");
  const restored = cardFromHistory(JSON.parse(JSON.stringify(historyItemFromCard(card))));
  assert.equal(restored.say, card.say);
  assert.deepEqual(whyAnswer(restored), whyAnswer(card));

  const silent = ask("Which region hosts the export workers?");
  const item = historyItemFromCard(silent);
  assert.equal(item.evidence, undefined);
  assert.equal(item.parts, undefined);
});
