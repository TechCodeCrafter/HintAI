import assert from "node:assert/strict";
import { test } from "node:test";

import { inferProductStateFromReason, productStateForSilence } from "../../product-states.ts";
import { NORTHSTAR } from "../../repo/northstar.ts";
import type { Card, Hit } from "../../repo/types.ts";
import { isFileHit } from "../../repo/types.ts";
import { FAST_PATH_MIN_SCORE, failFastCause, shouldFailFastRetrieval } from "../answer-fast-path.ts";
import { UNRECORDED_SILENCE_REASON, cardFromHistory, historyItemFromCard } from "../answer-history.ts";
import { routeSearchAnswer } from "../answer-route.ts";
import { localCard } from "../local-card.ts";
import { buildChunks, retrieve } from "../retrieve.ts";
import {
  SILENCE,
  type SilenceKind,
  explainSilence,
  searchFailureSilence,
  transportSilence,
  unknownTerms,
} from "../silence.ts";

const chunks = buildChunks(NORTHSTAR);
const insufficient = async () => ({ text: "INSUFFICIENT" });
const failing = (reason: string) => async () => ({ text: null, reason });

/** The strings the product used to show when it had nothing better to say. */
const RETIRED = [
  "No matching material",
  "Your material doesn't cover this",
  "Nothing in this pack cites that.",
  "Found the file, but nothing in it I would say out loud.",
  "No evidence I could point at for that.",
  "Nothing loaded answers that.",
  "No cited answer.",
];

function assertReadable(reason: string | undefined, label: string) {
  assert.ok(reason && reason.trim().length > 0, `${label}: silent with no reason`);
  assert.ok(!RETIRED.includes(reason), `${label}: retired generic reason "${reason}"`);
  assert.doesNotMatch(reason, /[—–]/, `${label}: dash in "${reason}"`);
  assert.match(reason, /[.]$/, `${label}: not a sentence: "${reason}"`);
  assert.doesNotMatch(reason, /Error:|undefined|\bnull\b|\[object/, `${label}: leaked internals: "${reason}"`);
}

function assertSilent(card: Card, label: string) {
  assert.equal(card.say, null, `${label}: spoke`);
  assert.ok(card.silence, `${label}: silent with no kind`);
  assertReadable(card.reason, label);
}

test("every fixed reason is a plain sentence", () => {
  for (const [name, why] of Object.entries(SILENCE)) assertReadable(why.reason, name);
  assert.equal(SILENCE.noMatch.reason, "Nothing in your files covers this.");
  assert.match(SILENCE.weakMatch.reason, /^Only weak matches found\./);
});

test("explainSilence names one cause, most actionable first", () => {
  // Nothing indexed is not "nothing covers this": there was nothing to search.
  assert.equal(explainSilence({ hitCount: 0, indexedChunks: 0, failFast: "no-hits" }), SILENCE.nothingIndexed);
  assert.equal(explainSilence({ hitCount: 0, indexedChunks: 40, failFast: "no-hits" }), SILENCE.noMatch);
  assert.equal(explainSilence({ hitCount: 0 }), SILENCE.noMatch);
  assert.equal(explainSilence({ hitCount: 3, failFast: "weak" }), SILENCE.weakMatch);
  assert.equal(explainSilence({ hitCount: 3, failFast: "off-topic" }), SILENCE.offTopic);

  const composer = { reason: "The material says what this does, not why it was chosen.", silence: "not-stated" as const };

  // The model never completed: the files were not fully checked, so the
  // composer's verdict is not the whole story and the fix is on the model side.
  const unreachable = explainSilence({ hitCount: 3, modelError: "timeout", local: composer });
  assert.equal(unreachable.kind, "transport");

  // The model read the hits and declined. A stray error from another stage is
  // no longer why the room hears nothing.
  const declined = explainSilence({ hitCount: 3, modelError: "timeout", modelDeclined: true, local: composer });
  assert.deepEqual(declined, { kind: "not-stated", reason: composer.reason });

  // A composer reason with no kind is still reported, never dropped.
  assert.deepEqual(explainSilence({ hitCount: 3, local: { reason: "Nothing in this material says what it does." } }), {
    kind: "not-stated",
    reason: "Nothing in this material says what it does.",
  });

  // No composer, no error: still a specific sentence, never empty.
  assert.equal(explainSilence({ hitCount: 3, modelDeclined: true }), SILENCE.notStated);
  assert.equal(explainSilence({ hitCount: 3, local: { reason: "   " } }), SILENCE.notStated);
});

test("a model failure reads as a sentence, never a raw token", () => {
  const cases: Array<[string, RegExp]> = [
    ["Add API key", /^No API key is set/],
    ["OpenAI rejected the API key", /^OpenAI rejected the API key\. Check the key/],
    ["Anthropic rate limit, try again in a moment", /^Anthropic rate limit reached\./],
    ["timeout", /did not respond in time/],
    ["Failed to fetch", /could not be reached/],
    ["xAI 503", /^xAI returned an error \(503\)\./],
    ["empty", /response from the model was empty/],
    ["empty stream", /response from the model was empty/],
    ["empty prompt", /question was empty/],
    ["socket hang up", /^The model call failed \(socket hang up\)\. Ask again\.$/],
    ["", /^The model call failed\. Ask again\.$/],
  ];
  for (const [raw, expected] of cases) {
    const why = transportSilence(raw);
    assert.equal(why.kind, "transport", raw);
    assert.match(why.reason, expected, raw);
    assertReadable(why.reason, `transport "${raw}"`);
  }
  // The key dialog is offered on this phrase; a timeout must not trigger it.
  assert.match(transportSilence("Add API key").reason, /api key/i);
  assert.doesNotMatch(transportSilence("timeout").reason, /api key/i);
  // An unknown message is capped, so a provider error body cannot fill the pane.
  assert.ok(transportSilence("x".repeat(500)).reason.length < 130);
});

test("a search that throws is reported as an index failure, not as missing material", () => {
  const thrown = searchFailureSilence(new Error("IDBDatabase connection is closing"));
  assert.equal(thrown.kind, "index");
  assert.match(thrown.reason, /^Search failed before your files could be checked \(IDBDatabase connection is closing\)\./);
  assertReadable(thrown.reason, "thrown");

  const scope = Object.assign(new Error("space ws_a/sp_1 is not in workspace ws_b"), { code: "workspace-scope" });
  const blocked = searchFailureSilence(scope);
  assert.equal(blocked.kind, "index");
  // The identifiers in the error stay out of the pane.
  assert.doesNotMatch(blocked.reason, /ws_a|ws_b|sp_1/);
  assertReadable(blocked.reason, "scope");

  assertReadable(searchFailureSilence(undefined).reason, "unknown throw");
});

test("fail-fast reports why retrieval could not support an answer", () => {
  const weak = [{ path: "a.ts", text: "unrelated text", score: 1 } as Hit];
  assert.equal(failFastCause("How do refunds settle?", []), "no-hits");
  assert.equal(failFastCause("How do refunds settle?", weak), "weak");
  assert.equal(failFastCause("What is the weather in Boston?", weak), "off-topic");
  assert.equal(failFastCause("How do refunds settle?", [{ ...weak[0], score: FAST_PATH_MIN_SCORE } as Hit]), null);
  for (const [query, hits] of [["How do refunds settle?", []], ["How do refunds settle?", weak]] as const) {
    assert.equal(shouldFailFastRetrieval(query, [...hits]), failFastCause(query, [...hits]) !== null);
  }
});

test("routing: no hits, weak hits, and an empty index are three different reasons", async () => {
  let asks = 0;
  const counting = async () => {
    asks += 1;
    return { text: "INSUFFICIENT" };
  };

  const none = await routeSearchAnswer("How do refunds settle?", [], 0, { ask: counting, indexedChunks: 120 });
  assert.equal(none.card.reason, "Nothing in your files covers this.");
  assert.equal(none.card.silence, "no-match");

  const weak = await routeSearchAnswer(
    "How do refunds settle?",
    [{ path: "a.ts", text: "unrelated text", score: 1 } as Hit],
    0,
    { ask: counting, indexedChunks: 120 },
  );
  assert.match(weak.card.reason ?? "", /^Only weak matches found\./);
  assert.equal(weak.card.silence, "weak-match");

  const empty = await routeSearchAnswer("How do refunds settle?", [], 0, { ask: counting, indexedChunks: 0 });
  assert.equal(empty.card.reason, SILENCE.nothingIndexed.reason);
  assert.equal(empty.card.silence, "index");

  for (const routed of [none, weak, empty]) {
    assertSilent(routed.card, "fail-fast");
    assert.equal(routed.tier, "silent");
    assert.equal(routed.consumeQuota, false);
  }
  // None of these reached a model: silence was decided from retrieval alone.
  assert.equal(asks, 0);
});

test("routing: the composer's reason survives when the model declines", async () => {
  // Retrieval ranks the export files; neither the model nor the composer finds
  // a sentence that states it. The old route flattened this to "Your material
  // doesn't cover this".
  const hits = retrieve("Do we store card numbers in the export?", chunks);
  const routed = await routeSearchAnswer("Do we store card numbers in the export?", hits, 0, {
    pack: NORTHSTAR,
    ask: insufficient,
  });
  assertSilent(routed.card, "declined");
  assert.equal(routed.card.silence, "not-stated");
  assert.equal(routed.card.reason, localCard("Do we store card numbers in the export?", hits, NORTHSTAR, 0).reason);
});

test("routing: an unreachable model is the reason, whatever the composer thought", async () => {
  const hits = retrieve("Why does that retry three times?", chunks)
    .filter(isFileHit)
    .map((hit, index) => (index === 0 ? { ...hit, score: FAST_PATH_MIN_SCORE - 1 } : hit));
  for (const raw of ["Add API key", "timeout", "OpenAI 500", "OpenAI rate limit, try again in a moment", "empty"]) {
    const routed = await routeSearchAnswer("Why does that retry three times?", hits, 0, {
      pack: NORTHSTAR,
      ask: failing(raw),
    });
    assertSilent(routed.card, raw);
    assert.equal(routed.card.silence, "transport", raw);
    assert.equal(routed.card.reason, transportSilence(raw).reason, raw);
    assert.equal(routed.consumeQuota, false, raw);
  }
});

test("routing: a model that declined outranks a later transport error", async () => {
  const hits = retrieve("Do we store card numbers in the export?", chunks);
  const routed = await routeSearchAnswer("Do we store card numbers in the export?", hits, 0, {
    pack: NORTHSTAR,
    // Grounded reads the hits and declines; synthesis then times out.
    ask: async (payload) => (payload.policy === "extract" ? { text: "INSUFFICIENT" } : { text: null, reason: "timeout" }),
  });
  assertSilent(routed.card, "declined then timeout");
  assert.equal(routed.card.silence, "not-stated");
});

const QUESTIONS = [
  "When is the next board meeting?",
  "Who owns the export worker?",
  "Why did we choose Postgres?",
  "What happens when the kubernetes operator crashes?",
  "Is there a GraphQL gateway?",
  "How does the quarterly bonus plan work?",
  "What is the weather in Tokyo?",
  "Who is a full stack developer?",
  "Do we store card numbers in the export?",
  "What does the scanned PDF say about isolation?",
  "",
];

test("the composer never goes silent without a readable reason and a kind", () => {
  const seen = new Set<SilenceKind>();
  for (const question of QUESTIONS) {
    const card = localCard(question, retrieve(question, chunks), NORTHSTAR, 0);
    if (card.say) continue;
    assertSilent(card, `local "${question}"`);
    if (card.silence) seen.add(card.silence);
  }
  // The fixture exercises the distinctions the room is meant to read.
  for (const kind of ["no-match", "weak-match", "not-stated"] as const) {
    assert.ok(seen.has(kind), `no question produced "${kind}"`);
  }
});

test("the composer tells no hits from weak hits, and names what it could not find", () => {
  const none = localCard("How does the quarterly bonus plan work?", [], NORTHSTAR, 0);
  assert.equal(none.reason, "Nothing in your files covers this.");
  assert.equal(none.silence, "no-match");

  const weakHits = retrieve("How does the quarterly bonus plan work?", chunks);
  assert.ok(weakHits.length > 0 && (weakHits[0]?.score ?? 0) < FAST_PATH_MIN_SCORE);
  const weak = localCard("How does the quarterly bonus plan work?", weakHits, NORTHSTAR, 0);
  assert.match(weak.reason ?? "", /^Only weak matches found\./);
  assert.equal(weak.silence, "weak-match");

  const question = "What happens when the kubernetes operator crashes?";
  const stranger = localCard(question, retrieve(question, chunks), NORTHSTAR, 0);
  assert.equal(stranger.silence, "no-match");
  assert.match(stranger.reason ?? "", /^Nothing in your files covers this\. I could not find "kubernetes"/);
  // The claim is checkable: the named word really is absent from the pack.
  assert.ok(!NORTHSTAR.files.some((file) => /kubernetes/i.test(file.content)));

  assert.equal(unknownTerms([]), SILENCE.noMatch);
  assert.match(unknownTerms(["a", "b", "c", "d", "e"]).reason, /"a", "b", "c" in the files/);
});

test("the route never goes silent without a readable reason and a kind", async () => {
  for (const question of QUESTIONS) {
    const hits = retrieve(question, chunks);
    for (const ask of [insufficient, failing("timeout"), failing("OpenAI 500"), async () => ({ text: null })]) {
      const routed = await routeSearchAnswer(question, hits, 0, {
        pack: NORTHSTAR,
        ask,
        indexedChunks: chunks.length,
      });
      if (routed.card.say) {
        // Cite-or-silence is untouched: whatever is spoken is cited.
        assert.ok(routed.card.citations.length > 0, `"${question}" spoke without a citation`);
        assert.equal(routed.card.silence, undefined);
        continue;
      }
      assertSilent(routed.card, `route "${question}"`);
      assert.equal(routed.tier, "silent");
      assert.equal(routed.consumeQuota, false);
    }
  }
});

test("the banner above a silent card follows the cause, not the wording", () => {
  const timeout = transportSilence("timeout");
  // This is the case the text sniffer got wrong: it called a timeout
  // "your loaded material does not support a confident answer".
  assert.equal(inferProductStateFromReason(timeout.reason), null);
  assert.equal(productStateForSilence({ reason: timeout.reason, silence: timeout.kind }).code, "provider-failure");

  const key = transportSilence("Add API key");
  assert.equal(productStateForSilence({ reason: key.reason, silence: key.kind }).code, "missing-api-key");
  assert.equal(
    productStateForSilence({ reason: SILENCE.stale.reason, silence: SILENCE.stale.kind }).code,
    "index-unavailable",
  );
  for (const why of [SILENCE.noMatch, SILENCE.weakMatch, SILENCE.notStated, SILENCE.unsupported, SILENCE.whichDocument]) {
    assert.equal(productStateForSilence({ reason: why.reason, silence: why.kind }).code, "unsupported-answer");
  }
  // Cards with no kind (store-level states, old history) keep the text fallback.
  assert.equal(productStateForSilence({ reason: "Add an OpenAI API key to continue" }).code, "missing-api-key");
  assert.equal(productStateForSilence({ reason: "anything else" }).code, "unsupported-answer");
});

test("a silent answer keeps its reason in history", () => {
  const silentCard: Card = {
    say: null,
    reason: SILENCE.weakMatch.reason,
    silence: SILENCE.weakMatch.kind,
    citations: [],
    query: "How does the quarterly bonus plan work?",
    latencyMs: 12,
    source: "local",
  };
  const restored = cardFromHistory(historyItemFromCard(silentCard));
  assert.equal(restored.say, null);
  assert.equal(restored.reason, SILENCE.weakMatch.reason);
  assert.equal(restored.silence, "weak-match");

  // An item saved before reasons were recorded says so, rather than guessing one.
  const legacy = { ...historyItemFromCard(silentCard), reason: undefined, silence: undefined };
  assert.equal(cardFromHistory(legacy).reason, UNRECORDED_SILENCE_REASON);

  // A spoken answer never carries a silence.
  const spoken = historyItemFromCard({ ...silentCard, say: "Three attempts.", reason: undefined, silence: undefined });
  assert.equal(spoken.reason, undefined);
  assert.equal(cardFromHistory(spoken).reason, undefined);
});
