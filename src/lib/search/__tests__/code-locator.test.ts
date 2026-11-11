import assert from "node:assert/strict";
import { test } from "node:test";

import { routeSearchAnswer } from "../answer-route.ts";
import { covers, locateInCode } from "../code-locator.ts";
import { verifyClaim } from "../evidence.ts";
import { localCard } from "../local-card.ts";
import { prunePack } from "../../repo/folder.ts";
import { buildChunks, retrieve } from "../retrieve.ts";
import { contentWords } from "../spoken.ts";
import type { FileHit } from "../../repo/types.ts";
import { SAMPLE_SAAS } from "./fixtures/sample-saas.ts";

const chunks = buildChunks(SAMPLE_SAAS);
const fileOf = (path: string) => SAMPLE_SAAS.files.find((file) => file.path === path)?.content;

function wholeFileHit(path: string): FileHit {
  const content = fileOf(path)!;
  return {
    id: `${path}#0`,
    kind: "code" as const,
    path,
    startOffset: 0,
    text: content,
    startLine: 1,
    endLine: content.split("\n").length,
    score: 10,
  } as unknown as FileHit;
}

function ask(question: string) {
  return localCard(question, retrieve(question, chunks), SAMPLE_SAAS, 0);
}

test("stems match inflections the substring check misses", () => {
  assert.equal(covers("RETRYABLE_CODES retryable codes", ["retried"]), 1);
  assert.equal(covers("failed attempts", ["fails"]), 1);
  assert.equal(covers("checkout", ["weather"]), 0);
});

test("a value question is answered with the configuration line, verbatim", () => {
  const q = "What's the current rate limit on the checkout endpoint?";
  const located = locateInCode(q, contentWords(q.toLowerCase()), [wholeFileHit("src/middleware/rateLimit.ts")], fileOf);
  assert.ok(located);
  assert.equal(located.kind, "value");
  assert.match(located.say, /`checkout: \{ requests: 10, windowSeconds: 60 \}`/);
  assert.equal(located.span.startLine, 9);
  assert.ok(verifyClaim(located.say, [located.span], located.structural).ok);
});

test("the sentence leaves file and line to the citation chip", () => {
  const q = "What's the current rate limit on the checkout endpoint?";
  const located = locateInCode(q, contentWords(q.toLowerCase()), [wholeFileHit("src/middleware/rateLimit.ts")], fileOf)!;
  assert.doesNotMatch(located.say, /line \d/);
  assert.doesNotMatch(located.say, /\.(ts|tsx|py|js)\b/);
});

test("a where question points at the declaration whose name it uses", () => {
  const q = "Where is the rate limiter implemented?";
  const located = locateInCode(q, contentWords(q.toLowerCase()), [wholeFileHit("src/middleware/rateLimit.ts")], fileOf);
  assert.ok(located);
  assert.equal(located.kind, "handler");
  assert.equal(located.name, "rateLimit");
});

test("nothing is located when no declaration is named by the question", () => {
  const q = "What is the weather today?";
  assert.equal(locateInCode(q, contentWords(q.toLowerCase()), [wholeFileHit("src/payments/retry.ts")], fileOf), null);
});

test("offline answers match the MVP demo questions", () => {
  const cases: Array<[string, RegExp]> = [
    ["What's the current rate limit on the checkout endpoint?", /checkout: \{ requests: 10, windowSeconds: 60 \}/],
    ["How many times do we retry a payment?", /MAX_PAYMENT_RETRIES = 4/],
    ["What is the backoff delay between retries?", /RETRY_BASE_DELAY_MS = 2_000/],
    ["Which Stripe errors are retried?", /RETRYABLE_CODES/],
    ["What happens after the last retry fails?", /^After MAX_PAYMENT_RETRIES failed attempts/],
    ["How does the payment retry logic work?", /retrying transient failures with exponential backoff/],
    ["Where is the rate limiter implemented?", /`rateLimit` function/],
    ["How do we send the billing failure email?", /billing failure email/],
    ["What does the checkout route do?", /`POST \/checkout` route calls `rateLimit`, then `chargeWithRetry`/],
  ];
  for (const [question, expected] of cases) {
    const card = ask(question);
    assert.match(card.say ?? `(silent) ${card.reason}`, expected, question);
    assert.ok((card.citations?.length ?? 0) > 0, question);
  }
});

test("an off-topic question stays silent", () => {
  assert.equal(ask("What is the weather today?").say, null);
});

test("schema migrations survive pruning", () => {
  const { pack } = prunePack(SAMPLE_SAAS);
  assert.ok(pack.files.some((file) => file.path.endsWith("0007_user_preferences.sql")));
});

test("no model key still returns the cited offline answer, not an error", async () => {
  const saved = { openai: process.env.OPENAI_API_KEY, xai: process.env.XAI_API_KEY };
  delete process.env.OPENAI_API_KEY;
  delete process.env.XAI_API_KEY;
  try {
    const question = "How many times do we retry a payment?";
    // Hits from several sources keep the fast path closed, so the router has
    // to reach the model first and fall back when it cannot.
    const hits = retrieve(question, chunks).map((hit) => ({ ...hit, sourceId: hit.path }));
    const routed = await routeSearchAnswer(question, hits, performance.now(), {
      pack: SAMPLE_SAAS,
    } as Parameters<typeof routeSearchAnswer>[3]);
    assert.equal(routed.tier, "localCard");
    assert.match(routed.card.say ?? "", /MAX_PAYMENT_RETRIES = 4/);
  } finally {
    if (saved.openai) process.env.OPENAI_API_KEY = saved.openai;
    if (saved.xai) process.env.XAI_API_KEY = saved.xai;
  }
});
