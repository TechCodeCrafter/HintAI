import assert from "node:assert/strict";
import { test } from "node:test";

import {
  HIGH_ENERGY_GATE_MULTIPLIER,
  HIGH_ENERGY_MIN_DURATION_MS,
  SPEECH_PROB_THRESHOLD,
  judgeUtteranceAdmission,
} from "../utterance-admission.ts";

const GATE = 0.02;

test("clear speech at threshold is admitted via silero", () => {
  const out = judgeUtteranceAdmission({
    meanSileroProb: SPEECH_PROB_THRESHOLD,
    durationMs: 800,
    energyRms: 0.01,
    gate: GATE,
  });
  assert.equal(out.admit, true);
  if (out.admit) assert.equal(out.via, "silero");
});

test("noise-like low silero score is rejected", () => {
  const out = judgeUtteranceAdmission({
    meanSileroProb: 0.12,
    durationMs: 3000,
    energyRms: 0.08,
    gate: GATE,
  });
  assert.equal(out.admit, false);
  if (!out.admit) {
    assert.equal(out.reason, "silero-low-prob");
    assert.equal(out.sileroProb, 0.12);
  }
});

test("high energy long clip is admitted when silero has not scored yet", () => {
  const out = judgeUtteranceAdmission({
    meanSileroProb: null,
    durationMs: HIGH_ENERGY_MIN_DURATION_MS,
    energyRms: GATE * HIGH_ENERGY_GATE_MULTIPLIER,
    gate: GATE,
  });
  assert.equal(out.admit, true);
  if (out.admit) assert.equal(out.via, "high-energy");
});

test("short low-energy clip is rejected before silero is ready", () => {
  const out = judgeUtteranceAdmission({
    meanSileroProb: null,
    durationMs: 400,
    energyRms: GATE,
    gate: GATE,
  });
  assert.equal(out.admit, false);
});
