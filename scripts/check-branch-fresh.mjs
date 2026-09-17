#!/usr/bin/env node
/**
 * Fail when the current branch does not contain the latest `origin/main`.
 * Prevents duplicate PRs opened from stale bases (see #58/#59/#60 retries).
 *
 * Usage:
 *   node scripts/check-branch-fresh.mjs
 *   node scripts/check-branch-fresh.mjs --base origin/main
 */
import { execSync } from "node:child_process";
import { isMainModule } from "./with-app-env.mjs";

function parseBase(argv) {
  const idx = argv.indexOf("--base");
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1];
  return process.env.BRANCH_FRESH_BASE ?? "origin/main";
}

function shellQuote(ref) {
  return `'${String(ref).replace(/'/g, "'\\''")}'`;
}

function gitRevExists(ref) {
  try {
    execSync(`git rev-parse --verify ${shellQuote(ref)}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function shortRef(ref) {
  try {
    return execSync(`git rev-parse --short ${shellQuote(ref)}`, { encoding: "utf8" }).trim();
  } catch {
    return ref;
  }
}

/** @param {string} base */
export function assessBranchFreshness(base) {
  if (!gitRevExists("HEAD")) {
    return { ok: false, base, reason: "missing-head" };
  }
  if (!gitRevExists(base)) {
    return { ok: false, base, reason: `missing-base:${base}` };
  }

  try {
    execSync(`git merge-base --is-ancestor ${shellQuote(base)} HEAD`, { stdio: "ignore" });
    return { ok: true, base, head: shortRef("HEAD"), baseSha: shortRef(base) };
  } catch {
    return {
      ok: false,
      base,
      head: shortRef("HEAD"),
      baseSha: shortRef(base),
      reason: "branch-behind-base",
    };
  }
}

function main(argv) {
  const base = parseBase(argv);
  const result = assessBranchFreshness(base);
  if (result.ok) {
    console.log(
      `[check-branch-fresh] OK — ${result.head} contains ${result.baseSha} (${base})`,
    );
    process.exit(0);
  }

  console.error(`[check-branch-fresh] FAIL — ${result.reason ?? "stale-branch"}`);
  console.error(
    `  Rebase or merge ${base} before opening a PR: git fetch origin && git merge ${base}`,
  );
  process.exit(1);
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2));
}
