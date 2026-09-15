#!/usr/bin/env node
/**
 * Internal closed-beta quality report from exported diagnostics or local flight fixtures.
 *
 *   node scripts/beta-quality-report.mjs
 *   node scripts/beta-quality-report.mjs --flight fixtures/flight-sessions/real-session-latest.json
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const { formatBetaQualityReport, computeBetaQualityMetrics, parseFlightRecordsFromText } =
  await import(join(root, "src/lib/instrumentation/beta-quality-report.ts"));

function readArg(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

const flightPath = readArg("--flight");
const flightRecords = flightPath ? parseFlightRecordsFromText(readFileSync(flightPath, "utf8")) : undefined;
const metrics = computeBetaQualityMetrics({ flightRecords });
console.log(formatBetaQualityReport(metrics));
