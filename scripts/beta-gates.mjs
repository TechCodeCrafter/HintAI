#!/usr/bin/env node
/**
 * Pre-external-beta verification gates.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const P95_TARGET_MS = 2000;

function run(label, command, args, opts = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", ...opts });
  if (result.status !== 0) {
    console.error(`[beta-gates] FAIL — ${label}`);
    process.exit(result.status ?? 1);
  }
  console.log(`[beta-gates] OK — ${label}`);
}

run("unit + src tests", process.execPath, ["scripts/run-tests.mjs"]);
run("typecheck", "npm", ["run", "typecheck"]);

const fixturePath = join(root, "fixtures/flight-sessions/real-session-latest.json");
const { parseFlightRecordsFromText, computeBetaQualityMetrics } = await import(
  join(root, "src/lib/instrumentation/beta-quality-report.ts")
);

const records = parseFlightRecordsFromText(readFileSync(fixturePath, "utf8"));
const metrics = computeBetaQualityMetrics({ flightRecords: records });
if (metrics.latencyP95 >= P95_TARGET_MS) {
  console.error(`[beta-gates] FAIL — supported answer p95 ${metrics.latencyP95}ms >= ${P95_TARGET_MS}ms`);
  process.exit(1);
}
console.log(`[beta-gates] OK — representative capture p95 ${metrics.latencyP95}ms < ${P95_TARGET_MS}ms`);

console.log("[beta-gates] Manual E2E still required: account-isolation, knowledge-space");
console.log("[beta-gates] All automated gates passed");
