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

function assertUnsupported(claim: string, content = EVIDENCE) {
  const s = span(content);
  const check = verifyClaim(claim, [s]);
  assert.equal(check.ok, false, `should reject: ${claim} (${check.missing.join(",")})`);
}

function assertSupported(claim: string, content = EVIDENCE) {
  const s = span(content);
  const check = verifyClaim(claim, [s]);
  assert.equal(check.ok, true, `should accept: ${claim} (${check.missing.join(",")})`);
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
  assertSupported("The billing service retries failed webhooks three times before alerting.");
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
  assertUnsupported("Refunds are processed within 30 days.", refunds);
  assertUnsupported("Chargebacks are processed within 5 days.", refunds);
});

test("planned capability cannot be claimed as supported across sentences", () => {
  const parser =
    "The parser supports PDF and DOCX. XLSX support is planned.";
  assertUnsupported("The parser supports XLSX.", parser);
});

test("predicate transfer across adjacent sentences is rejected", () => {
  const deploys =
    "Deploys run nightly. Rollbacks require manual approval from the release manager.";
  assertUnsupported("Deploys require manual approval from the release manager.", deploys);
});

test("light stemming gap: alerts vs alerting stays fail-closed", () => {
  const alerting = "Billing retries failed webhooks three times before alerting.";
  const s = span(alerting);
  assert.equal(
    verifyClaim("Billing retries failed webhooks three times, then alerts.", [s]).ok,
    false,
  );
});

test("hard-wrapped docstring answers pass when sentences are reflowed", () => {
  const doc = `/**
 * Retry policy for settlement exports.
 *
 * Attempts are capped at three because the payment gateway stalls rather than
 * failing fast, so a fourth attempt duplicates the settlement file instead of
 * recovering it.
 */`;
  assertSupported(
    "Attempts are capped at three because a fourth attempt duplicates the settlement file.",
    doc,
  );
});

test("multi-sentence synthesis passes when each clause maps to its sentence", () => {
  const refunds =
    "Refunds are processed within 5 days. Chargebacks are processed within 30 days.";
  assertSupported(
    "Refunds are processed within 5 days and chargebacks are processed within 30 days.",
    refunds,
  );
});

test("coordinated deploy and rollback facts pass across clauses", () => {
  const deploys =
    "Deploys run nightly. Rollbacks require manual approval from the release manager.";
  assertSupported(
    "Deploys run nightly, and rollbacks require manual approval from the release manager.",
    deploys,
  );
});

test("clause reorder within one sentence passes", () => {
  const tokens = "Tokens expire after 24 hours unless refreshed.";
  assertSupported("Unless refreshed, tokens expire after 24 hours.", tokens);
});
