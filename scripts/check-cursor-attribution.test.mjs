#!/usr/bin/env node
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..");
const check = join(root, "check-cursor-attribution.mjs");

const dir = mkdtempSync(join(tmpdir(), "cursor-attrib-ci-"));
try {
  execSync("git init", { cwd: dir, stdio: "ignore" });
  execSync('git config user.email "test@example.com"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });

  execSync("git commit --allow-empty -m 'init'", { cwd: dir, stdio: "ignore" });
  const base = execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf8" }).trim();

  execSync(
    `git commit --allow-empty -m "$(cat <<'EOF'
clean commit

Co-authored-by: Jane Doe <jane@company.com>
EOF
)"`,
    { cwd: dir, shell: "/bin/bash", stdio: "ignore" },
  );

  execSync(`node ${check} --base ${base}`, { cwd: dir, stdio: "ignore" });

  let failed = false;
  try {
    execSync(
      `git commit --allow-empty -m "$(cat <<'EOF'
bad commit

Co-authored-by: Cursor <cursoragent@cursor.com>
EOF
)"`,
      { cwd: dir, shell: "/bin/bash", stdio: "ignore" },
    );
    execSync(`node ${check} --base ${base}`, { cwd: dir, stdio: "ignore" });
  } catch {
    failed = true;
  }
  assert.equal(failed, true, "CI check should fail when Cursor attribution is present");

  // Cherry-picked PR: base.sha exists on main but is not an ancestor of HEAD.
  execSync("git commit --allow-empty -m 'main-only'", { cwd: dir, stdio: "ignore" });
  const mainTip = execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf8" }).trim();
  execSync(`git checkout -b feature ${base}`, { cwd: dir, stdio: "ignore" });
  execSync("git commit --allow-empty -m 'feature-only'", { cwd: dir, stdio: "ignore" });
  execSync(`node ${check} --base ${mainTip}`, { cwd: dir, stdio: "ignore" });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("check-cursor-attribution.test.mjs: ok");
