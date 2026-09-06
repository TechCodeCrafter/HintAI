import assert from "node:assert/strict";
import { test } from "node:test";

import { NORTHSTAR } from "../../repo/northstar.ts";
import { STRONG_EVIDENCE_SCORE, WEAK_EVIDENCE_SCORE, routeFromScore } from "../answer-route.ts";
import { buildChunks, retrieve } from "../retrieve.ts";

const chunks = buildChunks(NORTHSTAR);

test("score bands route extract, synthesize, then freely", () => {
  assert.equal(routeFromScore(STRONG_EVIDENCE_SCORE), "extract");
  assert.equal(routeFromScore(19), "extract");
  assert.equal(routeFromScore(WEAK_EVIDENCE_SCORE), "synthesize");
  assert.equal(routeFromScore(3.2), "synthesize");
  assert.equal(routeFromScore(WEAK_EVIDENCE_SCORE - 0.1), "freely");
  assert.equal(routeFromScore(0), "freely");
});

test("northstar questions land in the intended band", () => {
  const strong = retrieve("Why does that retry three times?", chunks)[0]?.score ?? 0;
  const weak = retrieve("What is our parental leave policy?", chunks)[0]?.score ?? 0;
  const none = retrieve("What is the weather in Tokyo today?", chunks)[0]?.score ?? 0;
  assert.equal(routeFromScore(strong), "extract");
  assert.equal(routeFromScore(weak), "synthesize");
  assert.equal(routeFromScore(none), "freely");
});
