import assert from "node:assert/strict";
import { test } from "node:test";

import { firstTwoSentences } from "../generate-answer.ts";
import { splitClaimClauses } from "../claim-verify.ts";
import { isConfigHeavy } from "../../repo/folder.ts";

test("firstTwoSentences keeps periods and decimals", () => {
  assert.equal(firstTwoSentences("Timeout is 1.5 seconds. Retries are capped at three. Extra line."),
    "Timeout is 1.5 seconds. Retries are capped at three.");
  assert.equal(firstTwoSentences("One line only."), "One line only.");
  assert.equal(firstTwoSentences("  "), "");
});

test("clause split handles multi-word subjects after and", () => {
  assert.deepEqual(
    splitClaimClauses("Logs are kept for 30 days and PDF retention window is 90 days."),
    ["Logs are kept for 30 days", "PDF retention window is 90 days."],
  );
});

test("a single code file upload is not flagged as config-heavy", () => {
  assert.equal(isConfigHeavy(["retry.ts"]), false);
  assert.equal(isConfigHeavy([".github/workflows/ci.yml", "Dockerfile", "package.json", "index.ts"]), true);
  assert.equal(isConfigHeavy(["notes.md", "ci.yml", "Dockerfile"]), false);
});
