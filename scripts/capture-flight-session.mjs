#!/usr/bin/env node
/**
 * Capture a real production flight session (Step 5B.1).
 *
 * Usage:
 *   node --env-file=.env scripts/capture-flight-session.mjs
 *   npm run flight:capture
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  activeCaptureModel,
  captureProductionSession,
  CAPTURE_PLAN,
  hasLlmProviderKey,
} from "../src/lib/instrumentation/flight-capture-harness.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "fixtures/flight-sessions");
const outPath = join(outDir, "real-session-latest.json");

if (!hasLlmProviderKey()) {
  console.error("No LLM provider key found. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or XAI_API_KEY in .env");
  process.exit(1);
}

process.env.DEBUG_FLIGHT = "true";
const model = activeCaptureModel();
console.log(`Capturing ${CAPTURE_PLAN.length} production traces with ${model.provider}/${model.id}…`);

const records = await captureProductionSession({ model });
mkdirSync(outDir, { recursive: true });
writeFileSync(outPath, JSON.stringify({ exportedAt: Date.now(), model: { id: model.id, provider: model.provider }, records }, null, 2));
console.log(`Wrote ${records.length} traces → ${outPath}`);
