/**
 * DEDUPE EVENTS, NOT TEXT.
 *
 * The defect these tests close: the transcript compared incoming text against
 * the previous line and dropped a match, so the same question asked twice never
 * became a second event and the gate only ever saw one of them.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyHeard, newestFrom } from "./transcript-events.ts";
import { gateNewest } from "../search/question.ts";
import { buildChunks, packVocabulary } from "../search/retrieve.ts";
import type { RepoPack, Utterance } from "../repo/types.ts";

const PACK: RepoPack = {
  id: "repeat-fixture",
  name: "fixture",
  description: "excel export fixture",
  files: [
    {
      path: "services/excel_output_generator.py",
      language: "py",
      content: [
        '"""Generates Excel files in the required format for biocompatibility data."""',
        "def generate_excel(rows):",
        "    return workbook(rows)",
      ].join("\n"),
    },
  ],
  commits: [],
};
const gate = { vocab: packVocabulary(buildChunks(PACK)), threadOpen: false };
const ASK = "How does the Excel export work?";

function feed(events: Array<{ id: string; role: "them" | "you"; text: string }>) {
  let utterances: Utterance[] = [];
  const kinds: string[] = [];
  let at = 1000;
  for (const event of events) {
    at += 100;
    const outcome = applyHeard(utterances, event, at);
    utterances = outcome.utterances;
    kinds.push(outcome.kind);
  }
  return { utterances, kinds };
}

/**
 * Replays events the way the store does, so "reached the gate" means what it
 * means in the app: the newest line is the candidate, older lines are context.
 */
function gateRuns(events: Array<{ id: string; role: "them" | "you"; text: string }>) {
  let utterances: Utterance[] = [];
  const triggered: string[] = [];
  let at = 1000;
  let handledId: string | null = null;
  let handledQuestion: string | null = null;
  for (const event of events) {
    at += 100;
    const outcome = applyHeard(utterances, event, at);
    utterances = outcome.utterances;
    if (outcome.kind === "ignored" || outcome.kind === "empty") continue;
    if (event.role !== "them") continue;
    const newest = newestFrom(utterances);
    if (!newest || newest.id !== event.id) continue;
    const them = utterances.filter((u) => u.role === "them");
    const context = them.slice(-5, -1).map((u) => u.text);
    const threadOpen = Boolean(handledQuestion);
    const decision = gateNewest({ id: newest.id, text: newest.text }, context, { ...gate, threadOpen });
    const repeat = handledId === decision.candidateId && handledQuestion === decision.question;
    if (decision.question && !repeat) {
      triggered.push(decision.question);
      handledId = decision.candidateId;
      handledQuestion = decision.question;
    }
  }
  return { utterances, triggered };
}

test("A: the same event twice with the same text is one utterance, gated once", () => {
  const events = [
    { id: "computer-1", role: "them", text: ASK },
    { id: "computer-1", role: "them", text: ASK },
  ] as const;
  const { utterances, kinds } = feed([...events]);
  assert.equal(utterances.length, 1);
  assert.deepEqual(kinds, ["appended", "ignored"]);
  assert.equal(gateRuns([...events]).triggered.length, 1);
});

test("B: the same event re-decoded longer updates its own line", () => {
  const { utterances, kinds } = feed([
    { id: "computer-1", role: "them", text: "How does Excel export" },
    { id: "computer-1", role: "them", text: ASK },
  ]);
  assert.equal(utterances.length, 1);
  assert.deepEqual(kinds, ["appended", "rewritten"]);
  assert.equal(utterances[0].text, ASK);
  assert.equal(utterances[0].id, "computer-1");
});

test("B: a rewrite that is shorter is still the same event, not a new line", () => {
  const { utterances, kinds } = feed([
    { id: "computer-1", role: "them", text: "How does the Excel export work now?" },
    { id: "computer-1", role: "them", text: ASK },
  ]);
  assert.equal(utterances.length, 1);
  assert.deepEqual(kinds, ["appended", "rewritten"]);
  assert.equal(utterances[0].text, ASK);
});

test("C: two events with identical text are two utterances, gated twice", () => {
  const events = [
    { id: "computer-1", role: "them", text: ASK },
    { id: "computer-2", role: "them", text: ASK },
  ] as const;
  const { utterances, kinds } = feed([...events]);
  assert.equal(utterances.length, 2);
  assert.deepEqual(kinds, ["appended", "appended"]);
  assert.notEqual(utterances[0].id, utterances[1].id);

  const { triggered } = gateRuns([...events]);
  assert.equal(triggered.length, 2, "both asks deserve an answer");
  assert.equal(triggered[0], ASK);
  assert.equal(triggered[1], ASK);
});

test("D: two events of identical chatter are two utterances and no Cards", () => {
  const events = [
    { id: "computer-1", role: "them", text: "Can you hear me?" },
    { id: "computer-2", role: "them", text: "Can you hear me?" },
  ] as const;
  const { utterances } = feed([...events]);
  assert.equal(utterances.length, 2);
  assert.deepEqual(gateRuns([...events]).triggered, []);
});

test("E: the mic repeating a question never triggers automatically", () => {
  const events = [
    { id: "speech-1-0", role: "you", text: ASK },
    { id: "speech-1-1", role: "you", text: ASK },
  ] as const;
  const { utterances } = feed([...events]);
  assert.equal(utterances.length, 2);
  assert.equal(
    utterances.every((u) => u.role === "you"),
    true,
  );
  assert.deepEqual(gateRuns([...events]).triggered, []);
});

test("F: question, chatter, same question again gives Card, silence, Card", () => {
  const { triggered, utterances } = gateRuns([
    { id: "computer-1", role: "them", text: ASK },
    { id: "computer-2", role: "them", text: "Can you hear me?" },
    { id: "computer-3", role: "them", text: ASK },
  ]);
  assert.equal(utterances.length, 3);
  assert.deepEqual(triggered, [ASK, ASK]);
});

test("a late rewrite of an older event does not become the candidate", () => {
  const { utterances } = feed([
    { id: "computer-1", role: "them", text: "How does Excel export" },
    { id: "computer-2", role: "them", text: "Where does document upload happen?" },
    { id: "computer-1", role: "them", text: ASK },
  ]);
  assert.equal(utterances.length, 2);
  assert.equal(utterances[0].text, ASK, "the older line is corrected in place");
  assert.equal(newestFrom(utterances)?.id, "computer-2", "the newest line is unchanged");
});

test("identity survives interleaved lanes", () => {
  const { utterances } = feed([
    { id: "computer-1", role: "them", text: ASK },
    { id: "mic-1", role: "you", text: ASK },
    { id: "computer-2", role: "them", text: ASK },
  ]);
  assert.equal(utterances.length, 3);
  assert.deepEqual(
    utterances.map((u) => u.role),
    ["them", "you", "them"],
  );
});

test("empty and noise-only captions record nothing", () => {
  const { utterances, kinds } = feed([
    { id: "computer-1", role: "them", text: "[BLANK_AUDIO]" },
    { id: "computer-2", role: "them", text: "   " },
  ]);
  assert.equal(utterances.length, 0);
  assert.deepEqual(kinds, ["empty", "empty"]);
});
