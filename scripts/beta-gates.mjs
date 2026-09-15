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
  if (!source.includes("signIn") || !source.includes("GROK_PROVIDERS")) {
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
  if (!boot.includes("isVerifiedAccountId") && !boot.includes("isAuthenticatedWorkspaceId")) {
    console.error("[beta-gates] FAIL — beta telemetry must gate on authenticated workspace ids");
    process.exit(1);
  }
  console.log("[beta-gates] OK — beta signup telemetry gated on verified accounts");
}

assertAuthEnabled();
assertLoginRoute();
assertRouteProtection();
assertNoDevUserFallbackInTelemetry();

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

console.log("[beta-gates] Manual E2E still required: auth-production, account-isolation, knowledge-space");
console.log("[beta-gates] All automated gates passed");
