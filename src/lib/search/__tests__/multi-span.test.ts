import assert from "node:assert/strict";
import { test } from "node:test";

import { NORTHSTAR } from "../../repo/northstar.ts";
import type { RepoPack } from "../../repo/types.ts";
import { isFileHit } from "../../repo/types.ts";
import { FAST_PATH_MIN_SCORE } from "../answer-fast-path.ts";
import { routeSearchAnswer } from "../answer-route.ts";
import { type TextEvidence, textEvidence } from "../evidence.ts";
import { localCard } from "../local-card.ts";
import { MAX_COMBINED_CHARS, MAX_COMBINED_SPANS, type SpanCandidate, combineSpans } from "../multi-span.ts";
import { buildChunks, retrieve } from "../retrieve.ts";
import { QUOTA_FALLBACK_NOTE, QUOTA_FALLBACK_REASON, modelFallbackNote } from "../silence.ts";

const RETRY = `/**
 * Retries a failed export up to three times with exponential backoff.
 */
export function retryExport(job: Job) {
  return schedule(job, 3);
}

const LIMIT = 3;

/**
 * After the last attempt the export job is moved to the dead letter queue.
 */
export function parkJob(job: Job) {
  return deadLetter.push(job);
}
`;

const NOTIFY = `/**
 * Sends the account owner an email when an export lands in the dead letter queue.
 */
export function notifyOwner(job: Job) {
  return mail.send(job.owner);
}
`;

const pack: RepoPack = {
  id: "multi-span",
  name: "multi-span",
  description: "two halves of one answer",
  commits: [],
  files: [
    { path: "src/export/retry.ts", language: "ts", content: RETRY },
    { path: "src/export/notify.ts", language: "ts", content: NOTIFY },
    {
      path: "src/billing/invoice.ts",
      language: "ts",
      content: "/**\n * Builds the monthly invoice from metered usage.\n */\nexport function buildInvoice() { return 1; }\n",
    },
  ],
};
const chunks = buildChunks(pack);

function card(question: string) {
  return localCard(question, retrieve(question, chunks).filter(isFileHit), pack, 1, null);
}

/** The exact words a text span holds, without comment markers. */
function written(span: TextEvidence): string {
  return span.text.replace(/^[\s/*]+/gm, "").replace(/\s+/g, " ").trim();
}

function candidate(content: string, path: string, sentence: string, score: number): SpanCandidate {
  const start = content.indexOf(sentence);
  assert.ok(start >= 0, sentence);
  const span = textEvidence({ path, content, start, end: start + sentence.length, normalizedText: sentence });
  assert.ok(span);
  return { say: sentence, span, score };
}

test("a two-part question is answered from two spans of one file, each sentence cited", () => {
  const out = card("How many times is a failed export retried and what happens after the last attempt?");
  assert.equal(
    out.say,
    "Retries a failed export up to three times with exponential backoff. After the last attempt the export job is moved to the dead letter queue.",
  );
  assert.equal(out.evidence?.length, 2);
  assert.equal(out.citations.length, 2);
  assert.deepEqual(
    out.citations.map((c) => (c.kind === "file" ? `${c.path}:${c.line}` : c.kind)),
    ["src/export/retry.ts:2", "src/export/retry.ts:11"],
  );
  // Every spoken sentence names the span it was read from, and is in it word for word.
  assert.equal(out.parts?.length, 2);
  for (const part of out.parts ?? []) {
    const span = out.evidence?.find((item) => item.kind === "text" && item.id === part.evidenceId);
    assert.ok(span && span.kind === "text", part.say);
    assert.ok(written(span).includes(part.say.replace(/\.$/, "")), part.say);
  }
  assert.equal(out.parts?.map((p) => p.say).join(" "), out.say);
});

test("a question one sentence covers is still answered from one span", () => {
  const out = card("How many times is a failed export retried?");
  assert.equal(out.say, "Retries a failed export up to three times with exponential backoff.");
  assert.equal(out.evidence?.length, 1);
  assert.equal(out.citations.length, 1);
  assert.equal(out.parts, undefined);
});

test("two files each contribute a sentence and both are cited", () => {
  const out = card("What happens to an export job after the last attempt, and who gets an email?");
  assert.ok(out.say);
  assert.equal(out.evidence?.length, 2);
  const paths = out.citations.map((c) => (c.kind === "file" ? c.path : ""));
  assert.deepEqual(paths, ["src/export/retry.ts", "src/export/notify.ts"]);
  assert.match(out.say ?? "", /dead letter queue\. Sends the account owner an email/);
});

test("sentences from the same file are spoken in the order the file wrote them", () => {
  const first = "Retries a failed export up to three times with exponential backoff.";
  const second = "After the last attempt the export job is moved to the dead letter queue.";
  const lead = candidate(RETRY, "src/export/retry.ts", second, 9);
  const support = candidate(RETRY, "src/export/retry.ts", first, 4);
  const combined = combineSpans(second, lead, [support], "Where does the job go after the last attempt, and how many retries with backoff?");
  assert.ok(combined);
  assert.equal(combined.say, `${first} ${second}`);
  assert.deepEqual(combined.evidence.map((span) => span.startLine), [2, 11]);
  assert.deepEqual(combined.parts.map((part) => part.evidenceId), combined.evidence.map((span) => span.id));
});

test("the lead file is spoken first, then the file that supports it", () => {
  const lead = candidate(NOTIFY, "src/export/notify.ts", "Sends the account owner an email when an export lands in the dead letter queue.", 9);
  const support = candidate(RETRY, "src/export/retry.ts", "Retries a failed export up to three times with exponential backoff.", 4);
  const combined = combineSpans(lead.say, lead, [support], "Who gets an email, and how many retries with backoff?");
  assert.ok(combined);
  assert.deepEqual(combined.evidence.map((span) => span.path), ["src/export/notify.ts", "src/export/retry.ts"]);
});

test("a sentence that covers nothing new is not added", () => {
  const lead = candidate(RETRY, "src/export/retry.ts", "Retries a failed export up to three times with exponential backoff.", 9);
  const repeat = candidate(NOTIFY, "src/export/notify.ts", "Sends the account owner an email when an export lands in the dead letter queue.", 5);
  // "invoice" is uncovered, and the candidate does not cover it either.
  assert.equal(combineSpans(lead.say, lead, [repeat], "How are export retries and the invoice handled?"), null);
  // Nothing is uncovered: one span already says it.
  assert.equal(combineSpans(lead.say, lead, [repeat], "How many export retries with backoff?"), null);
  // One stray matching word in a one-part question is not a reason to add a sentence.
  assert.equal(combineSpans(lead.say, lead, [repeat], "How do export retries reach the owner?"), null);
});

test("a sentence that restates the lead is not joined, even with one new question word", () => {
  const first = "Attempts are capped at three because the payment gateway stalls rather than failing fast.";
  const second = "Exporter attempts are capped at three because the payment gateway stalls instead of failing fast.";
  const content = `${first}\n${second}`;
  const lead = candidate(content, "src/exporter/retry.ts", first, 9);
  const echo = candidate(content, "src/exporter/retry.ts", second, 6);
  assert.equal(combineSpans(lead.say, lead, [echo], "Why are attempts capped, and what about the exporter?"), null);
});

test("the demo retry question still gets one sentence from the source file", () => {
  const demo = buildChunks(NORTHSTAR);
  const question = "How does the app retry failed exports?";
  const out = localCard(question, retrieve(question, demo).filter(isFileHit), NORTHSTAR, 1, null);
  assert.equal(
    out.say,
    "Attempts are capped at three because the payment gateway stalls rather than failing fast, so a fourth attempt duplicates the settlement file instead of recovering it.",
  );
  assert.equal(out.citations.length, 1);
  assert.equal(out.parts, undefined);
});

test("never more than three spans, and never past the spoken budget", () => {
  const lines = [
    "Alpha workers drain the ingest queue every minute.",
    "Bravo workers compact the archive segments nightly.",
    "Charlie workers rotate the signing keys weekly.",
    "Delta workers prune the expired sessions hourly.",
  ];
  const content = lines.join("\n");
  const [lead, ...rest] = lines.map((line, i) => candidate(content, "docs/workers.md", line, 9 - i));
  const combined = combineSpans(lead.say, lead, rest, "What do alpha workers, bravo workers, charlie workers and delta workers do?");
  assert.ok(combined);
  assert.equal(combined.evidence.length, MAX_COMBINED_SPANS);
  assert.ok(combined.say.length <= MAX_COMBINED_CHARS);
  assert.ok(!combined.say.includes("Delta"));

  const long = `Bravo workers ${"compact and verify ".repeat(9)}the archive segments nightly.`;
  const longContent = `${lines[0]}\n${long}`;
  const longLead = candidate(longContent, "docs/workers.md", lines[0], 9);
  const tooLong = candidate(longContent, "docs/workers.md", long, 5);
  assert.equal(combineSpans(longLead.say, longLead, [tooLong], "What do alpha workers and bravo workers do?"), null);
});

test("a sentence its own span does not hold is never joined", () => {
  const lead = candidate(RETRY, "src/export/retry.ts", "Retries a failed export up to three times with exponential backoff.", 9);
  const real = candidate(NOTIFY, "src/export/notify.ts", "Sends the account owner an email when an export lands in the dead letter queue.", 5);
  // The candidate claims words its span never wrote.
  const forged: SpanCandidate = { ...real, say: "Sends the finance team a pager alert when an export fails." };
  assert.equal(combineSpans(lead.say, lead, [forged], "How many retries, and does finance get a pager alert?"), null);
});

test("with the daily model limit spent the composer answers and no model is called", async () => {
  const question = "How many times is a failed export retried and what happens after the last attempt?";
  let calls = 0;
  const routed = await routeSearchAnswer(question, retrieve(question, chunks), 0, {
    pack,
    localOnly: "quota",
    ask: async () => {
      calls += 1;
      return { text: "The model should not be asked." };
    },
  });
  assert.equal(calls, 0);
  assert.equal(routed.tier, "localCard");
  assert.equal(routed.consumeQuota, false);
  assert.match(routed.card.say ?? "", /three times/);
  assert.ok(routed.card.citations.length >= 1);
});

test("a local answer given because the limit is spent says so", async () => {
  // A document-only pack whose best hit scores under the no-model fast path:
  // the route normally asks the model first, and falls back to the composer.
  const docs: RepoPack = {
    id: "runbook",
    name: "runbook",
    description: "one runbook",
    commits: [],
    files: [
      {
        path: "docs/runbook.md",
        language: "md",
        content:
          "# Export runbook\n\nA failed export is retried three times before the job is parked.\n\n## Paging\n\nThe on-call engineer is paged when a job is parked.\n",
      },
    ],
  };
  const question = "How many times is a failed export retried?";
  const hits = retrieve(question, buildChunks(docs), 6).map((hit) => ({
    ...hit,
    score: Math.min(hit.score, FAST_PATH_MIN_SCORE - 0.5),
  }));
  assert.ok(hits.length > 0);

  let modelCalls = 0;
  const withModel = await routeSearchAnswer(question, hits, 0, {
    pack: docs,
    ask: async () => {
      modelCalls += 1;
      return { text: "INSUFFICIENT" };
    },
  });
  assert.ok(modelCalls > 0, "the model is asked first while there is quota");
  assert.match(withModel.card.say ?? "", /retried three times/);
  assert.equal(withModel.card.modelFallback, undefined);

  let calls = 0;
  const routed = await routeSearchAnswer(question, hits, 0, {
    pack: docs,
    localOnly: "quota",
    ask: async () => {
      calls += 1;
      return { text: "INSUFFICIENT" };
    },
  });
  assert.equal(calls, 0);
  assert.equal(routed.tier, "localCard");
  assert.equal(routed.modelSkipped, "quota");
  assert.equal(routed.consumeQuota, false);
  assert.equal(routed.card.say, withModel.card.say);
  assert.ok(routed.card.citations.some((c) => c.kind === "file" && c.path === "docs/runbook.md"));
  assert.equal(routed.card.modelFallback, QUOTA_FALLBACK_REASON);
  assert.equal(modelFallbackNote(routed.card.modelFallback), QUOTA_FALLBACK_NOTE);
});

test("with the limit spent and nothing the composer can cite, the Card is silent and no model is called", async () => {
  const question = "Which region hosts the export workers?";
  const hits = retrieve(question, chunks);
  let calls = 0;
  const routed = await routeSearchAnswer(question, hits, 0, {
    pack,
    localOnly: "quota",
    ask: async () => {
      calls += 1;
      return { text: "The export workers run in Frankfurt." };
    },
  });
  assert.equal(calls, 0);
  assert.equal(routed.card.say, null);
  assert.ok(routed.card.reason);
  assert.equal(routed.consumeQuota, false);
});
