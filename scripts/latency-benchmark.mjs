#!/usr/bin/env node
/**
 * Local latency benchmark for the production answer path.
 *
 * Usage: npm run latency:benchmark [single-repo|quad-repo|repo-plus-pdf]
 */
import {
  formatBenchmarkReport,
  runBenchmarkScenario,
} from "../src/lib/instrumentation/latency-benchmark.ts";

const allowed = ["single-repo", "quad-repo", "repo-plus-pdf"];
const scenarios = process.argv[2] ? [process.argv[2]] : allowed;
for (const name of scenarios) {
  if (!allowed.includes(name)) {
    console.error(`Unknown scenario: ${name}`);
    console.error("Usage: npm run latency:benchmark [single-repo|quad-repo|repo-plus-pdf]");
    process.exit(1);
  }
  const report = await runBenchmarkScenario(name, 16);
  console.log(formatBenchmarkReport(report));
  console.log("");
}
