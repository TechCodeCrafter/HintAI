import assert from "node:assert/strict";
import { test } from "node:test";

import { NORTHSTAR } from "../../repo/northstar.ts";
import type { Card, RepoPack } from "../../repo/types.ts";
import { isFileHit } from "../../repo/types.ts";
import { cardFromHistory, historyItemFromCard } from "../answer-history.ts";
import { commitEvidence } from "../evidence.ts";
import { localCard } from "../local-card.ts";
import { buildChunks, retrieve } from "../retrieve.ts";
import { evidenceKey, highlight, whyAnswer } from "../why-answer.ts";

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

test("highlight marks the sentence the line repeats as one exact span and loses no character", () => {
  const text = " * Retries a failed export up to three times with exponential backoff.\n */";
  const segments = highlight(text, "Retries a failed export up to three times with exponential backoff.");
  assert.equal(segments.map((s) => s.text).join(""), text);
  const exact = segments.filter((s) => s.exact).map((s) => s.text);
  // The sentence as the file holds it, filler words included, and nothing around it.
  assert.deepEqual(exact, ["Retries a failed export up to three times with exponential backoff"]);
  assert.ok(segments.filter((s) => s.exact).every((s) => s.hit));
  // Comment markers are not part of what was said.
  assert.ok(!segments.some((s) => s.hit && s.text.includes("*")));
});

test("words the line uses out of order are marked one by one, not as an exact span", () => {
  const text = "const MAX_ATTEMPTS = 3; // the export is retried, then parked";
  const segments = highlight(text, "A parked export had been retried 3 times.");
  assert.equal(segments.map((s) => s.text).join(""), text);
  assert.ok(segments.every((s) => !s.exact));
  const marked = segments.filter((s) => s.hit).map((s) => s.text);
  // A number is marked however short it is. Filler words are not.
  assert.deepEqual(marked, ["3", "export", "retried", "parked"]);
});

test("an exact span ignores case and punctuation, and stops at a line break", () => {
  const text = "// Sessions are stored in an\n// encrypted cookie, that EXPIRES after twelve hours.";
  const segments = highlight(text, "Sessions are stored in an encrypted cookie that expires after twelve hours.");
  assert.equal(segments.map((s) => s.text).join(""), text);
  assert.deepEqual(
    segments.filter((s) => s.exact).map((s) => s.text),
    ["Sessions are stored in an", "encrypted cookie, that EXPIRES after twelve hours"],
  );
  // The line break and the comment marker between the two halves are left unmarked.
  assert.ok(segments.some((s) => !s.hit && s.text === "\n// "));
});

test("three filler words in a row are not an exact span", () => {
  const segments = highlight("this is not what the retry does", "It is not what the queue is for.");
  assert.ok(segments.every((s) => !s.exact), JSON.stringify(segments));
});

test("a paraphrased line marks the run it quotes exactly and the other words it uses", () => {
  const text = "Failed exports wait in the queue. The worker retries three times with a doubling delay before parking.";
  const segments = highlight(text, "The exporter retries three times with a doubling delay, then the queue holds it.");
  assert.deepEqual(
    segments.filter((s) => s.exact).map((s) => s.text),
    ["retries three times with a doubling delay"],
  );
  assert.deepEqual(
    segments.filter((s) => s.hit && !s.exact).map((s) => s.text),
    ["queue"],
  );
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
  // A local card reads a sentence out, so the sentence is one exact span.
  const exact = span.segments.filter((s) => s.exact).map((s) => s.text);
  assert.equal(exact.length, 1);
  assert.ok(card.say.toLowerCase().includes(exact[0]!.toLowerCase()), exact[0]);
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

test("an answer keeps one name through history, a reload and the second screen", () => {
  const card = ask("How many times is a failed export retried and what happens after the last attempt?");
  const key = evidenceKey(card);
  assert.ok(key);
  // The second screen and a reload both read the card back from JSON.
  assert.equal(evidenceKey(JSON.parse(JSON.stringify(card))), key);
  assert.equal(evidenceKey(cardFromHistory(JSON.parse(JSON.stringify(historyItemFromCard(card))))), key);

  // Another answer, or the same line for another question, is another name.
  const other = ask("How many times is a failed export retried?");
  assert.notEqual(evidenceKey(other), key);
  assert.notEqual(evidenceKey({ ...card, query: "Something else?" }), key);
  // A card that says nothing has no evidence view to remember.
  assert.equal(evidenceKey(ask("Which region hosts the export workers?")), null);
  assert.equal(evidenceKey(null), null);
});
