#!/usr/bin/env node
/**
 * Verify a live deploy exposes the expected git commit via `/api/deploy/status`.
 *
 * Usage:
 *   node scripts/verify-production-deploy.mjs
 *   node scripts/verify-production-deploy.mjs --expect e208528
 *   node scripts/verify-production-deploy.mjs --base https://www.meethint.ai --expect e208528
 */
import { execSync } from "node:child_process";
import { isMainModule } from "./with-app-env.mjs";

const DEFAULT_BASE = "https://www.meethint.ai";

function parseArg(argv, flag) {
  const idx = argv.indexOf(flag);
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1];
  return undefined;
}

function parseBase(argv) {
  const fromFlag = parseArg(argv, "--base");
  const base = fromFlag ?? process.env.MEETHINT_DEPLOY_BASE_URL ?? DEFAULT_BASE;
  return base.replace(/\/+$/, "");
}

function normalizeSha(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function shaMatches(actual, expected) {
  const a = normalizeSha(actual);
  const e = normalizeSha(expected);
  if (!a || !e) return false;
  return a === e || a.startsWith(e) || e.startsWith(a);
}

/** @param {string | undefined} expect */
export function resolveExpectedCommit(expect) {
  if (expect) return expect;
  try {
    return execSync("git rev-parse --short HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

export async function verifyProductionDeploy(baseUrl, options = {}, fetchImpl = fetch) {
  const expect = resolveExpectedCommit(options.expect);
  const report = {
    baseUrl,
    expected: expect ?? null,
    deploy: null,
    blockers: [],
  };

  let res;
  try {
    res = await fetchImpl(`${baseUrl}/api/deploy/status`, {
      headers: { accept: "application/json" },
    });
  } catch (error) {
    report.blockers.push(`deploy-status-unreachable:${error instanceof Error ? error.message : String(error)}`);
    return report;
  }

  if (!res.ok) {
    report.blockers.push(`deploy-status-http-${res.status}`);
    return report;
  }

  report.deploy = await res.json();

  if (!expect) {
    report.blockers.push("missing-expected-commit-pass---expect-or-local-git");
    return report;
  }

  const candidates = [
    report.deploy?.commitSha,
    report.deploy?.appVersion,
  ].filter(Boolean);

  if (candidates.length === 0) {
    report.blockers.push("deploy-status-missing-commit-fields");
    return report;
  }

  const matched = candidates.some((value) => shaMatches(value, expect));
  if (!matched) {
    report.blockers.push(
      `commit-mismatch:live=${candidates.join("|")} expected=${expect}`,
    );
  }

  return report;
}

function printReport(report) {
  console.log(JSON.stringify(report, null, 2));
  if (report.blockers.length === 0) {
    console.log("[verify-production-deploy] OK — live deploy matches expected commit");
    return 0;
  }
  console.error(`[verify-production-deploy] FAIL — ${report.blockers.join(", ")}`);
  return 1;
}

async function main(argv) {
  const baseUrl = parseBase(argv);
  const expect = parseArg(argv, "--expect");
  const report = await verifyProductionDeploy(baseUrl, { expect });
  process.exit(printReport(report));
}

if (isMainModule(import.meta.url)) {
  await main(process.argv.slice(2));
}
