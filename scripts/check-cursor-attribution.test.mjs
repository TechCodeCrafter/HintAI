#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..");
const check = join(root, "check-cursor-attribution.mjs");

const dir = mkdtempSync(join(tmpdir(), "cursor-attrib-ci-"));
// Argument arrays, no shell, so the multi-line messages work on Windows too.
const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const runCheck = (base) => execFileSync(process.execPath, [check, "--base", base], { cwd: dir, stdio: "ignore" });

try {
  git("init");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");

  git("commit", "--allow-empty", "-m", "init");
  const base = git("rev-parse", "HEAD").trim();

  git("commit", "--allow-empty", "-m", "clean commit\n\nCo-authored-by: Jane Doe <jane@company.com>");
  runCheck(base);

  git("commit", "--allow-empty", "-m", "bad commit\n\nCo-authored-by: Cursor <cursoragent@cursor.com>");
  assert.throws(() => runCheck(base), "CI check should fail when Cursor attribution is present");

  // Cherry-picked PR: base.sha exists on main but is not an ancestor of HEAD.
  git("commit", "--allow-empty", "-m", "main-only");
  const mainTip = git("rev-parse", "HEAD").trim();
  git("checkout", "-b", "feature", base);
  git("commit", "--allow-empty", "-m", "feature-only");
  runCheck(mainTip);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("check-cursor-attribution.test.mjs: ok");
