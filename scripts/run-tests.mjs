#!/usr/bin/env node
/**
 * Runs every test group and reports all of them.
 *
 * These groups used to be chained with `&&`, which meant a failure in the first
 * group stopped the second from running at all — the entire src/ suite was
 * invisible whenever the plugin tests were red. Groups are independent, so they
 * all run; the exit code is non-zero if any of them failed.
 */
import { spawnSync } from "node:child_process";
import { globSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");

const srcTests = globSync("src/**/*.test.ts", { cwd: root }).sort();

const GROUPS = [
  {
    name: "plugin / scripts",
    command: process.execPath,
    args: ["--test", "scripts/**/*.test.mjs"],
  },
  {
    name: "src",
    command: process.execPath,
    args: ["--experimental-strip-types", "--test", ...srcTests],
  },
];

/** node --test prints a TAP-ish summary; these are the lines worth echoing. */
function tally(output) {
  const read = (label) => {
    const hit = output.match(new RegExp(`^# ${label} (\\d+)$`, "m"));
    return hit ? Number(hit[1]) : null;
  };
  return { tests: read("tests"), pass: read("pass"), fail: read("fail") };
}

const results = [];
for (const group of GROUPS) {
  console.log(`\n${"=".repeat(72)}\n${group.name} (${group.args.length - 2} files)\n${"=".repeat(72)}`);
  // 256 MB: the src group prints well over the 1 MB default, and an overflow
  // kills the child with no summary.
  const run = spawnSync(group.command, group.args, { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  process.stdout.write(output);
  const failing = [...output.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1]);
  if (run.error) failing.push(`runner error: ${run.error.message}`);
  results.push({ name: group.name, code: run.status ?? 1, failing, ...tally(output) });
}

console.log(`\n${"=".repeat(72)}\nTEST SUMMARY\n${"=".repeat(72)}`);
for (const r of results) {
  const counts = r.tests === null ? "no summary" : `${r.pass}/${r.tests} passed, ${r.fail} failed`;
  console.log(`  ${r.code === 0 ? "PASS" : "FAIL"}  ${r.name.padEnd(40)} ${counts}`);
  for (const name of r.failing) console.log(`        not ok  ${name}`);
}

const failed = results.filter((r) => r.code !== 0);
console.log(
  failed.length
    ? `\nAGGREGATE  FAIL — ${failed.map((r) => r.name).join(", ")}`
    : "\nAGGREGATE  PASS",
);
// exitCode, not exit(): on a pipe (CI) stdout is async, and exit() drops
// whatever has not flushed yet, which is how the summary went missing.
process.exitCode = failed.length ? 1 : 0;
