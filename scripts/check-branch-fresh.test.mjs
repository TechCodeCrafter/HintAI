import assert from "node:assert/strict";
import { test } from "node:test";

import { assessBranchFreshness } from "./check-branch-fresh.mjs";

test("assessBranchFreshness ok when base is ancestor of HEAD", () => {
  const result = assessBranchFreshness("HEAD~1");
  assert.equal(result.ok, true);
});

test("assessBranchFreshness fails for missing base", () => {
  const result = assessBranchFreshness("refs/heads/this-branch-does-not-exist-xyz");
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /missing-base/);
});
