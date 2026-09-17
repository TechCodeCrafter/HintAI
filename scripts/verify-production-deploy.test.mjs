import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveExpectedCommit, verifyProductionDeploy } from "./verify-production-deploy.mjs";

test("resolveExpectedCommit returns explicit expect unchanged", () => {
  assert.equal(resolveExpectedCommit("e208528"), "e208528");
});

test("verifyProductionDeploy passes when live commit matches expect", async () => {
  const report = await verifyProductionDeploy(
    "https://example.test",
    { expect: "e208528" },
    async () =>
      new Response(
        JSON.stringify({
          appVersion: "e208528",
          commitSha: "e208528179d4ec84470430bb98a051ce76c7f21c",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );
  assert.deepEqual(report.blockers, []);
});

test("verifyProductionDeploy fails on commit mismatch", async () => {
  const report = await verifyProductionDeploy(
    "https://example.test",
    { expect: "e208528" },
    async () =>
      new Response(JSON.stringify({ appVersion: "aaaaaaa" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  assert.ok(report.blockers.some((row) => row.startsWith("commit-mismatch")));
});
