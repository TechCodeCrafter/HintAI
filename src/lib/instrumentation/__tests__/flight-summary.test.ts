import assert from "node:assert/strict";
import { test } from "node:test";

import { formatFlightSummary, parseFlightInput } from "../flight-summary.ts";

const SAMPLE = {
  exportedAt: 1_700_000_000_000,
  records: [
    {
      kind: "answer",
      answerId: "a1",
      timestamp: 1,
      query: "Q1",
      traceId: "a1",
      transcriptSummary: { theyLines: 0, youLines: 0 },
      gate: null,
      retrieval: "10 chunks | 0 excluded | 2 hits",
      tier: "grounded",
      latency: { retrieveMs: 10, llmMs: 100, verifyMs: 20, totalMs: 130 },
      say: "Yes",
      reason: null,
      citations: [],
      quotaRemaining: 19,
      droppedUtterances: 0,
    },
    {
      kind: "answer",
      answerId: "a2",
      timestamp: 2,
      query: "Q2",
      traceId: "a2",
      transcriptSummary: { theyLines: 0, youLines: 0 },
      gate: null,
      retrieval: "10 chunks | 0 excluded | 0 hits",
      tier: "silent",
      latency: { retrieveMs: 8, llmMs: 0, verifyMs: 0, totalMs: 8 },
      say: null,
      reason: "No matching material",
      citations: [],
      quotaRemaining: 18,
      droppedUtterances: 0,
    },
    {
      kind: "dropped",
      timestamp: 3,
      reason: "silero-low-prob",
      sileroProb: 0.12,
      durationMs: 2000,
      energy: 0.04,
    },
    {
      kind: "dropped",
      timestamp: 4,
      reason: "energy-vad",
      sileroProb: null,
      durationMs: 300,
      energy: 0.01,
    },
    {
      kind: "feedback",
      timestamp: 5,
      answerId: "a1",
      reason: "too-slow",
      tier: "grounded",
      latencyMs: 130,
    },
  ],
};

test("parseFlightInput accepts exported JSON and JSONL", () => {
  const fromJson = parseFlightInput(JSON.stringify(SAMPLE));
  assert.equal(fromJson.length, 5);

  const jsonl = SAMPLE.records.map((row) => JSON.stringify(row)).join("\n");
  const fromJsonl = parseFlightInput(jsonl);
  assert.equal(fromJsonl.length, 5);
});

test("formatFlightSummary prints tier, latency, drops, and feedback tables", () => {
  const summary = formatFlightSummary(parseFlightInput(JSON.stringify(SAMPLE)));
  assert.match(summary, /grounded: 1/);
  assert.match(summary, /silent-reason: 1/);
  assert.match(summary, /retrieveMs: 8 \/ 10 \/ 10/);
  assert.match(summary, /silero-low-prob: 1/);
  assert.match(summary, /energy-vad: 1/);
  assert.match(summary, /sileroProb min\/median\/max: 0\.120/);
  assert.match(summary, /Too slow: 1/);
});
