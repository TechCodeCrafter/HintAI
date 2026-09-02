import assert from "node:assert/strict";
import { test } from "node:test";

import { claimAuditReport, reportFilename } from "../report.ts";
import { newClaim, newMeetingRecord } from "../types.ts";

test("the report lists supported and unverified claims", () => {
  const meeting = newMeetingRecord("northstar-payments · review", 1_700_000_000_000);
  meeting.endedAt = 1_700_000_180_000;
  meeting.claims = [
    { ...newClaim({ meetingId: meeting.id, speaker: "You", text: "SSO by Q2" }), status: "unverified" },
    { ...newClaim({ meetingId: meeting.id, speaker: "Maya", text: "Retries are capped at three." }), status: "supported" },
  ];
  const markdown = claimAuditReport(meeting);
  assert.match(markdown, /# Claim Audit Report/);
  assert.match(markdown, /## All claims/);
  assert.match(markdown, /## Supported by the pack/);
  assert.match(markdown, /## Unverified/);
  assert.doesNotMatch(markdown, /Contradicted/);
  assert.match(reportFilename(meeting), /claim-audit-northstar-payments-review/);
});
