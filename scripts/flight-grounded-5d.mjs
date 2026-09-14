#!/usr/bin/env node
/** Step 5D — grounded trace diagnostics + streaming observation. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { bindAccountId } from "../src/lib/auth/account-boundary.ts";
import { completeSynthesisDirect } from "../src/lib/ai/synthesis-client.ts";
import {
  CAPTURE_PLAN,
  loadCaptureRetrieval,
} from "../src/lib/instrumentation/flight-capture-harness.ts";
import { createMemoryRepository } from "../src/lib/context/memory.ts";
import { setContextRepository } from "../src/lib/context/service.ts";
import {
  estimatePromptTokens,
  explainFastPathIneligibility,
  localCardFastPathEligible,
} from "../src/lib/search/answer-fast-path.ts";
import { buildSynthesisPrompt } from "../src/lib/search/generate-answer.ts";
import { localCard } from "../src/lib/search/local-card.ts";
import { shapeOf } from "../src/lib/search/intent.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const optimized = JSON.parse(readFileSync(join(root, "fixtures/flight-sessions/real-session-latest.json"), "utf8"));

bindAccountId("flight-capture-prod");
setContextRepository(createMemoryRepository());

const groundedCases = optimized.records
  .filter((row) => row.kind === "answer" && row.tier === "grounded" && row.supported)
  .map((row) => CAPTURE_PLAN.find((c) => c.scenario === row.captureScenario && c.query === row.query))
  .filter(Boolean);

const streamRows = [];

console.log("=== GROUNDED TRACE DEEP-DIVE ===\n");

for (const captureCase of groundedCases) {
  const { ctx, material, hits, cardContext, canonical, spaceSourceCount } =
    await loadCaptureRetrieval(captureCase);
  const card = localCard(captureCase.query, hits, ctx.runtime.pack, 0, null, {
    ...cardContext,
    material,
  });
  const prompt = buildSynthesisPrompt(captureCase.query, hits, material);
  const promptTokens = estimatePromptTokens(prompt);

  const stream = await completeSynthesisDirect({
    query: captureCase.query,
    prompt,
    modelId: "gpt-4o-mini",
    policy: "extract",
    measureStream: true,
    keys: {},
  });
  if (stream.stream) streamRows.push(stream.stream);

  const hitSources = new Set(hits.map((h) => h.sourceId).filter(Boolean));
  const citedSources = new Set(
    (card.citations ?? []).map((c) => ("sourceId" in c ? c.sourceId : null)).filter(Boolean),
  );

  console.log(
    JSON.stringify(
      {
        scenario: captureCase.scenario,
        query: captureCase.query,
        questionType: shapeOf(canonical),
        spaceSourceCount,
        hitSourceCount: hitSources.size,
        citedSourceCount: citedSources.size,
        evidenceCount: card.evidence?.length ?? 0,
        hitCount: hits.length,
        topScore: hits[0]?.score ?? 0,
        promptTokenEstimate: promptTokens,
        outputTokenEstimate: stream.text ? Math.ceil(stream.text.length / 4) : 0,
        fastPathEligible: localCardFastPathEligible(card, hits),
        ineligibilityReasons: explainFastPathIneligibility(card, hits),
        localCardPreview: card.say?.slice(0, 100) ?? null,
        llmPreview: stream.text?.slice(0, 100) ?? null,
        stream: stream.stream,
        capturedTotalMs: optimized.records.find(
          (r) => r.captureScenario === captureCase.scenario && r.query === captureCase.query,
        )?.latency?.totalMs,
      },
      null,
      2,
    ),
  );
  console.log("---\n");
}

function pct(vals, q) {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((q / 100) * s.length) - 1)];
}

console.log("=== STREAMING (grounded subset, n=" + streamRows.length + ") ===\n");
console.log(
  JSON.stringify(
    {
      ttftMs: { p50: pct(streamRows.map((r) => r.ttftMs ?? 0), 50), p95: pct(streamRows.map((r) => r.ttftMs ?? 0), 95) },
      firstSentenceMs: {
        p50: pct(streamRows.map((r) => r.firstSentenceMs ?? 0), 50),
        p95: pct(streamRows.map((r) => r.firstSentenceMs ?? 0), 95),
      },
      completionMs: {
        p50: pct(streamRows.map((r) => r.completionMs), 50),
        p95: pct(streamRows.map((r) => r.completionMs), 95),
      },
    },
    null,
    2,
  ),
);
