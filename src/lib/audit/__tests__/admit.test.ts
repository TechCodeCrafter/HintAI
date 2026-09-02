import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { NORTHSTAR } from "../../repo/northstar.ts";
import { buildChunks } from "../../search/retrieve.ts";
import { claimAdmit } from "../admit.ts";

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../admit.ts"), "utf8");
const chunks = buildChunks(NORTHSTAR);

test("claimAdmit does not compose a new sentence", () => {
  assert.doesNotMatch(source, /localCard\(|generateAnswer|craftCard/);
});

test("a true statement from retry.ts or the ADR goes green with a real range", () => {
  const admitted = claimAdmit(
    "Attempts are capped at three because the payment gateway stalls rather than failing fast",
    NORTHSTAR,
    chunks,
  );
  assert.equal(admitted.status, "supported");
  assert.equal(admitted.evidence?.length, 1);
  const evidence = admitted.evidence?.[0];
  assert.ok(evidence && evidence.kind === "text");
  assert.match(evidence.path, /src\/exporter\/retry\.ts|docs\/adr\/0007-exporter-retries\.md/);
  assert.ok(evidence.startLine >= 1);
  assert.ok(evidence.endLine >= evidence.startLine);
});

test("unsupported speech stays yellow with no citation", () => {
  for (const line of ["SSO by Q2", "The capital of France is Paris"]) {
    const admitted = claimAdmit(line, NORTHSTAR, chunks);
    assert.equal(admitted.status, "unverified", line);
    assert.equal(admitted.evidence, null, line);
  }
});
