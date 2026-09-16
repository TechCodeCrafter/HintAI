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
import { execSync } from "node:child_process";
import { findCursorAttributionLines } from "./cursor-attribution.mjs";

function parseBaseArg() {
  const idx = process.argv.indexOf("--base");
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  if (process.env.CURSOR_ATTRIBUTION_BASE) return process.env.CURSOR_ATTRIBUTION_BASE;
  return "origin/main";
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

/** Commits on HEAD since the branch diverged from base (handles cherry-picked PRs). */
function logRangeSince(base) {
  if (!gitRevExists(base)) return "HEAD";
  try {
    const mergeBase = execSync(`git merge-base ${shellQuote(base)} HEAD`, {
      encoding: "utf8",
    }).trim();
    if (mergeBase) return `${mergeBase}..HEAD`;
  } catch {
    /* unrelated histories — fall through */
  }
  try {
    execSync(`git merge-base --is-ancestor ${shellQuote(base)} HEAD`, { stdio: "ignore" });
    return `${base}..HEAD`;
  } catch {
    return "HEAD";
  }
}

function commitsSince(base) {
  const range = logRangeSince(base);
  let shas;
  try {
    shas = execSync(`git log ${range} --format=%H`, { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean);
  } catch {
    shas = execSync("git log HEAD --format=%H", { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean);
  }
  return shas.map((sha) => ({
    sha,
    body: execSync(`git log -1 --format=%B ${sha}`, { encoding: "utf8" }),
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
