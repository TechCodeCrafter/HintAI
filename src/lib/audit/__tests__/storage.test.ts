import assert from "node:assert/strict";
import { test } from "node:test";

import "fake-indexeddb/auto";

import { finishMeeting } from "../session.ts";
import { createDexieMeetingRepository, createMemoryMeetingRepository, setMeetingRepository } from "../repository.ts";
import { newClaim, newMeetingRecord } from "../types.ts";

test("meetings persist in memory and IndexedDB", async () => {
  const stores = [
    { name: "memory", repo: createMemoryMeetingRepository() },
    { name: "indexeddb", repo: createDexieMeetingRepository(`meethint-meetings-${Date.now()}`) },
  ];
  for (const { name, repo } of stores) {
    const open = newMeetingRecord("live session", 100);
    open.claims = [newClaim({ meetingId: open.id, speaker: "Maya", text: "Retries are capped at three." })];
    await repo.put(open);
    const ended = newMeetingRecord("yesterday", 50);
    ended.endedAt = 80;
    await repo.put(ended);

    const got = await repo.get(open.id);
    assert.equal(got?.name, "live session", name);
    assert.equal(got?.claims[0]?.text, "Retries are capped at three.", name);

    const past = await repo.listPast(open.id);
    assert.equal(past.length, 1, name);
    assert.equal(past[0]?.id, ended.id, name);

    const all = await repo.list();
    assert.equal(all[0]?.id, open.id, name);
  }
});

test("ending a meeting stores the answer history", async () => {
  const repo = createMemoryMeetingRepository();
  setMeetingRepository(repo);
  const meeting = newMeetingRecord("review", 100);
  meeting.claims = [newClaim({ meetingId: meeting.id, speaker: "Maya", text: "Retries are capped at three." })];
  await repo.put(meeting);

  const history = [
    {
      id: "a1",
      query: "Why does that retry three times?",
      say: "Retries stop at three.",
      badge: "from-docs" as const,
      citations: [],
      timestamp: 120,
    },
  ];
  const finished = await finishMeeting(meeting, [], "pro", history);
  assert.equal(finished.meeting.answerHistory.length, 1);
  assert.equal(finished.meeting.answerHistory[0]?.query, "Why does that retry three times?");
  const stored = await repo.get(meeting.id);
  assert.equal(stored?.answerHistory[0]?.say, "Retries stop at three.");
  setMeetingRepository(null);
});
