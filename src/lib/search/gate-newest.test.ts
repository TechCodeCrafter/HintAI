/**
 * The invariant: an automatic Card is caused by the NEWEST eligible utterance.
 *
 * Older utterances may help interpret it. They may never resurrect a question
 * that has already been answered — the failure these tests exist to prevent is
 * chatter re-firing the previous question because it was still in the window.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { shapeOf } from "./intent.ts";
import { gateNewest, type Gate } from "./question.ts";
import { buildChunks, packVocabulary } from "./retrieve.ts";
import { threadFrom } from "./thread.ts";
import type { RepoPack } from "../repo/types.ts";

const PACK: RepoPack = {
  id: "gate-newest-fixture",
  name: "rdb-shaped fixture",
  description: "upload, extraction and export, shaped like the real pack",
  files: [
    {
      path: "api/routers/documents.py",
      language: "py",
      content: [
        '"""Document upload. Accepts a PDF and stores it before extraction runs."""',
        "async def upload_document(session_id: str, file: UploadFile):",
        "    return await store(session_id, file)",
      ].join("\n"),
    },
    {
      path: "services/excel_output_generator.py",
      language: "py",
      content: [
        '"""Generates Excel files in the required format for biocompatibility data."""',
        "def generate_excel(rows):",
        "    return workbook(rows)",
      ].join("\n"),
    },
    {
      path: "container-lambdas/extract-worker/app/worker.py",
      language: "py",
      content: [
        '"""Extraction worker. Runs in a container lambda because the model is large."""',
        "def handler(event, context):",
        "    return extract(event)",
      ].join("\n"),
    },
  ],
  commits: [],
};

const vocab = packVocabulary(buildChunks(PACK));

/**
 * A thread is what the last answered question left behind. The gate needs it to
 * read a follow-up: without one, a pointer has nothing to point at.
 */
function threadOn(question: string, claim: string, path: string, subject: string[]) {
  return threadFrom({
    utteranceId: "prior",
    canonical: question,
    shape: shapeOf(question),
    subject,
    card: {
      say: claim,
      citations: [{ path, line: 1, label: `${path}:1` }],
      query: question,
      latencyMs: 0,
      source: "local",
    },
  });
}

const UPLOAD = threadOn(
  "How does document upload work?",
  "Accepts a PDF and stores it before extraction runs.",
  "api/routers/documents.py",
  ["upload", "document"],
);
const open = { vocab, threadOpen: true, thread: UPLOAD };
const cold = { vocab, threadOpen: false };

let seq = 0;
function ask(text: string, context: string[] = [], gate: Gate = open) {
  seq += 1;
  return gateNewest({ id: `u-${seq}`, text }, context, gate);
}

const CHATTER = [
  "Can you hear me?",
  "Should we move on?",
  "Are we good on time?",
  "Any questions?",
  "Can everyone see my screen?",
  "Sorry, can you repeat that?",
];

/**
 * Social framing wrapped around a real question. Every one of these was silenced
 * as chatter while the chatter list was tested as a substring: "how are you"
 * matched inside "how are you handling retries", and a "thanks for that" prefix
 * killed the question behind it. The gate is the first layer, so nothing
 * downstream could recover any of them.
 */
const BLENDED = [
  "How are you handling retries on the ingest worker?",
  "How are you storing the uploaded document?",
  "What's up with the retry logic in the ingest worker?",
  "Thanks for that — why is the extraction done in a container lambda?",
  "Thank you — how does the retry logic work?",
  "Sorry, what does the ingest worker do?",
  "Good morning — where is upload handled?",
  "We good on the schema migration?",
  "All good with the deploy pipeline?",
  "Hi there — how does the Excel export work?",
];

test("a politeness prefix does not silence the question behind it", () => {
  for (const line of BLENDED) {
    const decision = ask(line, [], cold);
    assert.notEqual(decision.verdict, "chatter", `should not read as chatter: ${line}`);
    assert.ok(decision.question, `should ask something: ${line}`);
  }
});

test("the question kept is the ask, not the greeting in front of it", () => {
  const decision = ask("Thanks for that — why is the extraction done in a container lambda?", [], cold);
  assert.equal(decision.verdict, "question");
  assert.doesNotMatch(decision.question ?? "", /thanks/i);
  assert.match(decision.question ?? "", /extraction/i);
});

test("social framing on its own is still chatter", () => {
  const framing = [
    "How are you?",
    "How are you doing?",
    "What's up?",
    "Thanks for that.",
    "Thank you for the walkthrough.",
    "Good morning everyone.",
    "Hi there.",
    "Nice to meet you all.",
    "Sorry, what?",
    "We good?",
    "All good on time?",
  ];
  for (const line of framing) {
    assert.equal(ask(line, [], cold).verdict, "chatter", `should read as chatter: ${line}`);
  }
});

test("sequence A: chatter after an answered question stays silent", () => {
  const asked = "How does document upload work?";
  const first = ask(asked, [], cold);
  assert.equal(first.verdict, "question");
  assert.equal(first.question, asked);

  // The answered question is still sitting in the context window. That must not
  // be enough to fire again, whatever the newest utterance is.
  for (const line of CHATTER) {
    const next = ask(line, [asked]);
    assert.equal(next.question, null, `should stay silent after chatter: ${line}`);
    assert.equal(next.verdict, "chatter", `should read as chatter: ${line}`);
  }
});

test("sequence A: a long tail of chatter never resurrects the question", () => {
  const asked = "How does document upload work?";
  const context = [asked, ...CHATTER];
  for (const line of CHATTER) {
    assert.equal(ask(line, context).question, null, `should stay silent: ${line}`);
  }
});

test("sequence B: a follow-up takes the thread's subject, never its question", () => {
  const prior = "How does document upload work?";
  const next = ask("What happens after that?", [prior]);
  assert.equal(next.verdict, "follow-up");
  assert.equal(next.usedContext, true);
  assert.ok(next.question?.includes("upload"), next.question ?? "silent");
  // Pasting the prior question in is what let the composer answer it twice.
  assert.doesNotMatch(next.question ?? "", /how does document upload work/i);
});

test("sequence C: a bare interrogative is a real follow-up", () => {
  const prior = "Why is extraction handled in the worker?";
  const thread = threadOn(
    prior,
    "Runs in a container lambda because the model is large.",
    "container-lambdas/extract-worker/app/worker.py",
    ["extraction", "worker"],
  );
  const next = ask("Why?", [prior], { vocab, threadOpen: true, thread });
  assert.equal(next.verdict, "follow-up");
  assert.equal(next.usedContext, true);
  assert.ok(next.question?.includes("extraction"), next.question ?? "silent");
  assert.doesNotMatch(next.question ?? "", /why is extraction handled in the worker/i);
});

test("a bare interrogative with no open thread is silent", () => {
  assert.equal(ask("Why?", ["Why is extraction handled in the worker?"], cold).verdict, "orphan-follow-up");
  assert.equal(ask("Why?", [], open).verdict, "orphan-follow-up");
});

test("acknowledgements are not follow-ups", () => {
  for (const line of ["Yeah.", "Right.", "Makes sense.", "Got it.", "Sure, thanks."]) {
    assert.equal(ask(line, ["How does document upload work?"]).question, null, `should stay silent: ${line}`);
  }
});

test("a self-contained question is not dragged toward the previous topic", () => {
  const next = ask("How is the Excel export generated?", ["How does document upload work?"]);
  assert.equal(next.verdict, "question");
  assert.equal(next.usedContext, false);
  assert.equal(next.question, "How is the Excel export generated?");
  assert.ok(!next.question?.includes("upload"));
});

test("every question shape from the real-call matrix still fires", () => {
  const shapes = [
    "What does the extraction worker do?",
    "How does the Excel export work?",
    "Where does document upload happen?",
    "Why is the extraction done in a container lambda?",
  ];
  for (const line of shapes) {
    const got = ask(line, [], cold);
    assert.equal(got.verdict, "question", `should fire: ${line}`);
    assert.equal(got.question, line);
  }
});

test("context is reported on every decision, so a silent room is explainable", () => {
  const got = ask("Can you hear me?", ["How does document upload work?"]);
  assert.deepEqual(got.context, ["How does document upload work?"]);
  assert.equal(got.candidate, "Can you hear me?");
  assert.ok(got.candidateId);
});
