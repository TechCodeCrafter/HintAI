import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { isClaimLine, looksLikeClaim } from "../claim-gate.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../claim-gate.ts");

test("the claim gate is a pure function with no model", () => {
  const source = readFileSync(root, "utf8");
  assert.doesNotMatch(source, /prompt|craftCard|generateAnswer|localCard|__extract/i);
  assert.equal(isClaimLine("can you hear me"), false);
  assert.equal(isClaimLine("thanks"), false);
  assert.equal(isClaimLine("auth handles 10k RPS"), true);
  assert.equal(looksLikeClaim("auth handles 10k RPS"), true);
});

test("questions stay on the Search path", () => {
  assert.equal(isClaimLine("Why does that retry three times?"), false);
  assert.equal(isClaimLine("What did we change in the exporter?"), false);
});
