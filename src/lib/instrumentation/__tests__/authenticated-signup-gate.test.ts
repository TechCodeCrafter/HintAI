import assert from "node:assert/strict";
import { test } from "node:test";

import { shouldRecordAuthenticatedSignup } from "../authenticated-signup-gate.ts";

test("shouldRecordAuthenticatedSignup rejects anonymous and dev identities", () => {
  assert.equal(
    shouldRecordAuthenticatedSignup({
      ready: true,
      accountId: "ws_anon_abc123",
      hasUser: true,
      authEnabled: true,
    }),
    false,
  );
  assert.equal(
    shouldRecordAuthenticatedSignup({
      ready: true,
      accountId: "dev-user",
      hasUser: true,
      authEnabled: true,
    }),
    false,
  );
});

test("shouldRecordAuthenticatedSignup requires verified session", () => {
  assert.equal(
    shouldRecordAuthenticatedSignup({
      ready: false,
      accountId: "user-real",
      hasUser: true,
      authEnabled: true,
    }),
    false,
  );
  assert.equal(
    shouldRecordAuthenticatedSignup({
      ready: true,
      accountId: "user-real",
      hasUser: false,
      authEnabled: true,
    }),
    false,
  );
  assert.equal(
    shouldRecordAuthenticatedSignup({
      ready: true,
      accountId: null,
      hasUser: true,
      authEnabled: true,
    }),
    false,
  );
});

test("shouldRecordAuthenticatedSignup allows verified authenticated account", () => {
  assert.equal(
    shouldRecordAuthenticatedSignup({
      ready: true,
      accountId: "user-real-92817",
      hasUser: true,
      authEnabled: true,
    }),
    true,
  );
});

test("shouldRecordAuthenticatedSignup allows dev-user when auth is disabled", () => {
  assert.equal(
    shouldRecordAuthenticatedSignup({
      ready: true,
      accountId: "dev-user",
      hasUser: true,
      authEnabled: false,
    }),
    true,
  );
});
