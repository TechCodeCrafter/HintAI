#!/usr/bin/env node
/**
 * Privacy check for beta diagnostic export shape (no browser required).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
process.env.VITE_BETA_TELEMETRY = "true";

const { bindAccountId } = await import(join(root, "src/lib/auth/account-boundary.ts"));
const { recordBetaAnswer, recordBetaFeedback, resetBetaTelemetry, recordBetaEventOnce } = await import(
  join(root, "src/lib/instrumentation/beta-telemetry.ts")
);
const { buildBetaDiagnosticExport, betaDiagnosticJson } = await import(
  join(root, "src/lib/instrumentation/beta-diagnostics.ts")
);
const { summarizeBetaFunnel } = await import(join(root, "src/lib/instrumentation/beta-telemetry.ts"));

bindAccountId("diag-verify");
resetBetaTelemetry();
recordBetaEventOnce("USER_CREATED");
recordBetaAnswer({
  traceId: "trace-smoke-1",
  tier: "grounded",
  supported: true,
  latencyMs: 450,
  sourceIds: ["src-1"],
  evidenceCount: 1,
  sourceCount: 1,
  spaceId: "space-1",
});
recordBetaFeedback({
  traceId: "trace-smoke-1",
  tier: "grounded",
  latencyMs: 450,
  result: "useful",
  sourceIds: ["src-1"],
  spaceId: "space-1",
});
recordBetaFeedback({
  traceId: "trace-smoke-2",
  tier: "grounded",
  latencyMs: 900,
  result: "not-useful",
  failureCategory: "wrong-source",
  sourceIds: ["src-2"],
  spaceId: "space-1",
});

const payload = buildBetaDiagnosticExport();
const json = betaDiagnosticJson(false);

assert.ok(payload.appVersion);
assert.ok(payload.platform);
assert.ok(payload.browser);
assert.ok(payload.traceIds.includes("trace-smoke-1"));
assert.ok(payload.timings.latencyP50 >= 0);
assert.ok(payload.sourceCounts.totalAnswers >= 1);
assert.match(json, /trace-smoke-1/);
assert.match(json, /useful/);
assert.match(json, /wrong-source/);

const forbidden = [
  /sk-[a-zA-Z0-9]{10,}/,
  /\bapi[_-]?key\b/i,
  /"evidence"\s*:\s*\[/,
  /"content"\s*:\s*"/,
  /USER_A_PRIVATE/,
];
for (const pattern of forbidden) {
  assert.doesNotMatch(json, pattern, `forbidden pattern ${pattern}`);
}

const funnel = summarizeBetaFunnel();
assert.ok(funnel.timeToFirstUsefulAnswerMs != null && funnel.timeToFirstUsefulAnswerMs >= 0);

console.log("verify-beta-diagnostics.mjs: ok");
