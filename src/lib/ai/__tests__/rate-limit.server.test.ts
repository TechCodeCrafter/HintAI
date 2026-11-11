import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { checkMemoryRateLimit, limitPerHour, resetRateLimitsForTests } from "../rate-limit.server.ts";

beforeEach(() => {
  resetRateLimitsForTests();
  delete process.env.TRANSCRIBE_RATE_LIMIT_PER_HOUR;
});

test("transcribe budget is per user and separate from synthesis", () => {
  process.env.TRANSCRIBE_RATE_LIMIT_PER_HOUR = "2";
  checkMemoryRateLimit("transcribe", "u1");
  checkMemoryRateLimit("transcribe", "u1");
  assert.throws(() => checkMemoryRateLimit("transcribe", "u1"), /Rate limit exceeded/);
  checkMemoryRateLimit("transcribe", "u2");
  checkMemoryRateLimit("synthesis", "u1");
});

test("window resets after an hour", () => {
  process.env.TRANSCRIBE_RATE_LIMIT_PER_HOUR = "1";
  const t0 = 1_000_000;
  checkMemoryRateLimit("transcribe", "u1", t0);
  assert.throws(() => checkMemoryRateLimit("transcribe", "u1", t0 + 1000));
  checkMemoryRateLimit("transcribe", "u1", t0 + 60 * 60 * 1000);
});

test("bad env values fall back to defaults", () => {
  process.env.TRANSCRIBE_RATE_LIMIT_PER_HOUR = "abc";
  assert.equal(limitPerHour("transcribe"), 240);
});
