import assert from "node:assert/strict";
import { test } from "node:test";

import { isWaitlistEmail } from "../waitlist-email.ts";

test("waitlist emails must look like addresses", () => {
  assert.equal(isWaitlistEmail("demo@meethint.ai"), true);
  assert.equal(isWaitlistEmail("  Maya@Host.COM "), true);
  assert.equal(isWaitlistEmail("not-an-email"), false);
  assert.equal(isWaitlistEmail(""), false);
});
