import assert from "node:assert/strict";
import { test } from "node:test";

import { assessBranchFreshness } from "./check-branch-fresh.mjs";

test("assessBranchFreshness ok when base is ancestor of HEAD", () => {
  // HEAD~1 is missing in shallow CI checkouts (depth 1); HEAD is always its own ancestor.
  const result = assessBranchFreshness("HEAD");
  assert.equal(result.ok, true);
});

test("assessBranchFreshness fails for missing base", () => {
  const result = assessBranchFreshness("refs/heads/this-branch-does-not-exist-xyz");
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /missing-base/);
});
