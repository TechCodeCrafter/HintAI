#!/usr/bin/env node
/**
 * Analyze a flight session export and print Step 5B decision report.
 *
 * Usage:
 *   npm run flight:analyze session.json
 *   npm run flight:analyze -- --synthetic
 *   npm run flight:analyze -- --compare fixtures/flight-sessions/real-session-latest.json
 */
import { readFileSync } from "node:fs";

import { analyzeFlightRecords, formatFlightAnalysis } from "../src/lib/instrumentation/flight-analysis.ts";
import { buildSyntheticFlightSession } from "../src/lib/instrumentation/flight-session-synth.ts";
import { compareSyntheticVsReal, formatCompareTable, formatValidationReport } from "../src/lib/instrumentation/flight-compare.ts";
import { formatFlightSummary, parseFlightInput } from "../src/lib/instrumentation/flight-summary.ts";

const args = process.argv.slice(2);
const synthetic = args.includes("--synthetic");
const compare = args.includes("--compare");
const path = args.find((arg) => !arg.startsWith("--"));

let records;
if (synthetic) {
  records = buildSyntheticFlightSession();
  console.log("(using synthetic representative session)\n");
} else if (!path) {
  console.error("Usage: npm run flight:analyze <session.json>");
  console.error("       npm run flight:analyze -- --synthetic");
  console.error("       npm run flight:analyze -- --compare <real-session.json>");
  process.exit(1);
} else {
  records = parseFlightInput(readFileSync(path, "utf8"));
}

console.log(formatFlightSummary(records));
console.log("\n" + "=".repeat(60) + "\n");
console.log(formatFlightAnalysis(analyzeFlightRecords(records)));

if (compare && !synthetic && path) {
  console.log("\n" + "=".repeat(60) + "\n");
  console.log(formatValidationReport(records));
  console.log("\n" + formatCompareTable(compareSyntheticVsReal(records)));
}
