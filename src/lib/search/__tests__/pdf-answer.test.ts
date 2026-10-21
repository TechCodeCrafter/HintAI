/**
 * PDF answers. Taken from a real beta guide where 1 in 10 in-document
 * questions got an answer: retrieval showed the model two chunks of the whole
 * PDF, and the support check rejected correct replies over "~35 min" vs
 * "approximately 35 minutes", a list marker read as a quantity, or a subject
 * word taken from a neighbouring chunk. None of that may loosen the contract:
 * a number from one passage still cannot be attached to another's subject.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { DocumentChunk } from "../../document/types.ts";
import type { DocumentHit } from "../../repo/types.ts";
import { textEvidence, verifyClaim } from "../evidence.ts";
import { citedSentences, generateAnswer, synthesizeAnswer } from "../generate-answer.ts";
import { retrieve } from "../retrieve.ts";

function passage(text: string) {
  const span = textEvidence({ path: "guide.pdf", content: text, start: 0, end: text.length, normalizedText: text });
  assert.ok(span);
  return span;
}

let nextId = 0;
function docChunk(page: number, text: string): DocumentChunk {
  nextId += 1;
  return {
    kind: "document",
    id: `guide-${nextId}`,
    path: "guide.pdf",
    sourceId: "guide",
    page,
    startOffset: 0,
    endOffset: text.length,
    text,
    contentHash: "hash-guide",
    readingOrder: "single-column",
  };
}

function hit(chunk: DocumentChunk, score = 5): DocumentHit {
  return { ...chunk, score };
}

const ask = (text: string) => async () => ({ text });

test("unit abbreviations and plurals in the PDF support the spoken form", () => {
  assert.ok(verifyClaim("Ask mode takes approximately 35 minutes.", [passage("C Ask mode · ~35 min")]).ok);
  assert.ok(verifyClaim("The test session duration is 2–2.5 hours.", [passage("Test session duration: 2–2.5 hour.")]).ok);
  // Still whole words: an abbreviation inside another word is not support.
  assert.equal(verifyClaim("Reviews take 35 minutes.", [passage("Reviews go to the admin queue 35")]).ok, false);
});

test("a number keeps its unit: a percent or another unit is not support", () => {
  const timeout = [passage("The request timeout is 5 seconds for the payments service.")];
  assert.equal(verifyClaim("The request timeout is 5% for the payments service.", timeout).ok, false);
  assert.equal(verifyClaim("The request timeout is 5 ms for the payments service.", timeout).ok, false);
  assert.equal(verifyClaim("The request timeout is 5 minutes for the payments service.", timeout).ok, false);
  const p99 = [passage("The payments service p99 is 120ms under load.")];
  assert.equal(verifyClaim("The payments service p99 is 120 seconds under load.", p99).ok, false);
  const budget = [passage("Error budget is 2 percent per quarter for the payments service.")];
  assert.ok(verifyClaim("Error budget is 2% per quarter for the payments service.", budget).ok);
  // "5 h" is a substring of "5 hosts"; that is not an hours figure.
  const hosts = [passage("The payments cluster runs 5 hosts in each region.")];
  assert.equal(verifyClaim("The payments cluster runs 5 h in each region.", hosts).ok, false);
});

test("compact unit forms in the evidence support the spelled-out answer", () => {
  const retry = [passage("The payments worker retries every 10s with backoff.")];
  assert.ok(verifyClaim("The payments worker retries every 10 seconds with backoff.", retry).ok);
  const batch = [passage("The payments batch job runs for 2h nightly.")];
  assert.ok(verifyClaim("The payments batch job runs for 2 hours nightly.", batch).ok);
});

test("a numbered-list marker is not a quantity the answer dropped", () => {
  const evidence = [passage("2 No invite code needed — your account is created when you sign up.")];
  assert.ok(verifyClaim("No invite code needed — your account is created when you sign up.", evidence).ok);
});

test("a number cannot be moved onto another passage's subject", () => {
  const evidence = [passage("Know before you answer Beta testing session guide"), passage("C Ask mode · ~35 min")];
  const wrong = verifyClaim("The beta testing session takes approximately ~35 min.", evidence);
  assert.equal(wrong.ok, false);
  assert.ok(wrong.missing.includes("numeric"));
});

test("a single PDF can fill the prompt, a few chunks per page", () => {
  const chunks = [
    ...Array.from({ length: 5 }, (_, i) => docChunk(1, `Session timing note ${i + 1}: the session lasts two hours.`)),
    ...Array.from({ length: 5 }, (_, i) => docChunk(i + 2, `Session agenda page ${i + 2} for the test session.`)),
  ];
  const hits = retrieve("How long does the test session last?", chunks, 6);
  assert.equal(hits.length, 6, "one PDF used to be capped at two hits");
  const perPage = new Map<number, number>();
  for (const h of hits) if (h.kind === "document") perPage.set(h.page, (perPage.get(h.page) ?? 0) + 1);
  assert.ok([...perPage.values()].every((n) => n <= 3), "at most three chunks from one page");
});

test("a word taken from an uncited chunk the model saw is allowed, and that chunk is cited", async () => {
  const title = hit(docChunk(1, "Know before you answer Beta testing session guide"));
  const fact = hit(docChunk(1, "Duration 2–2.5 hours"));
  const generated = await generateAnswer("How long does the beta testing session take?", [title, fact], 0, {
    ask: ask("Beta testing session guide: duration 2–2.5 hours [2]."),
  });
  assert.ok(generated.ok);
  const cited = generated.answer.citations.filter((c) => c.kind === "document").map((c) => c.path);
  assert.equal(cited.length, 2, "both the fact and the subject's chunk are cited");
});

test("a sentence that verifies is kept when the one beside it does not", async () => {
  const invite = hit(docChunk(2, "2 No invite code needed — your account is created when you sign up."));
  const phase = hit(docChunk(4, "A Sign-up and account · ~15 min"));
  const generated = await synthesizeAnswer("How do I sign up?", [invite, phase], 0, {
    ask: ask(
      "No invite code needed — your account is created when you sign up [1]. The sign-up process involves several hidden steps [2].",
    ),
  });
  assert.ok(generated.ok);
  assert.equal(generated.answer.say, "No invite code needed — your account is created when you sign up.");
  assert.equal(generated.answer.citations.length, 1);
});

test("an answer with no sentence that verifies stays silent", async () => {
  const phase = hit(docChunk(4, "A Sign-up and account · ~15 min"));
  const generated = await generateAnswer("How long is sign-up?", [phase], 0, {
    ask: ask("Sign-up takes about an hour of onboarding calls [1]."),
  });
  assert.equal(generated.ok, false);
});

test("citedSentences keeps each sentence's markers with it", () => {
  assert.deepEqual(citedSentences("A is one [1]. B is two. [2] C is three [3]."), [
    "A is one [1].",
    "B is two. [2]",
    "C is three [3].",
  ]);
});
