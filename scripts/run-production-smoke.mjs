#!/usr/bin/env node
/**
 * Run #110 Fresh Account Production Smoke against the deployed app.
 *
 * Phase 1 (no credentials): logged-out probes via Playwright + verify-production-auth.
 * Phase 2 (requires OAuth storage state): full smoke via production-smoke.spec.ts
 *
 * Setup OAuth Chrome profiles:
 *   node scripts/capture-smoke-auth.mjs a
 *   node scripts/capture-smoke-auth.mjs b
 *
 * Run:
 *   node scripts/run-production-smoke.mjs
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { isMainModule, projectRoot } from "./with-app-env.mjs";
import { verifyProductionAuth } from "./verify-production-auth.mjs";

const root = projectRoot();
const baseURL = (process.env.PLAYWRIGHT_BASE_URL ?? "https://www.meethint.ai").replace(/\/$/, "");
const reportMd = join(root, "docs/FRESH-ACCOUNT-PRODUCTION-SMOKE.md");
const reportJson = join(root, ".grok/production-smoke-run.json");
const specReportPath = join(root, ".grok/production-smoke-report.json");

function run(label, command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, PLAYWRIGHT_BASE_URL: baseURL, ...env },
  });
  return { label, ok: result.status === 0, code: result.status ?? 1 };
}

function defaultProfile(user) {
  const fromEnv = process.env[`MEETHINT_SMOKE_PROFILE_${user.toUpperCase()}`]?.trim();
  return fromEnv ?? join(root, ".grok", `smoke-profile-${user}`);
}

function seedSpecReport(runId) {
  mkdirSync(join(root, ".grok"), { recursive: true });
  writeFileSync(
    specReportPath,
    JSON.stringify(
      {
        runId,
        executed: false,
        ticket: "#110",
        url: baseURL,
        status: "pending",
        steps: {},
        recordedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

function readSpecReportForRun(runId) {
  if (!existsSync(specReportPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(specReportPath, "utf8"));
    if (parsed.runId !== runId) return null;
    if (!parsed.executed) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function main() {
  const runId = randomUUID();
  const profileA = defaultProfile("a");
  const profileB = defaultProfile("b");
  const hasA = existsSync(profileA);
  const hasB = existsSync(profileB);
  const hasSmokeKey = Boolean(process.env.MEETHINT_SMOKE_OPENAI_API_KEY?.trim());

  const authProbe = await verifyProductionAuth(baseURL);
  const preauth = run("preauth", "npx", [
    "playwright",
    "test",
    "e2e/production-smoke-preauth.spec.ts",
    "--config=playwright.production-smoke.config.ts",
    "--project=chrome",
  ]);

  let authVerify = { label: "auth-verify", ok: true, code: 0, skipped: true };
  if (hasA) {
    authVerify = {
      ...run("auth-verify", "node", ["scripts/verify-smoke-auth.mjs", "a", ...(hasB ? ["b"] : [])]),
      skipped: false,
    };
  }

  let full = { label: "full-smoke", ok: false, code: 1, skipped: true };
  if (hasA && hasSmokeKey && authVerify.ok) {
    seedSpecReport(runId);
    full = {
      ...run("full-smoke", "npx", [
        "playwright",
        "test",
        "e2e/production-smoke.spec.ts",
        "--config=playwright.production-smoke.config.ts",
        "--project=chrome",
      ], {
        MEETHINT_SMOKE_PROFILE_A: profileA,
        MEETHINT_SMOKE_PROFILE_B: hasB ? profileB : "",
        MEETHINT_SMOKE_RUN_ID: runId,
      }),
      skipped: false,
    };
  }

  const specReport = full.skipped ? null : readSpecReportForRun(runId);
  const smokeExecuted = Boolean(specReport?.executed);

  const preauthPass = preauth.ok && authProbe.blockers.length === 0;
  const fullPass = full.ok && smokeExecuted && specReport?.result === "PASS";
  const isolationPass = specReport?.steps?.["cross-user-isolation"] === "PASS";
  const overallPass = preauthPass && fullPass && isolationPass;

  const blockers = [];
  if (authProbe.blockers.length) blockers.push(...authProbe.blockers.map((b) => `auth-probe:${b}`));
  if (!preauth.ok) blockers.push("preauth-playwright-failed");
  if (!hasA) blockers.push("BLOCKER:missing-oauth-profile-a — run capture-smoke-auth.mjs a");
  else if (!authVerify.ok) {
    blockers.push(
      "BLOCKER:smoke-auth-a-b-not-distinct — capture User B with a different Google smoke account: node scripts/capture-smoke-auth.mjs b --fresh",
    );
  } else if (!hasSmokeKey) {
    blockers.push("BLOCKER:missing-MEETHINT_SMOKE_OPENAI_API_KEY — inject at runtime, not in auth JSON");
  } else if (full.skipped) {
    blockers.push("BLOCKER:authenticated-smoke-not-executed");
  } else if (!smokeExecuted) {
    blockers.push("BLOCKER:authenticated-smoke-report-missing — spec did not write a matching run report");
  } else if (!full.ok || specReport?.result === "FAIL") {
    blockers.push("full-smoke-failed");
  } else if (!isolationPass) {
    blockers.push("BLOCKER:cross-user-isolation-failed");
  }
  if (!hasB) blockers.push("BLOCKER:missing-oauth-profile-b — run capture-smoke-auth.mjs b");

  const summary = {
    runId,
    ticket: "#110",
    url: baseURL,
    browser: "Playwright Desktop Chrome",
    profile: hasA ? "Chrome persistent profile (.grok/smoke-profile-{a|b})" : "clean (preauth only)",
    authVerify: hasA ? (authVerify.ok ? "PASS" : "FAIL") : "SKIP",
    accountType: hasA ? "Google OAuth production account" : "none — setup required",
    preauth: preauthPass ? "PASS" : "FAIL",
    fullSmoke: hasA && hasSmokeKey && authVerify.ok ? (smokeExecuted ? (fullPass ? "PASS" : "FAIL") : "NOT_EXECUTED") : "SKIP",
    smokeExecuted,
    result: overallPass ? "PASS" : "FAIL",
    blockers,
    authProbe,
    specReport,
    recordedAt: new Date().toISOString(),
  };

  mkdirSync(join(root, ".grok"), { recursive: true });
  writeFileSync(reportJson, JSON.stringify(summary, null, 2));
  writeReportMarkdown(summary);

  console.log(`\n[production-smoke] ${overallPass ? "PASS" : "FAIL"} — report: docs/FRESH-ACCOUNT-PRODUCTION-SMOKE.md`);
  process.exit(overallPass ? 0 : 1);
}

function writeReportMarkdown(summary) {
  const spec = summary.specReport;
  const steps = spec?.steps ? { ...spec.steps } : {};

  if (!summary.smokeExecuted) {
    Object.assign(steps, {
      "authenticated-smoke": "NOT_EXECUTED",
    });
  }

  if (summary.authVerify === "FAIL") {
    steps["auth-verify-a-b-distinct"] = "FAIL";
    if (!steps["cross-user-isolation"]) {
      steps["cross-user-isolation"] = "SKIP (same Google account on A and B)";
    }
  }

  if (Object.keys(steps).length === 0) {
    Object.assign(steps, {
      "1-logged-out-redirect": summary.preauth === "PASS" ? "PASS" : "FAIL",
      "2-public-login": summary.preauth === "PASS" ? "PASS" : "FAIL",
      "3-oauth-ready": summary.authProbe.blockers.length === 0 ? "PASS" : "FAIL",
      "4-null-session": summary.preauth === "PASS" ? "PASS" : "FAIL",
      "5-full-smoke": summary.fullSmoke,
    });
  }

  const timings = spec?.timings ?? {};

  const lines = [
    "# Fresh Account Production Smoke (#110)",
    "",
    `**Recorded:** ${summary.recordedAt.slice(0, 19)}Z`,
    `**Run ID:** ${summary.runId}`,
    `**URL:** ${summary.url}`,
    `**Browser / profile:** ${summary.browser} — ${summary.profile}`,
    `**Account type:** ${summary.accountType}`,
    `**Auth A/B verify:** ${summary.authVerify ?? "—"}`,
    `**Authenticated smoke executed:** ${summary.smokeExecuted ? "yes" : "no"}`,
    "",
    `## Result: ${summary.result === "PASS" ? "✅ PASS" : "❌ FAIL"}`,
    "",
    "### Step results",
    "",
    "| Step | Result |",
    "| --- | --- |",
  ];

  for (const [step, result] of Object.entries(steps)) {
    lines.push(`| ${step} | ${result} |`);
  }

  lines.push(
    "",
    "### Timings",
    "",
    "| Metric | Value |",
    "| --- | --- |",
    `| login time | ${timings.loginMs ?? "—"} ms |`,
    `| index ready | ${timings.indexReadyMs ?? "—"} ms |`,
    `| time to first useful answer | ${timings.firstUsefulAnswerMs ?? "—"} ms |`,
    `| supported answers | ${timings.supportedAnswerCount ?? "—"} |`,
    `| unsupported confident (bad) | ${timings.unsupportedConfidentCount ?? "—"} |`,
    `| live p50 | ${timings.liveP50Ms ?? "—"} ms |`,
    `| live p95 | ${timings.liveP95Ms ?? "—"} ms |`,
    "",
    "### Issues",
    "",
  );

  if (summary.blockers.length === 0) {
    lines.push("None.");
  } else {
    for (const issue of summary.blockers) {
      const severity = issue.startsWith("BLOCKER") ? "BLOCKER" : issue.includes("MEDIUM") ? "MEDIUM" : "HIGH";
      lines.push(`- **${severity}:** ${issue}`);
    }
  }

  lines.push(
    "",
    "### How to run",
    "",
    "```bash",
    "node scripts/capture-smoke-auth.mjs a",
    "node scripts/capture-smoke-auth.mjs b --fresh   # different Google smoke account than A",
    "export MEETHINT_SMOKE_OPENAI_API_KEY=\"sk-...\"",
    "node scripts/run-production-smoke.mjs",
    "```",
    "",
    "**Ticket #110:** " + (summary.result === "PASS" ? "✅ COMPLETE" : "❌ FAIL"),
    "**Next:** " + (summary.result === "PASS" ? "#115 Beta Wave 1" : "Fix blockers and re-run smoke"),
  );

  writeFileSync(reportMd, lines.join("\n") + "\n");
}

if (isMainModule(import.meta.url)) {
  await main();
}
