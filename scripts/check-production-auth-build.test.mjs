import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertAuthEnabledClientBundle,
  assertAuthEnabledSourceGates,
} from "./check-production-auth-build.mjs";
import { projectRoot } from "./with-app-env.mjs";

test("auth-enabled source gates block unconditional dev-user fallback", () => {
  const result = assertAuthEnabledSourceGates(projectRoot());
  assert.equal(result.ok, true);
});

test("client bundle scan skips when dist is absent", () => {
  const result = assertAuthEnabledClientBundle(projectRoot());
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
});
