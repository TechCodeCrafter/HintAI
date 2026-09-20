import assert from "node:assert/strict";
import { test } from "node:test";

import { verifyClaimSemantics } from "../claim-verify.ts";
import { verifyClaim } from "../evidence.ts";
import { createEvidenceSpan } from "../evidence-span.ts";
import { hashText } from "../evidence.ts";

const EVIDENCE =
  "The billing service retries failed webhooks three times before alerting.";

function span(content = EVIDENCE) {
  return createEvidenceSpan({
    path: "services/billing.py",
    content,
    start: 0,
    end: content.length,
    contentHash: hashText(content),
    normalizedText: content,
  })!;
}

function assertUnsupported(claim: string) {
  const s = span();
  const check = verifyClaim(claim, [s]);
  assert.equal(check.ok, false, `should reject: ${claim}`);
}

test("negation inversion is rejected", () => {
  assertUnsupported("The billing service never retries failed webhooks and does not alert.");
});

test("subject-object reversal is rejected", () => {
  assertUnsupported("Alerting retries the billing service; webhooks failed three times.");
});

test("numeric changes are rejected", () => {
  assertUnsupported("The billing service retries failed webhooks five times before alerting.");
});

test("unit changes are rejected when units are present", () => {
  const timed = "The worker waits 500 milliseconds before retrying.";
  const s = span(timed);
  assert.equal(verifyClaim("The worker waits 5 seconds before retrying.", [s]).ok, false);
});

test("version changes are rejected", () => {
  const versioned = "Requires OAuth client version 2.1.0 for production tenants.";
  const s = span(versioned);
  assert.equal(verifyClaim("Requires OAuth client version 2.2.0 for production tenants.", [s]).ok, false);
});

test("correct paraphrase with preserved meaning passes", () => {
  const s = span();
  assert.equal(
    verifyClaim("The billing service retries failed webhooks three times before alerting.", [s]).ok,
    true,
  );
});

test("exact extraction passes", () => {
  const s = span();
  const semantic = verifyClaimSemantics(EVIDENCE, EVIDENCE.toLowerCase(), ["billing", "service", "retries"]);
  assert.equal(semantic.ok, true);
  assert.equal(verifyClaim(EVIDENCE, [s]).ok, true);
});

test("partial support and unsupported synthesis fail closed", () => {
  assertUnsupported("The billing service retries failed webhooks and also publishes audit events.");
  assertUnsupported("The billing service retries failed webhooks.");
});

test("cross-sentence numeric splice is rejected", () => {
  const refunds =
    "Refunds are processed within 5 days. Chargebacks are processed within 30 days.";
  assertUnsupported("Refunds are processed within 30 days.");
  assertUnsupported("Chargebacks are processed within 5 days.");
});

test("planned capability cannot be claimed as supported across sentences", () => {
  const parser =
    "The parser supports PDF and DOCX. XLSX support is planned.";
  assertUnsupported("The parser supports XLSX.");
});

test("predicate transfer across adjacent sentences is rejected", () => {
  const deploys =
    "Deploys run nightly. Rollbacks require manual approval from the release manager.";
  assertUnsupported("Deploys require manual approval from the release manager.");
});

test("light stemming gap: alerts vs alerting stays fail-closed", () => {
  const alerting = "Billing retries failed webhooks three times before alerting.";
  const s = span(alerting);
  assert.equal(
    verifyClaim("Billing retries failed webhooks three times, then alerts.", [s]).ok,
    false,
  );
});
