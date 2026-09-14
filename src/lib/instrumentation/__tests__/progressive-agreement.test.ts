import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyProgressiveAgreement, summarizeProgressiveAgreement } from "../progressive-agreement.ts";

test("classifyProgressiveAgreement marks identical answers consistent", () => {
  const say = "Attempts are capped at three because a fourth attempt duplicates the settlement file.";
  assert.equal(classifyProgressiveAgreement(say, say, "grounded"), "consistent");
});

test("classifyProgressiveAgreement marks unrelated answers conflicting", () => {
  assert.equal(
    classifyProgressiveAgreement("Retries stop at three attempts.", "The weather in Tokyo is rainy.", "synthesis"),
    "conflicting",
  );
});

test("classifyProgressiveAgreement marks overlapping answers partial", () => {
  assert.equal(
    classifyProgressiveAgreement(
      "Checkout requires COMBO_TOKEN_A for every request.",
      "Every checkout request requires COMBO_TOKEN_A and expires after idle time.",
      "grounded",
    ),
    "partial",
  );
});

test("summarizeProgressiveAgreement computes safe threshold", () => {
  const summary = summarizeProgressiveAgreement([
    { tier: "grounded", progressive: { shadowLocalCardSupported: true, progressiveAgreement: "consistent" } },
    { tier: "grounded", progressive: { shadowLocalCardSupported: true, progressiveAgreement: "partial" } },
    { tier: "synthesis", progressive: { shadowLocalCardSupported: true, progressiveAgreement: "consistent" } },
  ]);
  assert.equal(summary.comparable, 3);
  assert.equal(summary.conflicting, 0);
  assert.equal(summary.safeForProgressive, true);
});
