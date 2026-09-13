import assert from "node:assert/strict";
import { test } from "node:test";

import { bindAccountId, LOCAL_DEV_ACCOUNT_ID } from "../../auth/account-boundary.ts";
import { NORTHSTAR } from "../../repo/northstar.ts";
import { routeSearchAnswer } from "../../search/answer-route.ts";
import { buildChunks, formatFlightRetrievalSummary, retrieve } from "../../search/retrieve.ts";
import {
  droppedRecords,
  exportFlightSession,
  flightRecords,
  flightSessionJson,
  noteDroppedUtterance,
  recordAnswerFlight,
  resetFlightSession,
  transcriptLanes,
} from "../flight-recorder.ts";

const memory = new Map<string, string>();

function enableFlightRecorder() {
  process.env.DEBUG_FLIGHT = "true";
}

function installStorage() {
  memory.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
      removeItem: (key: string) => {
        memory.delete(key);
      },
    },
  });
  bindAccountId(LOCAL_DEV_ACCOUNT_ID);
  resetFlightSession();
}

test("flight recorder is a no-op unless DEBUG_FLIGHT is set", () => {
  delete process.env.DEBUG_FLIGHT;
  installStorage();
  recordAnswerFlight({
    query: "ignored",
    transcript: { they: [], you: [] },
    gate: null,
    retrieval: "0 chunks | 0 excluded | 0 hits",
    tier: "silent",
    latency: { retrieveMs: 0, llmMs: 0, verifyMs: 0, totalMs: 0 },
    say: null,
    reason: "No matching material",
    citations: [],
    quotaRemaining: 20,
  });
  assert.equal(flightRecords().length, 0);
});

test("search answer round-trip records and exports parseable JSON", async () => {
  enableFlightRecorder();
  installStorage();

  const chunks = buildChunks(NORTHSTAR);
  const hits = retrieve("Why does that retry three times?", chunks);
  const body = hits.findIndex((hit) => /Attempts are capped at three/.test(hit.text));
  assert.ok(body >= 0);

  const routed = await routeSearchAnswer("Why does that retry three times?", hits, performance.now(), {
    pack: NORTHSTAR,
    retrieveMs: 12,
    ask: async () => ({
      text: `Attempts are capped at three because a fourth attempt duplicates the settlement file. [${body + 1}]`,
    }),
  });

  recordAnswerFlight({
    query: routed.card.query,
    transcript: transcriptLanes([
      { id: "1", at: Date.now(), speaker: "them", role: "them", text: "Why does that retry three times?" },
    ]),
    gate: { verdict: "question", question: routed.card.query, triggered: true },
    retrieval: formatFlightRetrievalSummary(chunks, hits),
    tier: routed.tier,
    latency: routed.latency,
    say: routed.card.say,
    reason: routed.card.reason ?? null,
    citations: routed.card.citations,
    quotaRemaining: 19,
  });

  assert.equal(flightRecords().length, 1);
  const exported = exportFlightSession();
  assert.ok(Array.isArray(exported.records));
  assert.equal(exported.records[0]?.tier, "grounded");
  assert.equal(exported.records[0]?.latency.retrieveMs, 12);
  assert.ok(exported.records[0]?.retrieval.includes("hits"));
  assert.equal(exported.records[0]?.transcript.they.length, 1);

  const parsed = JSON.parse(flightSessionJson(false)) as {
    exportedAt: number;
    records: Array<{ query: string; quotaRemaining: number }>;
  };
  assert.ok(parsed.exportedAt > 0);
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0]?.quotaRemaining, 19);

  resetFlightSession();
  assert.equal(flightRecords().length, 0);
});

test("dropped utterances append per-drop JSONL with tuning fields", () => {
  enableFlightRecorder();
  installStorage();

  noteDroppedUtterance({
    reason: "silero-low-prob",
    sileroProb: 0.18,
    durationMs: 2400,
    energy: 0.041,
  });

  assert.equal(droppedRecords().length, 1);
  const row = droppedRecords()[0]!;
  assert.equal(row.kind, "dropped");
  assert.equal(row.reason, "silero-low-prob");
  assert.equal(row.sileroProb, 0.18);
  assert.equal(row.durationMs, 2400);
  assert.equal(row.energy, 0.041);

  recordAnswerFlight({
    query: "test",
    transcript: { they: [], you: [] },
    gate: null,
    retrieval: "0 chunks | 0 excluded | 0 hits",
    tier: "silent",
    latency: { retrieveMs: 0, llmMs: 0, verifyMs: 0, totalMs: 0 },
    say: null,
    reason: null,
    citations: [],
    quotaRemaining: 20,
  });

  const answer = flightRecords().find((r) => r.kind === "answer");
  assert.ok(answer);
  assert.equal(answer?.droppedUtterances, 1);
});
