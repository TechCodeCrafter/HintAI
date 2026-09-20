#!/usr/bin/env node
/**
 * Pre-external-beta verification gates.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { authEnabledFromEnvValue, buildAuthEnabled } from "./check-auth-invariant.mjs";
import { readAppEnv } from "./with-app-env.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const P95_TARGET_MS = 2000;

function run(label, command, args, opts = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", ...opts });
  if (result.status !== 0) {
    console.error(`[beta-gates] FAIL — ${label}`);
    process.exit(result.status ?? 1);
  }
  console.log(`[beta-gates] OK — ${label}`);
}

function assertAuthEnabled() {
  const appEnv = readAppEnv(root);
  if (!authEnabledFromEnvValue(appEnv.VITE_AUTH_ENABLED)) {
    console.error("[beta-gates] FAIL — VITE_AUTH_ENABLED must not be false for beta");
    process.exit(1);
  }
  if (!buildAuthEnabled(root)) {
    console.error("[beta-gates] FAIL — next build resolves auth disabled");
    process.exit(1);
  }
  console.log("[beta-gates] OK — auth enabled in app-env and build");
}

function assertLoginRoute() {
  const loginRoute = join(root, "src/routes/login.tsx");
  const loginPage = join(root, "src/components/login-page.tsx");
  if (!existsSync(loginRoute) || !existsSync(loginPage)) {
    console.error("[beta-gates] FAIL — login route/page is missing");
    process.exit(1);
  }
  const source = readFileSync(loginPage, "utf8");
  const hasOAuthSignIn =
    source.includes("signIn") &&
    (source.includes("GROK_PROVIDERS") || source.includes("signInWithGoogle"));
  if (!hasOAuthSignIn) {
    console.error("[beta-gates] FAIL — login page must wire OAuth sign-in");
    process.exit(1);
  }
  console.log("[beta-gates] OK — login route present");
}

function assertRouteProtection() {
  const protectedRoutes = ["home.tsx", "app.tsx", "create.tsx", "context.$id.tsx"];
  for (const file of protectedRoutes) {
    const path = join(root, "src/routes", file);
    const source = readFileSync(path, "utf8");
    if (!source.includes("RequireAuth")) {
      console.error(`[beta-gates] FAIL — ${file} is not wrapped in RequireAuth`);
      process.exit(1);
    }
  }
  console.log("[beta-gates] OK — protected routes require auth");
}

function assertNoDevUserFallbackInTelemetry() {
  const boot = readFileSync(join(root, "src/components/beta-telemetry-boot.tsx"), "utf8");
  const gate = readFileSync(join(root, "src/lib/instrumentation/authenticated-signup-gate.ts"), "utf8");
  const gated =
    boot.includes("shouldRecordAuthenticatedSignup") &&
    gate.includes("isAuthenticatedWorkspaceId");
  if (!gated) {
    console.error("[beta-gates] FAIL — beta telemetry must gate on authenticated workspace ids");
    process.exit(1);
  }
  console.log("[beta-gates] OK — beta signup telemetry gated on verified accounts");
}

assertAuthEnabled();
assertLoginRoute();
assertRouteProtection();
assertNoDevUserFallbackInTelemetry();

async function assertProductionSynthesisNeverDevUser() {
  const guardPath = join(root, "src/lib/ai/synthesis-guard.server.ts");
  const { synthesisAuthRequired, requireSynthesisUserId } = await import(guardPath);
  const saved = { ...process.env };
  try {
    process.env.NODE_ENV = "production";
    delete process.env.DATABASE_URL;
    delete process.env.SYNTHESIS_DEV_BYPASS;
    delete process.env.SYNTHESIS_REQUIRE_AUTH;
    delete process.env.VITE_AUTH_ENABLED;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GROK_AUTH_CLIENT_SECRET;
    if (!synthesisAuthRequired()) {
      console.error("[beta-gates] FAIL — synthesis auth must be required in production");
      process.exit(1);
    }
    let devUserFallback = false;
    try {
      const id = requireSynthesisUserId(undefined);
      devUserFallback = id === "dev-user";
    } catch {
      /* expected — anonymous synthesis rejected */
    }
    if (devUserFallback) {
      console.error("[beta-gates] FAIL — production synthesis must not resolve dev-user");
      process.exit(1);
    }
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in saved)) delete process.env[key];
    }
    Object.assign(process.env, saved);
  }
  console.log("[beta-gates] OK — production synthesis rejects anonymous callers");
}

await assertProductionSynthesisNeverDevUser();

run("production auth build invariant", process.execPath, ["scripts/check-production-auth-build.mjs"]);

run("unit + src tests", process.execPath, ["scripts/run-tests.mjs"]);
run("typecheck", "npm", ["run", "typecheck"]);

const fixturePath = join(root, "fixtures/flight-sessions/real-session-latest.json");
const { parseFlightRecordsFromText, computeBetaQualityMetrics } = await import(
  join(root, "src/lib/instrumentation/beta-quality-report.ts")
);

const records = parseFlightRecordsFromText(readFileSync(fixturePath, "utf8"));
const metrics = computeBetaQualityMetrics({ flightRecords: records });
if (metrics.latencyP95 >= P95_TARGET_MS) {
  console.error(`[beta-gates] FAIL — supported answer p95 ${metrics.latencyP95}ms >= ${P95_TARGET_MS}ms`);
  process.exit(1);
}
console.log(`[beta-gates] OK — representative capture p95 ${metrics.latencyP95}ms < ${P95_TARGET_MS}ms`);

const e2eArgs = (spec) => [
  "playwright",
  "test",
  spec,
  "--project=chromium",
  "--workers=1",
  "--retries=2",
];

run("auth configuration E2E", "npx", e2eArgs("e2e/auth-config.spec.ts"));

run("private workspace isolation E2E", "npx", e2eArgs("e2e/private-workspace.spec.ts"));

run("authenticated persistence E2E", "npx", e2eArgs("e2e/authenticated-persistence.spec.ts"));

run("Knowledge Space E2E", "npx", e2eArgs("e2e/knowledge-space.spec.ts"));

run("delete Knowledge Space UX E2E", "npx", e2eArgs("e2e/delete-space.spec.ts"));

run("authenticated signup telemetry E2E", "npx", e2eArgs("e2e/signup-telemetry.spec.ts"));

console.log("[beta-gates] All automated gates passed");
