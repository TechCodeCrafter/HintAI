import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { computeBetaQualityMetrics, formatBetaQualityReport } from "../beta-quality-report.ts";
import {
  betaTelemetryRecords,
  isBetaTelemetryEnabled,
  noteBetaUserCreated,
  recordBetaAnswer,
  recordBetaEventOnce,
  recordBetaFeedback,
  resetBetaTelemetry,
  summarizeBetaFunnel,
  summarizeBetaLifecycle,
} from "../beta-telemetry.ts";
import { bindAccountId } from "../../auth/account-boundary.ts";

beforeEach(() => {
  process.env.VITE_BETA_TELEMETRY = "true";
  bindAccountId("beta-test-user");
  resetBetaTelemetry();
});

afterEach(() => {
  resetBetaTelemetry();
  bindAccountId(null);
  delete process.env.VITE_BETA_TELEMETRY;
});

test("beta telemetry enabled in browser-like test env", () => {
  assert.equal(isBetaTelemetryEnabled(), true);
});

test("feedback records useful and negative with privacy-safe fields", () => {
  recordBetaAnswer({
    traceId: "trace-1",
    tier: "grounded",
    supported: true,
    latencyMs: 420,
    sourceIds: ["src-a"],
    evidenceCount: 2,
    sourceCount: 1,
    spaceId: "space-1",
  });
  recordBetaFeedback({
    traceId: "trace-1",
    tier: "grounded",
    latencyMs: 420,
    result: "useful",
    sourceIds: ["src-a"],
    spaceId: "space-1",
  });
  recordBetaFeedback({
    traceId: "trace-2",
    tier: "grounded",
    latencyMs: 900,
    result: "not-useful",
    failureCategory: "wrong-source",
    sourceIds: ["src-b"],
    spaceId: "space-1",
  });

  const records = betaTelemetryRecords();
  assert.equal(records.filter((row) => row.kind === "feedback").length, 2);
  const useful = records.find((row) => row.kind === "feedback" && row.result === "useful");
  assert.ok(useful);
  if (useful?.kind === "feedback") {
    assert.equal(useful.traceId, "trace-1");
    assert.deepEqual(useful.sourceIds, ["src-a"]);
    assert.equal(useful.failureCategory, undefined);
  }
});

test("noteBetaUserCreated records signup events once per account", () => {
  noteBetaUserCreated();
  noteBetaUserCreated();
  const events = betaTelemetryRecords().filter((row) => row.kind === "event");
  assert.equal(events.filter((row) => row.event === "USER_CREATED").length, 1);
  assert.equal(events.filter((row) => row.event === "SIGNUP").length, 1);
  assert.equal(summarizeBetaLifecycle().signup, 2);
});

test("funnel computes time to first useful answer", () => {
  recordBetaEventOnce("USER_CREATED");
  const t0 = Date.now();
  recordBetaEventOnce("SPACE_CREATED", { spaceId: "s1" });
  recordBetaEventOnce("SOURCE_CONNECTED", { spaceId: "s1" });
  recordBetaEventOnce("INDEX_READY", { spaceId: "s1" });
  recordBetaEventOnce("FIRST_QUESTION", { spaceId: "s1" });
  recordBetaEventOnce("SUPPORTED_ANSWER", { spaceId: "s1" });
  recordBetaFeedback({
    traceId: "trace-useful",
    tier: "localCard",
    latencyMs: 40,
    result: "useful",
    spaceId: "s1",
  });

  const funnel = summarizeBetaFunnel();
  assert.ok(funnel.timeToFirstUsefulAnswerMs != null);
  assert.ok(funnel.timeToFirstUsefulAnswerMs! >= 0);
  assert.ok(funnel.timeToFirstUsefulAnswerMs! <= Date.now() - t0 + 50);
});

test("quality report includes supported, useful, and latency rates", () => {
  recordBetaAnswer({
    traceId: "a1",
    tier: "grounded",
    supported: true,
    latencyMs: 500,
    sourceIds: ["s1", "s2"],
    evidenceCount: 2,
    sourceCount: 2,
  });
  recordBetaAnswer({
    traceId: "a2",
    tier: "silent",
    supported: false,
    latencyMs: 120,
    sourceIds: [],
    evidenceCount: 0,
    sourceCount: 0,
  });
  recordBetaFeedback({
    traceId: "a1",
    tier: "grounded",
    latencyMs: 500,
    result: "useful",
    sourceIds: ["s1", "s2"],
  });

  const metrics = computeBetaQualityMetrics();
  assert.equal(metrics.answerCount, 2);
  assert.equal(metrics.supportedAnswerRate, 0.5);
  assert.equal(metrics.usefulRate, 1);
  assert.equal(metrics.multiSourceAnswerRate, 1);
  const report = formatBetaQualityReport(metrics);
  assert.match(report, /supported answer rate/);
  assert.match(report, /Time to First Useful Answer/);
});
