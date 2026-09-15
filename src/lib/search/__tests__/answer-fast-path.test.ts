import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { NORTHSTAR } from "../../repo/northstar.ts";
import type { Citation, Hit, RepoPack } from "../../repo/types.ts";
import type { Evidence } from "../evidence.ts";
import { isFileHit } from "../../repo/types.ts";
import { routeSearchAnswer } from "../answer-route.ts";
import {
  FAST_PATH_MIN_SCORE,
  localCardFastPathEligible,
  needsMultiSourceCoverage,
  shouldFailFastRetrieval,
} from "../answer-fast-path.ts";
import { buildChunks, retrieve } from "../retrieve.ts";

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const chunks = buildChunks(NORTHSTAR);
const retryHits = retrieve("Why does that retry three times?", chunks).filter(isFileHit);

const uploadPack: RepoPack = {
  id: "upload-test",
  name: "upload-test",
  description: "upload routing fixture",
  files: [
    {
      path: "api/routers/uploads.py",
      language: "py",
      content: readFileSync(join(fixtureRoot, "uploads-router.py"), "utf8"),
    },
  ],
  commits: [],
};

function cardWithEvidence(say: string, evidence: Evidence[], citations: Citation[]) {
  return { say, evidence, citations, query: "q", latencyMs: 1, source: "local" as const };
}

function textEvidence(id: string, path: string, text: string): Evidence {
  return {
    id,
    kind: "text",
    path,
    startLine: 1,
    endLine: 1,
    text,
    sourceId: "src-1",
    sourceType: "code",
    startOffset: 0,
    endOffset: text.length,
    contentHash: "hash",
  } as Evidence;
}

test("shouldFailFastRetrieval on empty hits and off-topic", () => {
  assert.equal(shouldFailFastRetrieval("What is the weather in Boston?", []), true);
  assert.equal(shouldFailFastRetrieval("What is the weather in Boston?", [{ path: "a", text: "x", score: 1 } as Hit]), true);
});

test("localCardFastPathEligible requires evidence-linked citations", () => {
  const evidence = [textEvidence("e1", "a.ts", "Attempts are capped at three.")];
  const citations = [{ kind: "file" as const, path: "a.ts", line: 1, evidenceId: "e1", label: "a.ts" }];
  assert.equal(localCardFastPathEligible(cardWithEvidence("Attempts are capped at three.", evidence, citations), retryHits), true);
  assert.equal(
    localCardFastPathEligible(cardWithEvidence("Attempts are capped at three.", evidence, [{ ...citations[0], evidenceId: undefined }]), retryHits),
    false,
  );
});

test("needsMultiSourceCoverage when hits span sources but card cites one", () => {
  const hits = [
    { path: "a.ts", sourceId: "s1", score: 5, text: "alpha" },
    { path: "b.ts", sourceId: "s2", score: 5, text: "beta" },
  ] as Hit[];
  const card = cardWithEvidence("combined", [textEvidence("e1", "a.ts", "alpha")], [
    { kind: "file", path: "a.ts", line: 1, evidenceId: "e1", label: "a" },
  ]);
  assert.equal(needsMultiSourceCoverage(hits, card), true);
});

test("high-confidence localCard bypasses LLM", async () => {
  let llmCalls = 0;
  const routed = await routeSearchAnswer("Why does that retry three times?", retryHits, 0, {
    pack: NORTHSTAR,
    ask: async () => {
      llmCalls += 1;
      return { text: "INSUFFICIENT" };
    },
  });
  assert.equal(llmCalls, 0);
  assert.equal(routed.tier, "localCard");
  assert.equal(routed.llmBypassed, true);
  assert.ok(routed.card.say);
  assert.ok((routed.latency.llmMs ?? 0) === 0);
});

test("borderline localCard still invokes LLM when fast-path score threshold fails", async () => {
  const borderHits = retryHits.map((hit, index) => ({ ...hit, score: index === 0 ? FAST_PATH_MIN_SCORE - 1 : hit.score }));
  let llmCalls = 0;
  const routed = await routeSearchAnswer("Why does that retry three times?", borderHits, 0, {
    pack: NORTHSTAR,
    ask: async () => {
      llmCalls += 1;
      return { text: "INSUFFICIENT" };
    },
  });
  assert.ok(llmCalls >= 1);
  assert.notEqual(routed.llmBypassed, true);
});

test("weak evidence fails fast without LLM", async () => {
  let llmCalls = 0;
  const weakHits = [{ path: "noise.ts", text: "unrelated prose", score: 1, kind: "code", startLine: 1, endLine: 1 }] as Hit[];
  const routed = await routeSearchAnswer("What is the capital of France?", weakHits, 0, {
    pack: NORTHSTAR,
    ask: async () => {
      llmCalls += 1;
      return { text: "Paris is lovely. [1]" };
    },
  });
  assert.equal(llmCalls, 0);
  assert.equal(routed.tier, "silent");
  assert.equal(routed.card.say, null);
});

test("fast path respects minimum retrieval score", () => {
  const lowHits = [{ ...retryHits[0], score: FAST_PATH_MIN_SCORE - 1 }];
  const evidence = [textEvidence("e1", "a.ts", "x")];
  const citations = [{ kind: "file" as const, path: "a.ts", line: 1, evidenceId: "e1", label: "a" }];
  assert.equal(localCardFastPathEligible(cardWithEvidence("x", evidence, citations), lowHits), false);
});
