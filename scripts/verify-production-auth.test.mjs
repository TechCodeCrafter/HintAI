import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeAuthStatus } from "./verify-production-auth.mjs";

test("normalizeAuthStatus upgrades legacy production payload", () => {
  const normalized = normalizeAuthStatus({
    oauthReady: true,
    googleDirect: true,
    reason: null,
  });
  assert.equal(normalized.authEnabled, true);
  assert.equal(normalized.devUserFallbackBlocked, true);
  assert.equal(normalized.legacyStatusShape, true);
  assert.deepEqual(normalized.blockers, []);
});

test("normalizeAuthStatus preserves expanded payload", () => {
  const expanded = {
    authEnabled: true,
    devUserFallbackBlocked: true,
    oauthReady: true,
    blockers: [],
  };
  assert.deepEqual(normalizeAuthStatus(expanded), expanded);
});
