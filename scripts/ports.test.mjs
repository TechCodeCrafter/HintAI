import assert from "node:assert/strict";
import { test } from "node:test";

import { DEV_PORT, PREVIEW_PORT } from "./ports.mjs";
import { E2E_PREVIEW_PORT, E2E_PREVIEW_URL } from "./e2e-preview-shared.mjs";

test("dev and e2e preview use the shared dev port", () => {
  assert.equal(DEV_PORT, 3001);
  assert.equal(E2E_PREVIEW_PORT, DEV_PORT);
  assert.equal(E2E_PREVIEW_URL, `http://127.0.0.1:${DEV_PORT}`);
  assert.equal(PREVIEW_PORT, 4173);
  assert.notEqual(PREVIEW_PORT, DEV_PORT);
});
