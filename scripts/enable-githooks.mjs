#!/usr/bin/env node
/** Enable repo githooks that strip Cursor commit attribution. Idempotent. */
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

try {
  execSync("git rev-parse --git-dir", { cwd: root, stdio: "ignore" });
} catch {
  console.log("[enable-githooks] Not a git repository — skipping.");
  process.exit(0);
}

const target = ".githooks";
const current = execSync("git config core.hooksPath", { cwd: root, encoding: "utf8" }).trim();
if (current === target) {
  console.log(`[enable-githooks] core.hooksPath already ${target}`);
} else {
  execSync(`git config core.hooksPath ${target}`, { cwd: root });
  console.log(`[enable-githooks] Set core.hooksPath=${target}`);
}
