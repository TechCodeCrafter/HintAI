import assert from "node:assert/strict";
import { test } from "node:test";

import {
  analyzeFlightRecords,
  formatFlightAnalysis,
  OPTIMIZATION_THRESHOLDS,
} from "../flight-analysis.ts";
import { buildSyntheticFlightSession } from "../flight-session-synth.ts";
import type { AnswerFlightRecord } from "../flight-recorder.ts";

function answer(partial: Partial<AnswerFlightRecord> & Pick<AnswerFlightRecord, "tier" | "latency">): AnswerFlightRecord {
  return {
    kind: "answer",
    traceId: "t",
    answerId: "t",
    timestamp: 1,
    query: "q",
    transcriptSummary: { theyLines: 1, youLines: 0 },
    gate: null,
    retrieval: "hits",
    say: partial.tier === "silent" ? null : "yes",
    reason: null,
    citations: [],
    quotaRemaining: 20,
    droppedUtterances: 0,
    supported: partial.tier !== "silent",
    ...partial,
  };
}

test("analyzeFlightRecords separates tiers with sample counts and percentiles", () => {
  const records = [
    answer({ tier: "localCard", latency: { retrieveMs: 2, llmMs: 0, verifyMs: 0, totalMs: 5 } }),
    answer({ tier: "localCard", latency: { retrieveMs: 3, llmMs: 0, verifyMs: 0, totalMs: 8 } }),
    answer({ tier: "grounded", latency: { retrieveMs: 4, llmMs: 600, verifyMs: 20, totalMs: 640 } }),
    answer({ tier: "synthesis", latency: { retrieveMs: 5, llmMs: 900, verifyMs: 30, totalMs: 950 } }),
    answer({ tier: "silent", latency: { retrieveMs: 2, llmMs: 0, verifyMs: 0, totalMs: 3 }, supported: false, say: null }),
  ];
  const report = analyzeFlightRecords(records);
  assert.equal(report.traceCount, 5);
  const local = report.byTier.find((row) => row.tier === "localCard");
  assert.equal(local?.sampleCount, 2);
  assert.ok(local!.totalMs.p95 >= local!.totalMs.p50);
  const grounded = report.byTier.find((row) => row.tier === "grounded");
  assert.equal(grounded?.sampleCount, 1);
  assert.equal(grounded?.llmMs.p50, 600);
});

test("synthetic session meets capture goals and recommends LLM tuning over routing", () => {
  const records = buildSyntheticFlightSession(99);
  const report = analyzeFlightRecords(records);
  assert.ok(report.captureGoalStatus.localCard.met);
  assert.ok(report.captureGoalStatus.llmTiers.met);
  assert.ok(report.captureGoalStatus.multiSource.met);
  assert.equal(report.recommendations.sourceRoutingJustified, false);
  assert.match(report.recommendations.recommendedStep5C, /5C-/);
  const text = formatFlightAnalysis(report);
  assert.match(text, /Traces analyzed:/);
  assert.match(text, /Source routing justified: false/);
});

test("routing recommendation triggers when retrieval p95 exceeds threshold", () => {
  const rows: AnswerFlightRecord[] = [];
  for (let i = 0; i < 10; i += 1) {
    rows.push(
      answer({
        tier: "grounded",
        sourceCount: 4,
        latency: {
          retrieveMs: 80 + i * 5,
          llmMs: 200,
          verifyMs: 10,
          totalMs: 300 + i * 5,
        },
      }),
    );
  }
  const report = analyzeFlightRecords(rows);
  assert.ok(report.byTier.find((row) => row.tier === "grounded")!.retrieveMs.p95 >= OPTIMIZATION_THRESHOLDS.retrievalP95LowMs);
  assert.equal(report.recommendations.sourceRoutingJustified, true);
});

test("progressive rendering flagged when save p95 is high and agreement is safe", () => {
  const rows: AnswerFlightRecord[] = [];
  for (let i = 0; i < 8; i += 1) {
    rows.push(
      answer({
        tier: "grounded",
        latency: { retrieveMs: 3, llmMs: 900, verifyMs: 20, totalMs: 950 },
        progressive: {
          shadowLocalCardSupported: true,
          earliestSupportedMs: 20,
          finalAnswerMs: 950,
          progressiveSaveMs: 930,
          progressiveAgreement: "consistent",
        },
      }),
    );
  }
  const report = analyzeFlightRecords(rows);
  assert.equal(report.recommendations.progressiveRenderingPrioritized, true);
  assert.equal(report.recommendations.progressiveSafe, true);
});

test("progressive rendering blocked when early and final answers conflict", () => {
  const rows: AnswerFlightRecord[] = [];
  for (let i = 0; i < 6; i += 1) {
    rows.push(
      answer({
        tier: "grounded",
        latency: { retrieveMs: 3, llmMs: 900, verifyMs: 20, totalMs: 950 },
        progressive: {
          shadowLocalCardSupported: true,
          earliestSupportedMs: 20,
          finalAnswerMs: 950,
          progressiveSaveMs: 930,
          progressiveAgreement: i < 2 ? "conflicting" : "consistent",
        },
      }),
    );
  }
  const report = analyzeFlightRecords(rows);
  assert.equal(report.agreement.conflicting, 2);
  assert.equal(report.recommendations.progressiveSafe, false);
});
