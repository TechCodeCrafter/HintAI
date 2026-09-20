import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  SYNTHESIS_LIMITS,
  redactSynthesisForLog,
  requireSynthesisUserId,
  synthesisAuthRequired,
  synthesisDevBypassAllowed,
  validateSynthesisPayload,
} from "../synthesis-guard.server.ts";
import { checkSynthesisRateLimit, resetSynthesisRateLimitsForTests } from "../synthesis-rate-limit.server.ts";

const saved = { ...process.env };

afterEach(() => {
  process.env = { ...saved };
  resetSynthesisRateLimitsForTests();
});

test("synthesis auth is required in production and when database is configured", () => {
  delete process.env.DATABASE_URL;
  delete process.env.SYNTHESIS_REQUIRE_AUTH;
  process.env.NODE_ENV = "development";
  delete process.env.VITE_AUTH_ENABLED;
  assert.equal(synthesisAuthRequired(), false);

  process.env.DATABASE_URL = "postgres://example";
  assert.equal(synthesisAuthRequired(), true);

  delete process.env.DATABASE_URL;
  process.env.NODE_ENV = "production";
  assert.equal(synthesisAuthRequired(), true);
});

test("unauthenticated synthesis is rejected when auth is required", () => {
  process.env.NODE_ENV = "production";
  assert.throws(
    () => requireSynthesisUserId(undefined),
    (err: Error & { code?: string }) => err.message === "Unauthorized" && err.code === "unauthorized",
  );
});

test("production never falls back to dev-user for anonymous synthesis", () => {
  process.env.NODE_ENV = "production";
  delete process.env.DATABASE_URL;
  delete process.env.SYNTHESIS_DEV_BYPASS;
  delete process.env.SYNTHESIS_REQUIRE_AUTH;
  delete process.env.VITE_AUTH_ENABLED;
  assert.equal(synthesisAuthRequired(), true);
  assert.throws(() => requireSynthesisUserId(undefined));
});

test("authenticated synthesis user id is accepted when auth is required", () => {
  process.env.NODE_ENV = "production";
  assert.equal(requireSynthesisUserId("user-a"), "user-a");
});

test("dev bypass is allowed only in explicit test mode", () => {
  process.env.NODE_ENV = "test";
  assert.equal(synthesisDevBypassAllowed(), true);
  process.env.NODE_ENV = "development";
  assert.equal(synthesisDevBypassAllowed(), false);
  process.env.SYNTHESIS_DEV_BYPASS = "true";
  assert.equal(synthesisDevBypassAllowed(), true);
});

test("oversized prompt is rejected", () => {
  assert.throws(
    () => validateSynthesisPayload({ prompt: "x".repeat(SYNTHESIS_LIMITS.maxPromptChars + 1) }),
    (err: Error & { code?: string }) => err.code === "prompt_too_large",
  );
});

test("rate limit is enforced per user", () => {
  process.env.SYNTHESIS_RATE_LIMIT_PER_HOUR = "2";
  checkSynthesisRateLimit("user-a");
  checkSynthesisRateLimit("user-a");
  assert.throws(
    () => checkSynthesisRateLimit("user-a"),
    (err: Error & { code?: string }) => err.code === "rate_limited",
  );
  checkSynthesisRateLimit("user-b");
});

test("redacted synthesis logs never include provider key material", () => {
  const redacted = redactSynthesisForLog({
    prompt: "secret prompt with sk-live-key",
    keys: { openai: "sk-live-key-should-not-appear" },
  });
  assert.equal(JSON.stringify(redacted).includes("sk-live"), false);
  assert.equal(redacted.hasKeys, true);
});
