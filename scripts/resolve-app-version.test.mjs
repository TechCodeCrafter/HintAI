import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveAppVersion } from "./resolve-app-version.mjs";

test("resolveAppVersion prefers explicit VITE_APP_VERSION", () => {
  assert.equal(
    resolveAppVersion({ VITE_APP_VERSION: "abc1234", VERCEL_GIT_COMMIT_SHA: "deadbeef" }),
    "abc1234",
  );
});

test("resolveAppVersion uses Vercel commit SHA when unset", () => {
  assert.equal(
    resolveAppVersion({ VERCEL_GIT_COMMIT_SHA: "e208528179d4ec84470430bb98a051ce76c7f21c" }),
    "e208528",
  );
});

test("resolveAppVersion falls back to git HEAD in a checkout", () => {
  const version = resolveAppVersion({});
  assert.match(version, /^[0-9a-f]{7,40}$/i);
});
