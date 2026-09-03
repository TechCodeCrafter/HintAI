import assert from "node:assert/strict";
import { test } from "node:test";

import { detectContradictions, saysOpposite } from "../contradict.ts";
import { newClaim, newMeetingRecord } from "../types.ts";

function pastSupported(text: string, speaker = "Alice", startedAt = Date.parse("2026-08-15T12:00:00Z")) {
  const meeting = newMeetingRecord("earlier review", startedAt);
  meeting.endedAt = startedAt + 3_600_000;
  const claim = { ...newClaim({ meetingId: meeting.id, speaker, text }), status: "supported" as const };
  meeting.claims = [claim];
  return { meeting, claim };
}

test("deprecate vs keep on the same topic is contradicted", () => {
  const { meeting, claim: prior } = pastSupported("we decided to deprecate legacy API");
  const current = newClaim({
    meetingId: "now",
    speaker: "Bob",
    text: "we decided to keep legacy API",
  });
  const marked = detectContradictions(current, [meeting]);
  assert.ok(marked);
  assert.equal(marked.status, "contradicted");
  assert.deepEqual(marked.relatedClaimIds, [prior.id]);
});

test("can you hear me is not a contradiction of a pack claim", () => {
  const { meeting } = pastSupported("auth handles 10k RPS");
  const chatter = newClaim({ meetingId: "now", speaker: "You", text: "can you hear me" });
  assert.equal(detectContradictions(chatter, [meeting]), null);
});

test("missing evidence is not contradicted — unverified past is ignored", () => {
  const { meeting, claim } = pastSupported("we decided to deprecate legacy API");
  meeting.claims = [{ ...claim, status: "unverified" }];
  const current = newClaim({
    meetingId: "now",
    speaker: "Alice",
    text: "we decided to keep legacy API",
  });
  assert.equal(detectContradictions(current, [meeting]), null);
});

test("negation and quantity clashes count as opposite", () => {
  assert.equal(saysOpposite("we will not ship Friday", "we will ship Friday"), true);
  assert.equal(saysOpposite("auth handles 1k RPS", "auth handles 10k RPS"), true);
  assert.equal(saysOpposite("We can ship by Friday", "The timeline is Q4 at earliest"), true);
  assert.equal(saysOpposite("retries are capped at three", "retries are capped at three"), false);
});

test("same speaker plus opposite timeline marks the current line", () => {
  const { meeting, claim: prior } = pastSupported("The timeline is Q4 at earliest", "Alice");
  const current = newClaim({
    meetingId: "now",
    speaker: "Alice",
    text: "We can ship by Friday",
  });
  const marked = detectContradictions(current, [meeting]);
  assert.ok(marked);
  assert.equal(marked.status, "contradicted");
  assert.ok(marked.relatedClaimIds.includes(prior.id));
});
