import assert from "node:assert/strict";
import { test } from "node:test";

import "fake-indexeddb/auto";

import { createDexieMeetingRepository, createMemoryMeetingRepository } from "../repository.ts";
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
