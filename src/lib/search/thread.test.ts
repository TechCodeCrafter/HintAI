import assert from "node:assert/strict";
import { test } from "node:test";

import type { Card } from "../repo/types.ts";
import { shapeOf } from "./intent.ts";
import { gateNewest } from "./question.ts";
import { normalizeSpokenQuestion } from "./spoken.ts";
import { resolveReference, threadFrom, withdrawReplay, type ThreadContext } from "./thread.ts";

const card = (say: string, paths: string[]): Card => ({
  say,
  citations: paths.map((path) => ({ kind: "file" as const, path, line: 1, label: `${path}:1` })),
  query: "",
  latencyMs: 0,
  source: "local",
});

/** A thread as the store seeds it: from a question that actually got answered. */
function answered(question: string, claim: string, paths: string[], subject: string[]): ThreadContext {
  const canonical = normalizeSpokenQuestion(question).canonical;
  const thread = threadFrom({
    utteranceId: "u1",
    canonical,
    shape: shapeOf(canonical),
    subject,
    card: card(claim, paths),
  });
  assert.ok(thread, "a spoken card must seed a thread");
  return thread;
}

const vocab = new Set([
  "upload", "uploads", "document", "processing", "service", "worker", "ingest", "bda",
  "excel", "export", "extraction", "retry", "bedrock", "template", "config",
]);

const ask = (text: string, context: string[], thread: ThreadContext | null) =>
  gateNewest({ id: "n1", text }, context, { vocab, threadOpen: Boolean(thread), thread });

const UPLOAD = () =>
  answered(
    "How does document upload work?",
    "Handles file upload and document processing endpoints.",
    ["api/routers/uploads.py"],
    ["upload"],
  );

test("A: 'and after that?' asks for the next step, not the previous question", () => {
  const thread = UPLOAD();
  const next = ask("And after that?", ["How does document upload work?"], thread);

  assert.equal(next.verdict, "follow-up");
  assert.equal(next.resolution?.kind, "continuation");
  // The previous question's frame must not travel into the query — that is the
  // mechanism that made the composer answer it a second time.
  assert.doesNotMatch(next.question ?? "", /how does document upload work/i);
  assert.match(next.question ?? "", /after/i);
  assert.match(next.question ?? "", /upload/i);
});

test("A: and the previous claim can never be spoken again as the follow-up answer", () => {
  const thread = UPLOAD();
  const replay = withdrawReplay(card(thread.claim, ["api/routers/uploads.py"]), thread, true);
  assert.equal(replay.say, null);
  assert.match(replay.reason ?? "", /same answer/i);

  // A genuinely new line is left alone.
  const fresh = withdrawReplay(card("Publishes the extraction job to SQS.", ["x.py"]), thread, true);
  assert.equal(fresh.say, "Publishes the extraction job to SQS.");
});

test("B: 'this service' resolves to the one service the thread established", () => {
  const thread = answered(
    "What does document_processing_service.py do?",
    "Orchestrates the document processing pipeline.",
    ["services/document_processing_service.py"],
    ["document_processing_service"],
  );
  const next = ask("So this service is doing all of it?", ["What does document_processing_service.py do?"], thread);

  assert.equal(next.verdict, "follow-up");
  assert.equal(next.resolution?.resolved, "document_processing_service");
  assert.match(next.question ?? "", /document_processing_service/);
  // The generic word must not survive as something retrieval can match freely.
  assert.doesNotMatch(next.question ?? "", /\bthis service\b/i);
});

test("B: a second candidate service in the thread is ambiguity, so silence", () => {
  const thread = answered(
    "What does document_processing_service.py do?",
    "Orchestrates the document processing pipeline.",
    ["services/document_processing_service.py", "services/llm/bedrock_service.py"],
    ["document_processing_service"],
  );
  const next = ask("So this service is doing all of it?", [], thread);

  assert.equal(next.verdict, "unresolved-reference");
  assert.equal(next.question, null);
  assert.match(next.resolution?.reason ?? "", /ambiguous/i);
});

test("C: with no active thread, a generic noun is a reference and stays silent", () => {
  const next = ask("So this service is doing all of it?", [], null);
  assert.equal(next.verdict, "unresolved-reference");
  assert.equal(next.question, null);

  // Same for the other pointer nouns named in the spec.
  for (const q of ["Is this worker doing all of it?", "What owns this flow?", "Where does that thing run?"]) {
    assert.equal(ask(q, [], null).question, null, q);
  }
});

test("C: a question that names its own subject is never grounded or silenced", () => {
  const thread = UPLOAD();
  const next = ask("What does this contract say about termination?", [], thread);
  assert.equal(next.verdict, "question");
  assert.equal(next.usedContext, false);
  assert.doesNotMatch(next.question ?? "", /upload/i);
});

test("D: a resolved 'Why?' is a WHY question and keeps the rationale gate", () => {
  const thread = answered(
    "What does the BDA ingest worker do?",
    "Handles PDF to Markdown conversion using AWS Bedrock Data Automation.",
    ["container-lambdas/bda-ingest-worker/app/lambda_function.py"],
    ["bda", "ingest", "worker"],
  );
  const next = ask("Why?", ["What does the BDA ingest worker do?"], thread);

  assert.equal(next.verdict, "follow-up");
  assert.equal(shapeOf(next.question ?? ""), "why");
  // It carries the subject, not the previous question — otherwise "what does the
  // worker do" would be sitting in the query for the composer to answer again.
  assert.match(next.question ?? "", /worker/i);
  assert.doesNotMatch(next.question ?? "", /what does the bda ingest worker do/i);
});

test("E: 'what calls it?' resolves the pointer to the established entity", () => {
  const thread = answered(
    "Where is upload handled?",
    "Handles file upload and document processing endpoints.",
    ["api/routers/uploads.py"],
    ["upload"],
  );
  const next = ask("What calls it?", ["Where is upload handled?"], thread);

  assert.equal(next.verdict, "follow-up");
  assert.match(next.resolution?.resolved ?? "", /uploads/);
  assert.match(next.question ?? "", /uploads/);
  assert.doesNotMatch(next.question ?? "", /\bit\b/i);
});

test("F: chatter between the question and the follow-up does not break the thread", () => {
  const thread = UPLOAD();
  const context = ["How does document upload work?", "Okay, makes sense.", "Give me one second."];
  for (const line of ["Okay, makes sense.", "Give me one second."]) {
    assert.equal(ask(line, context, thread).question, null, `should stay silent: ${line}`);
  }
  const next = ask("And what happens if it fails?", context, thread);
  assert.equal(shapeOf(next.question ?? ""), "failure");
  assert.match(next.question ?? "", /upload/i);
});

test("G: a new self-contained question reseeds what a later 'Why?' points at", () => {
  // The store replaces the thread whenever a question answers on its own, so a
  // later bare interrogative can only reach the newer topic.
  const excel = answered(
    "How does Excel export work?",
    "Generates Excel files in the required format.",
    ["services/excel_output_generator.py"],
    ["excel", "export"],
  );
  const next = ask("Why?", ["How does document upload work?", "How does Excel export work?"], excel);

  assert.match(next.question ?? "", /excel/i);
  assert.doesNotMatch(next.question ?? "", /upload/i);
});

test("'why is it done that way?' is a follow-up, not a question about ways", () => {
  // Straight from a real call: the pointer is doing all the work, and "way"
  // names no more of a subject than "thing" does.
  const thread = UPLOAD();
  const next = ask("Why is it done that way?", ["How does document upload work?"], thread);
  assert.equal(next.verdict, "follow-up");
  assert.equal(shapeOf(next.question ?? ""), "why");
  assert.match(next.question ?? "", /upload/i);

  // But a real question containing the same word is left alone.
  const own = ask("What's the fastest way to reload the extraction config?", [], thread);
  assert.equal(own.verdict, "question");
  assert.doesNotMatch(own.question ?? "", /upload/i);
});

test("an unanswered question leaves no thread behind", () => {
  const silentCard: Card = { say: null, citations: [], query: "", latencyMs: 0, source: "local" };
  const thread = threadFrom({
    utteranceId: "u1",
    canonical: "why did we choose this",
    shape: "why",
    subject: ["choose"],
    card: silentCard,
  });
  assert.equal(thread, null);
});

test("resolution never returns the previous question as the query", () => {
  const thread = UPLOAD();
  for (const q of ["And after that?", "Why?", "What about that?", "And then?"]) {
    const canonical = normalizeSpokenQuestion(q).canonical;
    const resolved = resolveReference(canonical, thread)?.question ?? "";
    assert.doesNotMatch(resolved, /how does document upload work/i, q);
  }
});
