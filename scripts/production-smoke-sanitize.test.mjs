import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertStorageStateSafe,
  sanitizeStorageStatePayload,
  shouldStripLocalStorageKey,
} from "./production-smoke-sanitize.mjs";

test("shouldStripLocalStorageKey removes provider and pack keys", () => {
  assert.equal(shouldStripLocalStorageKey("meethint.providerKeys"), true);
  assert.equal(shouldStripLocalStorageKey("meethint.providerKeys.user_a"), true);
  assert.equal(shouldStripLocalStorageKey("meethint.theme"), false);
});

test("sanitizeStorageStatePayload keeps cookies and drops provider keys", () => {
  const sanitized = sanitizeStorageStatePayload({
    cookies: [{ name: "session", value: "abc", domain: "www.meethint.ai", path: "/" }],
    origins: [
      {
        origin: "https://www.meethint.ai",
        localStorage: [
          { name: "meethint.providerKeys.user_a", value: '{"openai":"sk-secret1234567890"}' },
          { name: "meethint.theme", value: "dark" },
        ],
      },
    ],
  });
  assert.equal(sanitized.cookies.length, 1);
  assert.equal(sanitized.origins[0].localStorage.length, 1);
  assert.equal(sanitized.origins[0].localStorage[0].name, "meethint.theme");
  const json = JSON.stringify(sanitized);
  assertStorageStateSafe(json);
});

test("assertStorageStateSafe rejects sk- patterns", () => {
  assert.throws(
    () => assertStorageStateSafe('{"cookies":[{"value":"sk-abcdefghijklmnopqrst"}]}'),
    /forbidden secret pattern/,
  );
});
