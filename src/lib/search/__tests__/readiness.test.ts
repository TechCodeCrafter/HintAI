import assert from "node:assert/strict";
import { test } from "node:test";

import { indexChipView, indexStatusView, indexWorking } from "../../context/index-status.ts";
import { emptyIndexSummary, type IndexSummary } from "../../context/index-summary.ts";
import {
  addKeepsSession,
  LEXICAL_ONLY_NOTE,
  listenGate,
  markLexicalOnly,
  pendingWarmth,
  searchModeFor,
  warmPhase,
  type SearchWarmth,
  type VectorWarmState,
} from "../readiness.ts";

function warmth(words: "pending" | "ready", vectors: VectorWarmState, have = 0, total = 400): SearchWarmth {
  return {
    words: { done: words === "ready" ? total : 120, total, ready: words === "ready" },
    vectors: { state: vectors, have, total: vectors === "off" ? 0 : total },
  };
}

const WARM = warmth("ready", "ready", 400);
const LEXICAL = warmth("ready", "lexical", 150);
const SUMMARY: IndexSummary = { ...emptyIndexSummary(), filesStored: 42, filesIndexed: 40, chunkCount: 400 };
const IDLE = { working: false, errored: false, activity: null, summary: SUMMARY, skipped: 2, failed: 0 } as const;

// ── The Listen gate: off until the chip reports Ready ──────────────────────

test("Listen is off while a load, a re-index or a PDF read is running", () => {
  for (const status of ["booting", "hydrating"]) {
    const working = indexWorking({ status, loadingFolder: false, contextUpdating: false });
    assert.equal(working, true, status);
    assert.equal(listenGate({ working, errored: false, searchable: true, warmth: WARM }).ready, false, status);
  }
  const flags = [
    { loadingFolder: true, contextUpdating: false },
    { loadingFolder: false, contextUpdating: true },
    { loadingFolder: false, contextUpdating: false, pdf: { phase: "reading" as const, current: 1, total: 2 } },
  ];
  for (const flag of flags) {
    const working = indexWorking({ status: "ready", ...flag });
    assert.equal(working, true);
    const gate = listenGate({ working, errored: false, searchable: true, warmth: WARM });
    assert.equal(gate.ready, false);
    assert.match(gate.reason ?? "", /Indexing is still running/);
  }
  assert.equal(indexWorking({ status: "ready", loadingFolder: false, contextUpdating: false }), false);
  // A PDF pass that has finished is not work in progress.
  assert.equal(
    indexWorking({
      status: "ready",
      loadingFolder: false,
      contextUpdating: false,
      pdf: { phase: "ready", current: 2, total: 2 },
    }),
    false,
  );
});

test("Listen is off after a failed load and when there is nothing to search", () => {
  const failed = listenGate({ working: false, errored: true, searchable: true, warmth: WARM });
  assert.equal(failed.ready, false);
  assert.match(failed.reason ?? "", /did not finish/);

  const empty = listenGate({ working: false, errored: false, searchable: false, warmth: pendingWarmth(0, false) });
  assert.equal(empty.ready, false);
  assert.match(empty.reason ?? "", /Nothing is indexed/);
});

test("Listen stays off while the word index is being built and while vectors are still expected in time", () => {
  const words = listenGate({ working: false, errored: false, searchable: true, warmth: warmth("pending", "warming") });
  assert.equal(words.ready, false);
  assert.match(words.reason ?? "", /Indexing words/);

  const vectors = listenGate({ working: false, errored: false, searchable: true, warmth: warmth("ready", "warming", 90) });
  assert.equal(vectors.ready, false);
  assert.match(vectors.reason ?? "", /Warming vectors/);

  // A fresh set of chunks starts with nothing warm, so the gate starts shut.
  assert.equal(
    listenGate({ working: false, errored: false, searchable: true, warmth: pendingWarmth(400, true) }).ready,
    false,
  );
});

test("Listen turns on when vectors are in memory, when there are none to wait for, and on the lexical path", () => {
  for (const state of [WARM, warmth("ready", "off"), LEXICAL]) {
    const gate = listenGate({ working: false, errored: false, searchable: true, warmth: state });
    assert.deepEqual(gate, { ready: true, reason: null }, state.vectors.state);
  }
});

test("the phases run words, then vectors, then ready, and an empty space has nothing to warm", () => {
  assert.equal(warmPhase(warmth("pending", "warming")), "words");
  assert.equal(warmPhase(warmth("pending", "ready", 400)), "words");
  assert.equal(warmPhase(warmth("ready", "warming")), "vectors");
  assert.equal(warmPhase(LEXICAL), "ready");
  assert.equal(warmPhase(WARM), "ready");
  assert.equal(warmPhase(pendingWarmth(0, true)), "ready");
  assert.equal(pendingWarmth(0, true).vectors.state, "off");
  assert.equal(pendingWarmth(400, false).vectors.state, "off");
  assert.equal(pendingWarmth(400, true).vectors.state, "warming");
});

// ── The chip says what Listen is waiting for ──────────────────────────────

test("the chip follows the warm-up after the load and reports Ready only when search is warm", () => {
  const words = indexChipView({ ...IDLE, warmth: warmth("pending", "warming") });
  assert.equal(words.state, "working");
  assert.equal(words.phase, "indexing");
  assert.equal(words.text, "Indexing words, 120 of 400 chunks…");
  assert.equal(words.ready, false);
  assert.equal(words.label, null);
  // The files and chunks are final by now, so the skipped list can be opened.
  assert.equal(words.settled, true);

  const vectors = indexChipView({ ...IDLE, warmth: warmth("ready", "warming", 90) });
  assert.equal(vectors.state, "working");
  assert.equal(vectors.phase, "warming");
  assert.equal(vectors.text, "Warming vectors, 90 of 400 chunks…");
  assert.equal(vectors.ready, false);

  const ready = indexChipView({ ...IDLE, warmth: WARM });
  assert.equal(ready.state, "ready");
  assert.equal(ready.phase, "ready");
  assert.equal(ready.ready, true);
  assert.equal(ready.label, "Ready");
  assert.equal(ready.detail, null);
  assert.equal(ready.text, "Indexed 40 files · 2 skipped · 400 chunks");

  // The warm-up lines never claim a skipped count either.
  assert.doesNotMatch(words.text + vectors.text, /skipped/);
});

test("on the lexical path the chip is Ready, and says the answers are word search for now", () => {
  const view = indexChipView({ ...IDLE, warmth: LEXICAL });
  assert.equal(view.state, "ready");
  assert.equal(view.ready, true);
  assert.equal(view.label, "Ready · word search");
  assert.match(view.detail ?? "", /150 of 400/);
  assert.match(view.detail ?? "", /word search until they finish/);
  assert.equal(view.text, "Indexed 40 files · 2 skipped · 400 chunks");
});

test("the chip's phases read Reading, Indexing, Warming vectors, Ready, in that order of a load", () => {
  const reading = indexChipView({
    ...IDLE,
    working: true,
    activity: { phase: "reading", done: 10, total: 42 },
    warmth: WARM,
  });
  const indexing = indexChipView({
    ...IDLE,
    working: true,
    activity: { phase: "indexing", done: 10, total: 42, chunks: 90 },
    warmth: WARM,
  });
  const opening = indexChipView({ ...IDLE, working: true, booting: true, warmth: WARM });
  assert.deepEqual(
    [opening.phase, reading.phase, indexing.phase],
    ["loading", "reading", "indexing"],
  );
  assert.match(reading.text, /^Reading /);
  assert.match(indexing.text, /^Indexing /);
  // A load in progress is never Ready, whatever was warm before it started.
  for (const view of [opening, reading, indexing]) {
    assert.equal(view.ready, false);
    assert.equal(view.label, null);
    assert.equal(view.settled, false);
  }
});

test("an empty or failed index is never Ready, and a chip given no warm-up report reads as before", () => {
  const empty = indexChipView({ ...IDLE, summary: emptyIndexSummary(), skipped: 0, warmth: pendingWarmth(0, false) });
  assert.equal(empty.state, "empty");
  assert.equal(empty.ready, false);
  const errored = indexChipView({ ...IDLE, errored: true, warmth: WARM });
  assert.equal(errored.state, "error");
  assert.equal(errored.ready, false);

  const plain = indexChipView(IDLE);
  assert.equal(plain.state, "ready");
  assert.equal(plain.ready, true);
  assert.equal(plain.label, "Ready");
});

test("the status line says Ready on the same terms as the chip", () => {
  const status = { working: false, errored: false, activity: null, summary: SUMMARY } as const;
  const vectors = indexStatusView({ ...status, warmth: warmth("ready", "warming", 100) });
  assert.equal(vectors.state, "working");
  assert.equal(vectors.text, "Warming vectors, 100 of 400 chunks…");
  assert.equal(vectors.fraction, 0.25);

  const words = indexStatusView({ ...status, warmth: warmth("pending", "warming") });
  assert.equal(words.state, "working");
  assert.equal(words.fraction, 0.3);

  const ready = indexStatusView({ ...status, warmth: WARM });
  assert.equal(ready.state, "ready");
  assert.match(ready.text, /Ready\.$/);

  const lexical = indexStatusView({ ...status, warmth: LEXICAL });
  assert.equal(lexical.state, "ready");
  assert.match(lexical.text, /Ready\. Vectors are still warming \(150 of 400\)/);
});

// ── Which channels the next question uses ─────────────────────────────────

test("a question is hybrid only once the vectors are ready, and lexical-only is said on the Card", () => {
  assert.deepEqual(searchModeFor(WARM), { semantic: true, lexicalOnly: false });
  assert.deepEqual(searchModeFor(LEXICAL), { semantic: false, lexicalOnly: true });
  // Asked from the search box while the chip still says "Warming vectors…".
  assert.deepEqual(searchModeFor(warmth("ready", "warming", 10)), { semantic: false, lexicalOnly: true });
  // No vectors to wait for (the demo pack, a device with no vector store):
  // searched as it always was, and nothing to remark on.
  assert.deepEqual(searchModeFor(warmth("ready", "off")), { semantic: true, lexicalOnly: false });
  assert.deepEqual(searchModeFor(null), { semantic: true, lexicalOnly: false });
});

test("the lexical mark is added to a Card that speaks and to one that is silent, and to no other", () => {
  type Answer = { say: string | null; reason?: string; citations: string[]; lexicalOnly?: boolean };
  const spoke: Answer = { say: "Three attempts.", citations: ["retry.ts:4"] };
  const silent: Answer = { say: null, reason: "No loaded file states this.", citations: [] };

  const marked = markLexicalOnly(spoke, searchModeFor(LEXICAL));
  assert.equal(marked.lexicalOnly, true);
  // Nothing about the answer itself changes: the same words, the same citations.
  assert.deepEqual({ ...marked, lexicalOnly: undefined }, { ...spoke, lexicalOnly: undefined });
  assert.equal(markLexicalOnly(silent, searchModeFor(LEXICAL)).lexicalOnly, true);
  assert.equal(markLexicalOnly(silent, searchModeFor(LEXICAL)).say, null);

  const hybrid = markLexicalOnly(spoke, searchModeFor(WARM));
  assert.equal(hybrid, spoke);
  assert.equal("lexicalOnly" in hybrid, false);
  assert.equal(LEXICAL_ONLY_NOTE, "Word search only");
});

// ── Adding files mid-session ──────────────────────────────────────────────

test("files added to the open, searchable space are indexed behind the session", () => {
  assert.equal(addKeepsSession({ sameSpace: true, status: "ready", sourceCount: 12 }), true);
  // Another space is a switch, and a space with nothing in it has no session to keep.
  assert.equal(addKeepsSession({ sameSpace: false, status: "ready", sourceCount: 12 }), false);
  assert.equal(addKeepsSession({ sameSpace: true, status: "ready", sourceCount: 0 }), false);
  assert.equal(addKeepsSession({ sameSpace: true, status: "hydrating", sourceCount: 12 }), false);
  assert.equal(addKeepsSession({ sameSpace: true, status: "error", sourceCount: 12 }), false);
});
