/**
 * The gate in front of an automatic search.
 *
 * Three things have to be true before a line heard in the room opens a search:
 * it carries a "?" or has MIN_SPEECH_MS of speech behind it, it is a finished
 * question rather than a statement or a fragment, and it is about the loaded
 * material. A line that fails is logged with the reason.
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { createSpeechSpans } from "../../listen/speech-span.ts";
import type { RepoPack } from "../../repo/types.ts";
import { type GateRecord, gateRecords, recordGate, rejectedGateRecords, rejectionLine, resetGateRecords } from "../gate-log.ts";
import { shapeOf } from "../intent.ts";
import { type Gate, type GateDecision, MIN_SPEECH_MS, gateNewest, trailsOff } from "../question.ts";
import { buildChunks, packVocabulary } from "../retrieve.ts";
import { threadFrom } from "../thread.ts";

const PACK: RepoPack = {
  id: "question-gate-fixture",
  name: "fixture",
  description: "upload and export",
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
  ],
  commits: [],
};

const vocab = packVocabulary(buildChunks(PACK));
const THREAD = threadFrom({
  utteranceId: "prior",
  canonical: "How does document upload work?",
  shape: shapeOf("How does document upload work?"),
  subject: ["upload", "document"],
  card: {
    say: "Accepts a PDF and stores it before extraction runs.",
    citations: [{ kind: "file", path: "api/routers/documents.py", line: 1, label: "api/routers/documents.py:1" }],
    query: "How does document upload work?",
    latencyMs: 0,
    source: "local",
  },
});
const cold: Gate = { vocab, threadOpen: false };
const open: Gate = { vocab, threadOpen: true, thread: THREAD };
const PRIOR = ["How does document upload work?"];

let seq = 0;
/** A line as the listening path delivers it: the words and the speech behind them. */
function hear(text: string, speechMs: number | undefined, gate: Gate = cold, context: string[] = []): GateDecision {
  seq += 1;
  return gateNewest({ id: `q-${seq}`, text, speechMs }, context, gate);
}

afterEach(() => {
  resetGateRecords();
  delete process.env.DEBUG_SEARCH;
});

test("a line with no question mark needs 1.2 seconds of speech behind it", () => {
  assert.equal(MIN_SPEECH_MS, 1200);
  const line = "how does the document upload work";
  assert.equal(hear(line, 1199).verdict, "too-short");
  assert.equal(hear(line, 400).verdict, "too-short");
  const passed = hear(line, 1200);
  assert.equal(passed.verdict, "question");
  assert.equal(passed.question, line);
  assert.equal(passed.reason, null);
});

test("a question mark is explicit, so the length of the speech does not matter", () => {
  const decision = hear("How does the document upload work?", 300);
  assert.equal(decision.verdict, "question");
  assert.equal(decision.speechMs, 300);
});

test("speech that nothing measured counts as none", () => {
  const unmeasured = hear("how does the document upload work", undefined);
  assert.equal(unmeasured.verdict, "too-short");
  assert.match(unmeasured.reason ?? "", /not measured/);
  assert.equal(unmeasured.speechMs, undefined);
  assert.equal(hear("How does the document upload work?", undefined).verdict, "question");
});

test("the reason for a short line says how short it was", () => {
  const decision = hear("how does the document upload work", 640.4);
  assert.equal(decision.reason, "No question mark, and only 640 ms of speech (1200 ms needed).");
  assert.equal(decision.speechMs, 640);
});

test("a question mark on a greeting does not carry the line behind it", () => {
  // "Right?" is filler and comes off, leaving a short statement-length line with no "?".
  assert.equal(hear("Right? how does the document upload work", 500).verdict, "too-short");
});

test("a line that stops before the question is finished is not searched", () => {
  for (const line of [
    "What is the?",
    "How does the document upload and?",
    "So how does the document upload...",
    "Why does the upload retry because",
    "Where does the upload store the —",
    "How does the upload handle a?",
  ]) {
    const decision = hear(line, 2000);
    assert.equal(decision.verdict, "incomplete", line);
    assert.equal(decision.reason, "The line stops before the question is finished.");
  }
});

test("a finished question may end on a preposition, a pointer or a name", () => {
  assert.equal(trailsOff("What is the upload used for?"), false);
  assert.equal(trailsOff("Which file is the upload in?"), false);
  assert.equal(trailsOff("Should the upload go with option A?"), false);
  assert.equal(trailsOff("What does the upload do with that?"), false);
  assert.equal(hear("What is the document upload used for?", 300).verdict, "question");
});

test("a statement that opens with a question word is not a question", () => {
  for (const line of [
    "When we deployed the upload API it broke for a day",
    "What we need is a queue in front of the document upload",
    "How the upload works is not obvious from the router",
    "Which is why the upload stores the document first",
    "Which means the upload has to finish before extraction",
    "Where the document goes after upload depends on the session",
  ]) {
    const decision = hear(line, 3000);
    assert.equal(decision.verdict, "not-a-question", line);
    assert.equal(decision.reason, "Opens with a question word but is a statement.", line);
  }
});

test("a question word followed by a real question still asks", () => {
  for (const line of [
    "When you upload a document does the session change",
    "Which is the entry point for the document upload",
    "What handles the document upload",
    "Who owns the document upload",
    "When is the document stored after upload",
  ]) {
    assert.equal(hear(line, 2500).verdict, "question", line);
  }
  // With a question mark the speaker has said which it is.
  assert.equal(hear("What the upload does is store the document?", 2500).verdict, "question");
});

test("mentioning the architecture is not asking about it", () => {
  for (const line of [
    "I think the architecture is fine for the upload path",
    "The overview slide covers the document upload",
    "We restructured the upload last quarter",
  ]) {
    assert.equal(hear(line, 3000).verdict, "not-a-question", line);
  }
  for (const line of [
    "Give me an overview of the architecture",
    "I would love a high-level overview of the upload",
    "Walk me through the architecture",
  ]) {
    assert.equal(hear(line, 2500).verdict, "question", line);
  }
});

test("checking that the room is following is chatter, with or without an answer on screen", () => {
  for (const gate of [cold, open]) {
    for (const line of [
      "Does that make sense?",
      "Make sense?",
      "What do you think?",
      "What do you all think about that?",
      "Is that right?",
      "Does that sound reasonable?",
      "Any thoughts?",
      "Do you agree?",
      "You know what I mean?",
      "Does that answer your question?",
    ]) {
      const decision = hear(line, 900, gate, PRIOR);
      assert.equal(decision.verdict, "chatter", line);
      assert.equal(decision.reason, "Talk about the meeting, not about the material.");
    }
  }
});

test("a comprehension check in front of a real question comes off and the question is kept", () => {
  const decision = hear("Does that make sense? How does the document upload work?", 3000);
  assert.equal(decision.verdict, "question");
  assert.equal(decision.question, "How does the document upload work?");
  // And one with a tail of its own is judged on the tail.
  assert.equal(hear("Does that make sense given how the upload stores the document?", 3000).verdict, "question");
});

test("asking the presenter to drive the screen is chatter", () => {
  for (const line of [
    "Can you scroll down to the upload handler?",
    "Could you zoom in on the document router?",
    "Can you go back a slide?",
    "Could you share your screen?",
  ]) {
    assert.equal(hear(line, 1500).verdict, "chatter", line);
  }
  // Asking to see the material is still a question about it.
  assert.equal(hear("Can you show me where the document upload is handled?", 1500).verdict, "question");
});

test("an answer on screen does not turn every question in the room into a follow-up", () => {
  for (const line of [
    "Who wants to go first?",
    "Should we order lunch before the next one?",
    "What are you doing this weekend?",
    "Can we do Tuesday instead?",
    "Is that okay with everyone?",
    "What is this meeting actually for?",
    "How do you all feel about that plan?",
  ]) {
    const decision = hear(line, 1500, open, PRIOR);
    assert.equal(decision.verdict, "not-a-question", line);
    assert.equal(decision.reason, "A question, but not about the loaded material.", line);
  }
});

test("an answer on screen still carries a follow-up that points at it or asks beside it", () => {
  const pointer = hear("Where is that stored?", 900, open, PRIOR);
  assert.equal(pointer.verdict, "follow-up");
  assert.match(pointer.question ?? "", /upload/);

  const beside = hear("What about the error handling?", 900, open, PRIOR);
  assert.equal(beside.verdict, "question");
  assert.equal(beside.question, "What about the error handling?");
  // Without the answer on screen there is nothing for it to sit beside.
  assert.equal(hear("What about the lunch order?", 900, cold).verdict, "not-a-question");

  // Names a thing of its own and still leans on the answer.
  assert.equal(hear("And why that number?", 900, open, PRIOR).verdict, "question");
  assert.equal(hear("And why that number?", 900, cold).verdict, "not-a-question");

  const bare = hear("Why?", 300, open, PRIOR);
  assert.equal(bare.verdict, "follow-up");
  // The same word with no question mark is a short noise, not a follow-up.
  assert.equal(hear("why", 300, open, PRIOR).verdict, "too-short");
});

test("every line that is turned away carries a reason, and every line that passes carries none", () => {
  const lines: Array<[string, number | undefined, Gate]> = [
    ["", 2000, cold],
    ["Can you hear me?", 2000, cold],
    ["how does the upload work", 300, cold],
    ["What is the?", 2000, cold],
    ["When we deployed the upload it broke", 2000, cold],
    ["What is for lunch today?", 2000, cold],
    ["Why?", 300, cold],
    ["How does this service work?", 900, cold],
    ["How does the document upload work?", 900, cold],
    ["Where is that stored?", 900, open],
  ];
  const seen = new Set<string>();
  for (const [text, speechMs, gate] of lines) {
    const decision = hear(text, speechMs, gate, gate === open ? PRIOR : []);
    seen.add(decision.verdict);
    if (decision.question) assert.equal(decision.reason, null, text);
    else assert.ok(decision.reason && decision.reason.length > 10, `${decision.verdict} has no reason: ${text}`);
  }
  assert.deepEqual(
    [...seen].sort(),
    ["chatter", "empty", "follow-up", "incomplete", "not-a-question", "orphan-follow-up", "question", "too-short", "unresolved-reference"],
  );
});

function record(decision: GateDecision, triggered: boolean): GateRecord {
  return { ...decision, at: 1, lastHandledId: null, dedupe: "fresh", triggered };
}

test("the gate log keeps each rejected line with its verdict and reason", () => {
  recordGate(record(hear("how does the upload work", 500), false));
  recordGate(record(hear("How does the document upload work?", 900), true));
  recordGate(record(hear("What is the?", 2000), false));
  assert.equal(gateRecords().length, 3);
  assert.deepEqual(
    rejectedGateRecords().map((item) => [item.candidate, item.verdict, item.reason, item.speechMs]),
    [
      ["how does the upload work", "too-short", "No question mark, and only 500 ms of speech (1200 ms needed).", 500],
      ["What is the?", "incomplete", "The line stops before the question is finished.", 2000],
    ],
  );
});

test("a line that passed the gate and was not searched is not listed as rejected", () => {
  const passed = hear("How does the document upload work?", 900);
  recordGate({ ...record(passed, false), dedupe: "auto-answer-off" });
  assert.deepEqual(rejectedGateRecords(), []);
});

test("the gate log is bounded", () => {
  for (let i = 0; i < 75; i += 1) recordGate(record(hear("how does the upload work", i), false));
  assert.equal(gateRecords().length, 60);
  assert.equal(gateRecords()[0].speechMs, 15);
});

test("a rejection is printed only when search debugging is on", () => {
  const printed: string[] = [];
  const original = console.info;
  console.info = (...args: unknown[]) => void printed.push(args.join(" "));
  try {
    const rejected = record(hear("how does the upload work", 500), false);
    recordGate(rejected);
    assert.deepEqual(printed, []);
    process.env.DEBUG_SEARCH = "true";
    recordGate(rejected);
    recordGate(record(hear("How does the document upload work?", 900), true));
    assert.deepEqual(printed, [
      '[gate] rejected (too-short) after 500 ms of speech: "how does the upload work". No question mark, and only 500 ms of speech (1200 ms needed).',
    ]);
    assert.equal(rejectionLine(rejected), printed[0]);
  } finally {
    console.info = original;
  }
});

test("browser speech recognition is timed from the first interim to the last change", () => {
  const spans = createSpeechSpans();
  spans.note("1-0", "how", 1000);
  spans.note("1-0", "how does", 1400);
  spans.note("1-0", "how does the upload work", 2300);
  // The recognizer repeats the same words while it waits out the pause.
  spans.note("1-0", "how does the upload work", 3100);
  assert.equal(spans.take("1-0"), 1300);
  // Taken once: the next result under the same key starts again.
  assert.equal(spans.take("1-0"), 0);
});

test("a final result with no interim before it has no measured speech", () => {
  const spans = createSpeechSpans();
  assert.equal(spans.take("1-4"), 0);
  spans.note("1-5", "upload", 500);
  assert.equal(spans.take("1-5"), 0);
  spans.note("2-0", "a", 10);
  spans.clear();
  assert.equal(spans.take("2-0"), 0);
});
