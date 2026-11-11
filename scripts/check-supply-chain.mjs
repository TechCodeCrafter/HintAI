#!/usr/bin/env node
// Fails when the repo contains the patterns used by the Oct/Nov 2026 injection:
// editor tasks that run on folder open, npm scripts that call an unexpected
// root file, code hidden after long whitespace runs, and "fonts" that are text.
// Uses only Node built-ins so CI can run it before `npm ci`.
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const problems = [];

const tasks = ".vscode/tasks.json";
if (existsSync(tasks) && /folderOpen/.test(readFileSync(tasks, "utf8"))) {
  problems.push(`${tasks}: a task runs automatically on folder open`);
}
const settings = ".vscode/settings.json";
if (existsSync(settings) && /allowAutomaticTasks/.test(readFileSync(settings, "utf8"))) {
  problems.push(`${settings}: task.allowAutomaticTasks is set`);
}

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
  for (const m of String(cmd).matchAll(/\bnode\s+(?:--\S+\s+)*([^\s&|;]+)/g)) {
    const target = m[1];
    // Real entry points live in a folder (scripts/, src/, e2e/). A bare root
    // file such as `node init` is how the loader was wired in.
    if (!target.includes("/") && !target.startsWith("-")) {
      problems.push(`package.json scripts.${name}: runs root-level file "node ${target}"`);
    }
  }
}

const CODE = /\.(m?js|cjs|ts|tsx|jsx|json|mjs)$/;
const FONT = /\.(orc|woff2?|ttf|otf|eot)$/i;
for (const file of files) {
  if (!existsSync(file)) continue;
  if (FONT.test(file)) {
    const head = readFileSync(file).subarray(0, 4096).toString("latin1");
    if (/(function|require|eval|=>)/.test(head) && !/[\x00-\x08]/.test(head)) {
      problems.push(`${file}: font file contains script text`);
    }
    continue;
  }
  if (file.endsWith("package-lock.json")) continue;
  const extless = !file.split("/").pop().includes(".");
  if (!CODE.test(file) && !extless) continue;
  const buf = readFileSync(file);
  if (buf.length > 2_000_000 || buf.subarray(0, 4096).includes(0)) continue;
  buf.toString("utf8").split("\n").forEach((line, i) => {
    if (/[ \t]{60,}\S/.test(line) && line.length > 1000) {
      problems.push(`${file}:${i + 1}: code hidden after a long run of spaces`);
    }
  });
}

if (problems.length) {
  console.error("Supply-chain check failed:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log(`Supply-chain check passed (${files.length} files).`);
