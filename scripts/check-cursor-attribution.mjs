#!/usr/bin/env node
/**
 * CI guard: fail if Cursor-specific attribution appears in commits on a branch.
 * Local hooks cannot rewrite commits already pushed by remote/background agents.
 *
 * Usage:
 *   node scripts/check-cursor-attribution.mjs
 *   node scripts/check-cursor-attribution.mjs --base origin/main
 *
 * Env: CURSOR_ATTRIBUTION_BASE — override base ref (e.g. GITHUB_BASE_SHA in Actions)
 */
import { execFileSync } from "node:child_process";
import { findCursorAttributionLines } from "./cursor-attribution.mjs";

function parseBaseArg() {
  const idx = process.argv.indexOf("--base");
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  if (process.env.CURSOR_ATTRIBUTION_BASE) return process.env.CURSOR_ATTRIBUTION_BASE;
  return "origin/main";
}

// Argument arrays, no shell: POSIX single quotes reach git literally under cmd.exe.
function git(args, options = {}) {
  return execFileSync("git", args, { encoding: "utf8", ...options });
}

function gitRevExists(ref) {
  try {
    git(["rev-parse", "--verify", "--quiet", ref], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Commits on HEAD since the branch diverged from base (handles cherry-picked PRs). */
function logRangeSince(base) {
  if (!gitRevExists(base)) return "HEAD";
  try {
    const mergeBase = git(["merge-base", base, "HEAD"]).trim();
    if (mergeBase) return `${mergeBase}..HEAD`;
  } catch {
    /* unrelated histories — fall through */
  }
  try {
    git(["merge-base", "--is-ancestor", base, "HEAD"], { stdio: "ignore" });
    return `${base}..HEAD`;
  } catch {
    return "HEAD";
  }
}

function commitsSince(base) {
  const range = logRangeSince(base);
  let shas;
  try {
    shas = git(["log", range, "--format=%H"]).trim().split("\n").filter(Boolean);
  } catch {
    shas = git(["log", "HEAD", "--format=%H"]).trim().split("\n").filter(Boolean);
  }
  return shas.map((sha) => ({
    sha,
    body: git(["log", "-1", "--format=%B", sha]),
  }));
}

const base = parseBaseArg();
const violations = [];

for (const { sha, body } of commitsSince(base)) {
  const lines = findCursorAttributionLines(body);
  if (lines.length === 0) continue;
  violations.push({ sha: sha.slice(0, 7), lines });
}

if (violations.length === 0) {
  console.log(`[check-cursor-attribution] OK — no Cursor attribution since ${base}`);
  process.exit(0);
}

console.error(`[check-cursor-attribution] Found Cursor attribution in ${violations.length} commit(s) since ${base}:`);
for (const row of violations) {
  console.error(`  ${row.sha}:`);
  for (const line of row.lines) console.error(`    ${line.trim()}`);
}
console.error("\nRemove trailers or amend/rebase. Human Co-authored-by lines are allowed.");
process.exit(1);
