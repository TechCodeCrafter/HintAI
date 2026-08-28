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

const GROUPS = [
  {
    name: "plugin / scripts",
    command: process.execPath,
    args: ["--test", "scripts/**/*.test.mjs"],
  },
  {
    name: "src (gate, transcript identity, cards)",
    command: process.execPath,
    args: [
      "--experimental-strip-types",
      "--test",
      "src/lib/app-data/app-data.test.ts",
      "src/lib/auth/gate-identity.test.ts",
      "src/lib/search/gate.test.ts",
      "src/lib/search/retrieve.test.ts",
      "src/lib/search/intent.test.ts",
      "src/lib/search/subject.test.ts",
      "src/lib/search/spoken.test.ts",
      "src/lib/search/thread.test.ts",
      "src/lib/search/gate-newest.test.ts",
      "src/lib/listen/transcript-events.test.ts",
      "src/lib/listen/ring.test.ts",
      "src/lib/listen/vad.test.ts",
      "src/lib/search/prose.test.ts",
      "src/lib/search/card.test.ts",
    ],
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
  console.log(`\n${"=".repeat(72)}\n${group.name}\n${"=".repeat(72)}`);
  const run = spawnSync(group.command, group.args, { encoding: "utf8" });
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  process.stdout.write(output);
  results.push({ name: group.name, code: run.status ?? 1, ...tally(output) });
}

console.log(`\n${"=".repeat(72)}\nTEST SUMMARY\n${"=".repeat(72)}`);
for (const r of results) {
  const counts = r.tests === null ? "no summary" : `${r.pass}/${r.tests} passed, ${r.fail} failed`;
  console.log(`  ${r.code === 0 ? "PASS" : "FAIL"}  ${r.name.padEnd(40)} ${counts}`);
}

const failed = results.filter((r) => r.code !== 0);
console.log(
  failed.length
    ? `\nAGGREGATE  FAIL — ${failed.map((r) => r.name).join(", ")}`
    : "\nAGGREGATE  PASS",
);
process.exit(failed.length ? 1 : 0);
