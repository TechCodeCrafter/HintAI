import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { assessProductionAuthConfig } from "../production-config.server.ts";

const saved = { ...process.env };

afterEach(() => {
  process.env = { ...saved };
});

function reportForHost(host: string) {
  return assessProductionAuthConfig(new Request(`https://${host}/api/auth/status`));
}

test("production host with Google OAuth reports auth configured and blocks dev-user fallback", () => {
  process.env.VITE_AUTH_ENABLED = "true";
  process.env.GOOGLE_CLIENT_ID = "google-id";
  process.env.GOOGLE_CLIENT_SECRET = "google-secret";
  process.env.DATABASE_URL = "postgres://example";
  process.env.BETTER_AUTH_SECRET = "secret";
  process.env.BETTER_AUTH_URL = "https://www.meethint.ai";

  const report = reportForHost("www.meethint.ai");
  assert.equal(report.authEnabled, true);
  assert.equal(report.authConfigured, true);
  assert.equal(report.googleDirect, true);
  assert.equal(report.oauthReady, true);
  assert.equal(report.devUserFallbackBlocked, true);
  assert.equal(report.failClosedOnMisconfig, false);
  assert.deepEqual(report.blockers, []);
});

test("auth disabled with database fails closed and blocks dev-user fallback", () => {
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GROK_AUTH_CLIENT_ID;
  delete process.env.GROK_AUTH_CLIENT_SECRET;
  process.env.VITE_AUTH_ENABLED = "false";
  process.env.DATABASE_URL = "postgres://example";

  const report = reportForHost("www.meethint.ai");
  assert.equal(report.authEnabled, false);
  assert.equal(report.authConfigured, false);
  assert.equal(report.failClosedOnMisconfig, true);
  assert.equal(report.devUserFallbackBlocked, true);
  assert.ok(report.blockers.includes("VITE_AUTH_ENABLED=false"));
  assert.ok(report.blockers.includes("fail-closed-auth-disabled-with-database"));
});

test("production host without oauth reports blocker", () => {
  process.env.VITE_AUTH_ENABLED = "true";
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GROK_AUTH_CLIENT_ID;
  delete process.env.GROK_AUTH_CLIENT_SECRET;
  process.env.DATABASE_URL = "postgres://example";
  process.env.BETTER_AUTH_SECRET = "secret";
  process.env.BETTER_AUTH_URL = "https://www.meethint.ai";

  const report = reportForHost("www.meethint.ai");
  assert.equal(report.oauthReady, false);
  assert.ok(report.blockers.includes("missing-production-oauth-client"));
});
