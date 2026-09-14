import assert from "node:assert/strict";
import { test } from "node:test";

import { bindAccountId, LOCAL_DEV_ACCOUNT_ID } from "../../auth/account-boundary.ts";
import { defaultWorkspaceId } from "../../auth/workspace.ts";
import { buildSpaceMaterialView } from "../../context/material-view.ts";
import { indexSpace } from "../../context/space-index.ts";
import { createMemoryRepository } from "../../context/memory.ts";
import { persistPackAsContext, setContextRepository } from "../../context/service.ts";
import { isPdfSource } from "../../context/types.ts";
import { DOCUMENT_NORMALIZER_VERSION, PDF_PARSER_VERSION } from "../../context/index-versions.ts";
import { buildDocumentChunks } from "../../document/chunk.ts";
import { EVAL_PDF_FIXTURES } from "../../document/pdf/eval-fixtures.ts";
import { parseAndPersistPdf } from "../../document/pdf/ingest.ts";
import type { NormalizedDocument } from "../../document/types.ts";
import { NORTHSTAR } from "../../repo/northstar.ts";
import { routeSearchAnswer } from "../../search/answer-route.ts";
import { hydratePdfDocumentsForHits } from "../../search/live-card-context.ts";
import { buildChunks, retrieve } from "../../search/retrieve.ts";
import {
  assertFlightPrivacy,
  latencyPercentiles,
  newTraceId,
  summarizeTranscript,
} from "../answer-latency.ts";
import {
  flightRecords,
  recordAnswerFlight,
  resetFlightSession,
} from "../flight-recorder.ts";
import { formatFlightSummary, parseFlightInput } from "../flight-summary.ts";
import { runBenchmarkIteration } from "../latency-benchmark.ts";

const memory = new Map<string, string>();

function enableFlightRecorder() {
  process.env.DEBUG_FLIGHT = "true";
}

function installStorage() {
  memory.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
      removeItem: (key: string) => {
        memory.delete(key);
      },
    },
  });
  bindAccountId(LOCAL_DEV_ACCOUNT_ID);
  resetFlightSession();
}

test("trace created for supported localCard answer with non-negative stages", async () => {
  enableFlightRecorder();
  installStorage();

  const chunks = buildChunks(NORTHSTAR);
  const hits = retrieve("Why does that retry three times?", chunks);
  const routed = await routeSearchAnswer("Why does that retry three times?", hits, performance.now(), {
    pack: NORTHSTAR,
    retrieveMs: 4,
    ask: async () => ({ text: "INSUFFICIENT" }),
  });
  assert.ok(routed.card.say, routed.card.reason);

  const traceId = recordAnswerFlight({
    query: routed.card.query,
    transcriptSummary: summarizeTranscript([
      { id: "1", at: Date.now(), speaker: "them", role: "them", text: routed.card.query },
    ]),
    gate: { verdict: "question", question: routed.card.query, triggered: true },
    retrieval: "10 chunks | 0 excluded | 2 hits",
    tier: routed.tier,
    latency: routed.latency,
    say: routed.card.say,
    reason: null,
    citations: routed.card.citations,
    quotaRemaining: 19,
    sourceIds: ["northstar-payments"],
    sourceCount: 1,
    hitCount: hits.length,
    evidenceCount: routed.card.citations.length,
    supported: true,
  });

  assert.ok(traceId);
  const row = flightRecords().find((item) => item.kind === "answer");
  assert.ok(row && row.kind === "answer");
  assert.equal(row.traceId, row.answerId);
  assert.equal(row.sourceIds?.length, 1);
  assert.ok(row.latency.totalMs >= 0);
  assert.ok(row.latency.retrieveMs >= 0);
  assert.ok((row.latency.localCardMs ?? 0) >= 0);
  assert.equal(row.transcriptSummary.theyLines, 1);
  assert.equal(row.transcript, undefined);
});

test("trace created for silent answer retains hit count and fallback reason", async () => {
  enableFlightRecorder();
  installStorage();

  const traceId = recordAnswerFlight({
    query: "What is the weather in Tokyo?",
    transcriptSummary: { theyLines: 1, youLines: 0, lastQuestion: "What is the weather in Tokyo?" },
    gate: null,
    retrieval: "10 chunks | 0 excluded | 0 hits",
    tier: "silent",
    latency: { retrieveMs: 3, llmMs: 0, verifyMs: 0, totalMs: 3 },
    say: null,
    reason: "No matching material",
    citations: [],
    quotaRemaining: 20,
    hitCount: 0,
    supported: false,
    fallbackReason: "No matching material",
  });

  assert.ok(traceId);
  const row = flightRecords()[0];
  assert.equal(row?.kind, "answer");
  if (row?.kind !== "answer") throw new Error("expected answer");
  assert.equal(row.supported, false);
  assert.equal(row.hitCount, 0);
  assert.equal(row.fallbackReason, "No matching material");
});

test("flight telemetry rejects evidence bodies and stores multiple source ids", () => {
  enableFlightRecorder();
  installStorage();

  recordAnswerFlight({
    query: "combo question",
    transcriptSummary: { theyLines: 1, youLines: 0 },
    gate: null,
    retrieval: "2 hits",
    tier: "synthesis",
    latency: { retrieveMs: 5, llmMs: 40, verifyMs: 2, totalMs: 47 },
    say: "Combined answer.",
    reason: null,
    citations: [
      { kind: "file", path: "alpha/src/main.ts", line: 1, label: "alpha", sourceId: "src-a" },
      { kind: "file", path: "beta/src/main.ts", line: 1, label: "beta", sourceId: "src-b" },
    ],
    quotaRemaining: 18,
    sourceIds: ["src-a", "src-b"],
    sourceCount: 2,
    hitCount: 2,
    evidenceCount: 2,
    supported: true,
  });

  const row = flightRecords()[0];
  assert.ok(row && row.kind === "answer");
  assert.deepEqual(row.sourceIds, ["src-a", "src-b"]);
  assert.equal(row.sourceCount, 2);
  assert.doesNotThrow(() => assertFlightPrivacy(row as unknown as Record<string, unknown>));
  assert.throws(() =>
    assertFlightPrivacy({
      evidence: [{ kind: "text", path: "x", content: "x".repeat(600) }],
    }),
  );
});

test("flight summary includes extended latency breakdown", () => {
  const summary = formatFlightSummary(
    parseFlightInput(
      JSON.stringify({
        records: [
          {
            kind: "answer",
            traceId: "t1",
            answerId: "t1",
            timestamp: 1,
            query: "Q",
            transcriptSummary: { theyLines: 1, youLines: 0 },
            gate: null,
            retrieval: "hits",
            tier: "localCard",
            latency: {
              retrieveMs: 10,
              llmMs: 0,
              verifyMs: 0,
              localCardMs: 8,
              totalMs: 18,
            },
            say: "Yes",
            reason: null,
            citations: [],
            quotaRemaining: 20,
            droppedUtterances: 0,
            sourceCount: 1,
          },
        ],
      }),
    ),
  );
  assert.match(summary, /localCardMs p50\/p95\/p99/);
  assert.match(summary, /Product target: p95 supported answer/);
});

test("hydratePdfDocumentsForHits loads document resolver for repo+pdf local-card path", async () => {
  bindAccountId("pdf-hydrate");
  const repo = createMemoryRepository();
  setContextRepository(repo);
  const { context } = await persistPackAsContext(NORTHSTAR, repo);
  const blob = new Blob([Uint8Array.from(EVAL_PDF_FIXTURES["lecture.pdf"])], { type: "application/pdf" });
  const [source] = await repo.upsertSources(context.id, [
    { path: "lecture.pdf", kind: "pdf", mimeType: "application/pdf", blob },
  ]);
  assert.ok(source && isPdfSource(source));
  await parseAndPersistPdf(repo, context.id, source);
  const runtime = await indexSpace(repo, context.id, { embed: false });
  const material = buildSpaceMaterialView({
    workspaceId: defaultWorkspaceId(),
    spaceId: context.id,
    primaryContextId: context.id,
    memberContextIds: [context.id],
    pack: runtime.pack,
    sources: runtime.allSources,
  });
  const document = await repo.getNormalizedDocument(source.id, source.contentHash);
  assert.ok(document);
  const docChunks = buildDocumentChunks(document);
  const docHit = { ...docChunks[0]!, score: 12 };
  const fileHits = retrieve("Why does that retry three times?", runtime.chunks);
  const hits = [...fileHits.slice(0, 1), docHit];

  const { context: cardContext } = await hydratePdfDocumentsForHits(repo, runtime.allSources, hits, material);
  assert.ok(cardContext.document?.(document.sourceId));
  assert.equal(cardContext.documents?.length, 1);
});

test("benchmark iteration produces meaningful northstar-scale timings", async () => {
  const sample = await runBenchmarkIteration("single-repo");
  assert.ok(sample.totalMs >= 0);
  assert.ok(sample.retrieveMs >= 0);
  assert.ok(sample.hitCount > 0);
  const stats = latencyPercentiles([sample.totalMs, sample.totalMs + 1, sample.totalMs + 2]);
  assert.ok(stats.p95 >= stats.p50);
});
