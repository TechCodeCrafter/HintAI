import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import type { AnswerFlightRecord } from "../flight-recorder.ts";
import {
  classifyFastPathSemanticQuality,
  countSupportedMultiSourceScenarios,
  summarizeFastPathQuality,
} from "../fast-path-quality.ts";

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../../fixtures/flight-sessions");

function loadSession(name: string): AnswerFlightRecord[] {
  const session = JSON.parse(readFileSync(join(fixtureRoot, name), "utf8"));
  return session.records.filter((row: AnswerFlightRecord) => row.kind === "answer");
}

test("classifyFastPathSemanticQuality detects equivalence and conflict", () => {
  assert.equal(
    classifyFastPathSemanticQuality("Attempts are capped at three.", "Attempts are capped at three."),
    "semantically equivalent",
  );
  assert.equal(
    classifyFastPathSemanticQuality("The weather is sunny in Tokyo today.", "Attempts are capped at three."),
    "conflicting",
  );
});

test("Step 5D fixtures: fast-path quality meets acceptance threshold", () => {
  const baseline = loadSession("real-session-baseline-5b1.json");
  const optimized = loadSession("real-session-latest.json");
  const summary = summarizeFastPathQuality(baseline, optimized);
  assert.equal(summary.conflicting, 0);
  assert.ok(summary.acceptableRate >= 0.9, `acceptable rate ${summary.acceptableRate}`);
  assert.equal(summary.passesThreshold, true);
});

test("multi-source scenario supported count unchanged after fast-path (capability, not citation count)", () => {
  const baseline = loadSession("real-session-baseline-5b1.json");
  const optimized = loadSession("real-session-latest.json");
  assert.equal(countSupportedMultiSourceScenarios(baseline), countSupportedMultiSourceScenarios(optimized));
});
