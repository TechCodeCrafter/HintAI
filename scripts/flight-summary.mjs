#!/usr/bin/env node
import { readFileSync } from "node:fs";

import { formatFlightSummary, parseFlightInput } from "../src/lib/instrumentation/flight-summary.ts";

const path = process.argv[2];
if (!path) {
  console.error("Usage: npm run flight:summary <session.jsonl>");
  process.exit(1);
}

const text = readFileSync(path, "utf8");
console.log(formatFlightSummary(parseFlightInput(text)));
