import assert from "node:assert/strict";
import test from "node:test";
import { applicabilitySafetyMetrics, classificationMetrics, percentile } from "../metrics.ts";

test("classificationMetrics computes accuracy", () => {
  const m = classificationMetrics([
    { expected: "a", predicted: "a" },
    { expected: "a", predicted: "b" },
  ]);
  assert.equal(m.total, 2);
  assert.equal(m.accuracy, 0.5);
});

test("applicabilitySafetyMetrics counts unsafe continuation", () => {
  const m = applicabilitySafetyMetrics([
    { expected: "NOT_APPLICABLE", predicted: "APPLICABLE" },
    { expected: "APPLICABLE", predicted: "APPLICABLE" },
  ]);
  assert.equal(m.unsafeContinuation, 1);
  assert.equal(m.unsafeContinuationRate, 0.5);
});

test("percentile returns ordered statistic", () => {
  assert.equal(percentile([10, 20, 30, 40], 50), 20);
});
