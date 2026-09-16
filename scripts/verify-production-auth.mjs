#!/usr/bin/env node
/**
 * Verify deployed auth configuration at a live base URL (staging/production).
 *
 * Usage:
 *   node scripts/verify-production-auth.mjs
 *   node scripts/verify-production-auth.mjs --base https://www.meethint.ai
 */
import { isMainModule } from "./with-app-env.mjs";

const DEFAULT_BASE = "https://www.meethint.ai";

function parseBase(argv) {
  const idx = argv.indexOf("--base");
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1].replace(/\/+$/, "");
  return (process.env.MEETHINT_AUTH_BASE_URL ?? DEFAULT_BASE).replace(/\/+$/, "");
}

/** Normalize legacy `/api/auth/status` payloads (pre-#113) for verification. */
export function normalizeAuthStatus(raw) {
  if (raw && typeof raw.authEnabled === "boolean") return raw;
  const oauthReady = Boolean(raw?.oauthReady);
  const googleDirect = Boolean(raw?.googleDirect);
  const reason = raw?.reason ?? null;
  return {
    ...raw,
    authEnabled: oauthReady,
    authConfigured: googleDirect || oauthReady,
    devUserFallbackBlocked: oauthReady,
    oauthReady,
    googleDirect,
    failClosedOnMisconfig: false,
    blockers: reason ? [reason] : [],
    legacyStatusShape: true,
  };
}

export async function verifyProductionAuth(baseUrl, fetchImpl = fetch) {
  const report = {
    baseUrl,
    status: null,
    session: null,
    publicLoginOk: false,
    blockers: [],
  };

  let statusRes;
  try {
    statusRes = await fetchImpl(`${baseUrl}/api/auth/status`);
  } catch (error) {
    report.blockers.push(`status-unreachable:${error instanceof Error ? error.message : String(error)}`);
    return report;
  }

  if (!statusRes.ok) {
    report.blockers.push(`status-http-${statusRes.status}`);
    return report;
  }

  report.status = normalizeAuthStatus(await statusRes.json());
  if (!report.status.authEnabled) report.blockers.push("auth-disabled");
  if (!report.status.devUserFallbackBlocked) report.blockers.push("dev-user-fallback-not-blocked");
  if (!report.status.oauthReady) report.blockers.push(report.status.reason ?? "oauth-not-ready");
  if (report.status.failClosedOnMisconfig) report.blockers.push("fail-closed-misconfig-active");

  try {
    const sessionRes = await fetchImpl(`${baseUrl}/api/auth/get-session`, {
      headers: { accept: "application/json" },
    });
    if (!sessionRes.ok) {
      report.blockers.push(`get-session-http-${sessionRes.status}`);
    } else {
      report.session = await sessionRes.json();
      if (report.session?.user?.id === "dev-user") {
        report.blockers.push("get-session-returned-dev-user");
      }
    }
  } catch (error) {
    report.blockers.push(`get-session-unreachable:${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const loginRes = await fetchImpl(`${baseUrl}/login`);
    report.publicLoginOk = loginRes.ok;
    if (!loginRes.ok) report.blockers.push(`login-http-${loginRes.status}`);
  } catch (error) {
    report.blockers.push(`login-unreachable:${error instanceof Error ? error.message : String(error)}`);
  }

  return report;
}

function printReport(report) {
  console.log(JSON.stringify(report, null, 2));
  if (report.blockers.length === 0) {
    console.log("[verify-production-auth] OK — deployed auth configuration verified");
    return 0;
  }
  console.error(`[verify-production-auth] FAIL — ${report.blockers.join(", ")}`);
  return 1;
}

async function main(argv) {
  const baseUrl = parseBase(argv);
  const report = await verifyProductionAuth(baseUrl);
  process.exit(printReport(report));
}

if (isMainModule(import.meta.url)) {
  await main(process.argv.slice(2));
}
