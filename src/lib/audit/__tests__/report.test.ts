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

test("team reports list temporal contradictions; pro skips them", () => {
  const past = newMeetingRecord("earlier", Date.parse("2026-08-15T12:00:00Z"));
  past.endedAt = past.startedAt + 1_000;
  const prior = {
    ...newClaim({ meetingId: past.id, speaker: "Alice", text: "The timeline is Q4 at earliest" }),
    status: "supported" as const,
  };
  past.claims = [prior];

  const meeting = newMeetingRecord("today", Date.parse("2026-09-02T12:00:00Z"));
  meeting.claims = [
    newClaim({ meetingId: meeting.id, speaker: "Alice", text: "We can ship by Friday" }),
  ];

  const pro = claimAuditReport(meeting, [past], "pro");
  assert.doesNotMatch(pro, /## Contradictions/);

  const team = claimAuditReport(meeting, [past], "team");
  assert.match(team, /## Contradictions/);
  assert.match(team, /\*\*Alice:\*\* "We can ship by Friday"/);
  assert.match(team, /⚠️ Contradicted by meeting on 2026-08-15: "The timeline is Q4 at earliest"/);
});
