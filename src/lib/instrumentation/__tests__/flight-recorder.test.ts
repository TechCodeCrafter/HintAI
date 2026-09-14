import assert from "node:assert/strict";
import { test } from "node:test";

import { bindAccountId, LOCAL_DEV_ACCOUNT_ID } from "../../auth/account-boundary.ts";
import { NORTHSTAR } from "../../repo/northstar.ts";
import { routeSearchAnswer } from "../../search/answer-route.ts";
import { buildChunks, formatFlightRetrievalSummary, retrieve } from "../../search/retrieve.ts";
import {
  droppedRecords,
  exportFlightSession,
  feedbackRecords,
  flightRecords,
  flightSessionJson,
  noteDroppedUtterance,
  parseFlightLine,
  recordAnswerFeedback,
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
    transcriptSummary: { theyLines: 0, youLines: 0 },
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

  const answerId = recordAnswerFlight({
    query: routed.card.query,
    transcriptSummary: { theyLines: 1, youLines: 0, lastQuestion: routed.card.query },
    gate: { verdict: "question", question: routed.card.query, triggered: true },
    retrieval: formatFlightRetrievalSummary(chunks, hits),
    tier: routed.tier,
    latency: routed.latency,
    say: routed.card.say,
    reason: routed.card.reason ?? null,
    citations: routed.card.citations,
    quotaRemaining: 19,
    traceId: "test-trace-grounded",
  });

  assert.ok(answerId);
  assert.equal(flightRecords().length, 1);
  const exported = exportFlightSession();
  assert.ok(Array.isArray(exported.records));
  const first = exported.records[0];
  assert.equal(first?.kind, "answer");
  if (first?.kind !== "answer") throw new Error("expected answer record");
  assert.equal(first.tier, "grounded");
  assert.equal(first.traceId, "test-trace-grounded");
  assert.equal(first.latency.retrieveMs, 12);
  assert.ok(first.retrieval.includes("hits"));
  assert.equal(first.transcriptSummary.theyLines, 1);

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
    transcriptSummary: { theyLines: 0, youLines: 0 },
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

test("feedback lines round-trip through export and parser", () => {
  enableFlightRecorder();
  installStorage();

  const answerId = recordAnswerFlight({
    query: "Why retry?",
    transcriptSummary: { theyLines: 1, youLines: 0, lastQuestion: "Why retry?" },
    gate: { verdict: "question", question: "Why retry?", triggered: true },
    retrieval: "1 chunks | 0 excluded | 1 hits",
    tier: "grounded",
    latency: { retrieveMs: 5, llmMs: 80, verifyMs: 10, totalMs: 95 },
    say: "Three tries max.",
    reason: null,
    citations: [],
    quotaRemaining: 19,
  });
  assert.ok(answerId);

  recordAnswerFeedback({
    answerId,
    reason: "wrong-source",
    tier: "grounded",
    latencyMs: 95,
  });

  assert.equal(feedbackRecords().length, 1);
  const exported = exportFlightSession();
  const feedback = exported.records.filter((row) => row.kind === "feedback");
  assert.equal(feedback.length, 1);
  assert.equal(feedback[0]?.answerId, answerId);
  assert.equal(feedback[0]?.reason, "wrong-source");

  const roundTrip = JSON.parse(flightSessionJson(false)) as {
    records: Array<{ kind: string; reason?: string; answerId?: string }>;
  };
  const line = roundTrip.records.find((row) => row.kind === "feedback");
  assert.ok(line);
  assert.equal(line.reason, "wrong-source");
  assert.equal(line.answerId, answerId);

  const parsed = parseFlightLine(JSON.stringify(line));
  assert.equal(parsed?.kind, "feedback");
  if (parsed?.kind === "feedback") {
    assert.equal(parsed.tier, "grounded");
    assert.equal(parsed.latencyMs, 95);
  }
});
