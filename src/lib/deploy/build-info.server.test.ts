import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { readDeployBuildInfo } from "./build-info.server.ts";

const ENV_KEYS = [
  "VITE_APP_VERSION",
  "VERCEL_GIT_COMMIT_SHA",
  "VERCEL_GIT_COMMIT_REF",
  "VERCEL_DEPLOYMENT_ID",
  "GIT_COMMIT",
  "GIT_BRANCH",
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

test("readDeployBuildInfo prefers VITE_APP_VERSION and Vercel SHA", () => {
  process.env.VITE_APP_VERSION = "e208528";
  process.env.VERCEL_GIT_COMMIT_SHA = "e208528179d4ec84470430bb98a051ce76c7f21c";
  process.env.VERCEL_GIT_COMMIT_REF = "main";
  process.env.VERCEL_DEPLOYMENT_ID = "dpl_test";

  const info = readDeployBuildInfo();
  assert.equal(info.appVersion, "e208528");
  assert.equal(info.commitSha, "e208528179d4ec84470430bb98a051ce76c7f21c");
  assert.equal(info.commitRef, "main");
  assert.equal(info.vercelDeploymentId, "dpl_test");
});
