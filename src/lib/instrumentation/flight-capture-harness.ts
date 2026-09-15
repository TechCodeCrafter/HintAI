/**
 * Production-path flight capture for Step 5B.1 — real LLM, no latency mocks.
 */
import { completeSynthesisDirect } from "../ai/synthesis-client.ts";

export { hasLlmProviderKey } from "../ai/synthesis-client.ts";
import { getDefaultModel, getModelById, type ModelOption } from "../ai/models.ts";
import { bindAccountId } from "../auth/account-boundary.ts";
import { defaultWorkspaceId } from "../auth/workspace.ts";
import { buildSpaceMaterialView } from "../context/material-view.ts";
import { indexSpace } from "../context/space-index.ts";
import { createMemoryRepository } from "../context/memory.ts";
import { persistPackAsContext, setContextRepository } from "../context/service.ts";
import { isPdfSource } from "../context/types.ts";
import { EVAL_PDF_FIXTURES } from "../document/pdf/eval-fixtures.ts";
import { parseAndPersistPdf } from "../document/pdf/ingest.ts";
import { NORTHSTAR } from "../repo/northstar.ts";
import type { RepoPack } from "../repo/types.ts";
import { routeSearchAnswer } from "../search/answer-route.ts";
import { hydratePdfDocumentsForHits } from "../search/live-card-context.ts";
import { formatFlightRetrievalSummary } from "../search/retrieve.ts";
import { runSpaceScopedRetrieval } from "../search/search-scope.ts";
import { normalizeSpokenQuestion } from "../search/spoken.ts";
import { shapeOf } from "../search/intent.ts";
import { summarizeTranscript } from "./answer-latency.ts";
import type { AnswerFlightRecord, FlightRecord } from "./flight-recorder.ts";
import { newTraceId } from "./answer-latency.ts";
import { telemetryFromCard } from "../search/answer-history.ts";

export type CaptureScenario =
  | "single-repo-factual"
  | "multi-repo"
  | "repo-pdf"
  | "synthesis-heavy"
  | "should-stay-silent"
  | "rephrased-question";

export type CaptureCase = {
  scenario: CaptureScenario;
  query: string;
  space: "single" | "dual" | "quad" | "repo-pdf";
};

export const CAPTURE_PLAN: CaptureCase[] = [
  ...repeat("single-repo-factual", "single", [
    "Why does that retry three times?",
    "What did we change in the exporter?",
    "Who touched the auth flow?",
    "What is the architecture of this application?",
    "Why are attempts capped at three?",
    "What happens when settlement file duplicates?",
    "How does the ingest worker handle retries?",
    "What does the auth flow do?",
    "Why does checkout retry?",
    "What changed in the payment exporter?",
  ]),
  ...repeat("multi-repo", "dual", [
    "What COMBO_TOKEN_A and COMBO_TIMEOUT_B govern checkout?",
    "How do auth checkout and billing timeout work together?",
    "What governs COMBO_TOKEN_A requests?",
    "What expires after COMBO_TIMEOUT_B minutes?",
    "How does checkout token and idle timeout interact?",
    "What COMBO_TOKEN_A is required for checkout?",
    "What COMBO_TIMEOUT_B applies to billing idle sessions?",
    "Explain checkout COMBO_TOKEN_A and COMBO_TIMEOUT_B together.",
    "What rules govern COMBO_TOKEN_A and COMBO_TIMEOUT_B?",
    "How are COMBO_TOKEN_A and COMBO_TIMEOUT_B used in checkout?",
  ]),
  ...repeat("repo-pdf", "repo-pdf", [
    "What does serializable isolation prevent?",
    "What prevents lost outcomes in the lecture material?",
    "How does serializable isolation work?",
    "What does the PDF say about lost outcomes?",
    "Why does that retry three times?",
    "What isolation level prevents lost outcomes?",
    "What is serializable isolation?",
    "Does the repo or PDF mention serializable isolation?",
    "What outcome does serializable isolation prevent?",
    "Explain serializable isolation from our sources.",
  ]),
  ...repeat("synthesis-heavy", "dual", [
    "Summarize how COMBO_TOKEN_A and COMBO_TIMEOUT_B together govern checkout end to end.",
    "Give one answer combining auth token rules and billing idle timeout.",
    "What single policy covers both COMBO_TOKEN_A and COMBO_TIMEOUT_B?",
    "How would you explain checkout security and session expiry in one sentence?",
    "Combine auth and billing checkout constraints into one cited answer.",
    "What do both repos say about checkout when token and timeout apply?",
    "Unified checkout answer using auth and billing evidence.",
    "Cross-repo: token plus timeout checkout requirements.",
    "Synthesize COMBO_TOKEN_A and COMBO_TIMEOUT_B for the room.",
    "One cited line covering auth token and billing timeout.",
  ]),
  ...repeat("should-stay-silent", "single", [
    "What is the weather in Tokyo today?",
    "Who won the World Series in 1999?",
    "What is the capital of France?",
    "How do I bake sourdough bread?",
    "What is the stock price of Apple?",
  ]),
  ...repeat("rephrased-question", "single", [
    "Why retry three times?",
    "Why does it retry three times?",
    "Can you explain the three retry limit?",
    "What's the reason for three attempts?",
    "Why are retries limited to three?",
  ]),
];

function repeat(scenario: CaptureScenario, space: CaptureCase["space"], queries: string[]): CaptureCase[] {
  return queries.map((query) => ({ scenario, query, space }));
}

function repoPack(name: string, body: string, relPath = "src/main.ts"): RepoPack {
  return {
    id: `folder-${name}`,
    name,
    description: name,
    files: [{ path: relPath, language: "ts", content: body }],
    commits: [],
  };
}

function repoVariant(suffix: string): RepoPack {
  return {
    ...NORTHSTAR,
    id: `northstar-${suffix}`,
    name: `northstar-${suffix}`,
    files: NORTHSTAR.files.map((file) => ({
      ...file,
      path: `${suffix}/${file.path}`,
    })),
  };
}

type LoadedSpace = Awaited<ReturnType<typeof loadSpace>>;

async function loadSpace(kind: CaptureCase["space"]) {
  bindAccountId("flight-capture-prod");
  const repo = createMemoryRepository();
  setContextRepository(repo);

  if (kind === "single") {
    const { context } = await persistPackAsContext(NORTHSTAR, repo);
    const runtime = await indexSpace(repo, context.id, { embed: false });
    return { repo, runtime, spaceId: context.id, kind };
  }

  if (kind === "dual") {
    const { context } = await persistPackAsContext(
      repoPack(
        "auth-service",
        `/** Auth checkout requires COMBO_TOKEN_A for every request. */\nexport const token = "COMBO_TOKEN_A";\n`,
      ),
      repo,
    );
    await repo.upsertRepoBundle(context.id, {
      displayName: "billing-service",
      files: repoPack(
        "billing-service",
        `/** Billing checkout expires after COMBO_TIMEOUT_B minutes of idle time. */\nexport const timeout = "COMBO_TIMEOUT_B";\n`,
      ).files.map((file) => ({ path: file.path, language: file.language, content: file.content })),
    });
    const runtime = await indexSpace(repo, context.id, { embed: false });
    return { repo, runtime, spaceId: context.id, kind };
  }

  if (kind === "quad") {
    const { context } = await persistPackAsContext(repoVariant("alpha"), repo);
    for (const suffix of ["beta", "gamma", "delta"]) {
      await repo.upsertRepoBundle(context.id, {
        displayName: `svc-${suffix}`,
        files: repoVariant(suffix).files.map((file) => ({
          path: file.path,
          language: file.language,
          content: file.content,
        })),
      });
    }
    const runtime = await indexSpace(repo, context.id, { embed: false });
    return { repo, runtime, spaceId: context.id, kind };
  }

  const { context } = await persistPackAsContext(NORTHSTAR, repo);
  const blob = new Blob([Uint8Array.from(EVAL_PDF_FIXTURES["lecture.pdf"])], { type: "application/pdf" });
  const [source] = await repo.upsertSources(context.id, [
    { path: "lecture.pdf", kind: "pdf", mimeType: "application/pdf", blob },
  ]);
  if (!source || !isPdfSource(source)) throw new Error("pdf fixture missing");
  await parseAndPersistPdf(repo, context.id, source);
  const runtime = await indexSpace(repo, context.id, { embed: false });
  return { repo, runtime, spaceId: context.id, kind };
}

const spaceCache = new Map<CaptureCase["space"], LoadedSpace>();

async function spaceFor(kind: CaptureCase["space"]) {
  const cached = spaceCache.get(kind);
  if (cached) return cached;
  const loaded = await loadSpace(kind);
  spaceCache.set(kind, loaded);
  return loaded;
}

export type CaptureOptions = {
  model?: ModelOption;
  cases?: CaptureCase[];
};

export type CaptureRetrievalContext = Awaited<ReturnType<typeof loadCaptureRetrieval>>;

/** Retrieval + localCard prep for diagnostics (Step 5D) — does not route or call LLM. */
export async function loadCaptureRetrieval(captureCase: CaptureCase) {
  const ctx = await spaceFor(captureCase.space);
  const material = buildSpaceMaterialView({
    workspaceId: defaultWorkspaceId(),
    spaceId: ctx.spaceId,
    primaryContextId: ctx.spaceId,
    memberContextIds: ctx.runtime.memberContextIds,
    pack: ctx.runtime.pack,
    sources: ctx.runtime.allSources,
  });
  const canonical = normalizeSpokenQuestion(captureCase.query).canonical;
  const hits = await runSpaceScopedRetrieval({
    query: canonical,
    chunks: ctx.runtime.chunks,
    pack: ctx.runtime.pack,
    spaceState: {
      activeSpaceId: ctx.spaceId,
      activeContextId: ctx.spaceId,
      memberContextIds: ctx.runtime.memberContextIds,
      authorizedSourceIds: ctx.runtime.allSources.map((row) => row.sourceId ?? row.id),
    },
    workspaceId: defaultWorkspaceId(),
    limit: 6,
    hybrid: false,
  });
  const { context: cardContext } = await hydratePdfDocumentsForHits(
    ctx.repo,
    ctx.runtime.allSources,
    hits,
    material,
  );
  return { ctx, material, hits, cardContext, canonical, spaceSourceCount: ctx.runtime.allSources.length };
}

export async function captureProductionTrace(
  captureCase: CaptureCase,
  options: CaptureOptions = {},
): Promise<AnswerFlightRecord> {
  const model = options.model ?? getDefaultModel();
  const t0 = performance.now();
  const { ctx, material, hits, cardContext, canonical } = await loadCaptureRetrieval(captureCase);
  const retrieveMs = Math.round(performance.now() - t0);
  const { documentHydrateMs } = await hydratePdfDocumentsForHits(
    ctx.repo,
    ctx.runtime.allSources,
    hits,
    material,
  );

  const routeT0 = performance.now();
  const routed = await routeSearchAnswer(captureCase.query, hits, routeT0, {
    pack: ctx.runtime.pack,
    material,
    cardContext,
    modelId: model.id,
    measureProgressive: true,
    retrieveMs,
    ask: async ({ query, prompt, modelId, maxTokens, policy }) => {
      const result = await completeSynthesisDirect({ query, prompt, modelId, maxTokens, policy, keys: {} });
      return { text: result.text, reason: result.reason, modelName: result.modelName };
    },
  });

  const latency = {
    ...routed.latency,
    retrieveMs,
    documentHydrateMs,
    totalMs: Math.round(performance.now() - t0),
  };
  const telemetry = telemetryFromCard(routed.card);
  const traceId = newTraceId();

  return {
    kind: "answer",
    traceId,
    answerId: traceId,
    timestamp: Date.now(),
    droppedUtterances: 0,
    workspaceId: defaultWorkspaceId(),
    spaceId: ctx.spaceId,
    sourceIds: telemetry.sourceIds,
    sourceCount: new Set(telemetry.sourceIds).size || ctx.runtime.allSources.length,
    evidenceCount: telemetry.evidenceCount,
    hitCount: hits.length,
    questionShape: shapeOf(canonical),
    supported: Boolean(routed.card.say),
    fallbackReason: routed.card.say ? null : (routed.card.reason ?? null),
    captureScenario: captureCase.scenario,
    modelId: model.id,
    provider: model.provider,
    modelName: routed.card.modelName ?? model.name,
    progressive: routed.progressive,
    llmBypassed: routed.llmBypassed,
    query: captureCase.query,
    transcriptSummary: summarizeTranscript([]),
    gate: null,
    retrieval: formatFlightRetrievalSummary(ctx.runtime.chunks, hits, ctx.runtime.pack.excludePatterns),
    tier: routed.tier,
    latency,
    say: routed.card.say,
    reason: routed.card.reason ?? null,
    citations: routed.card.citations,
    quotaRemaining: 20,
  };
}

export async function captureProductionSession(options: CaptureOptions = {}): Promise<FlightRecord[]> {
  const cases = options.cases ?? CAPTURE_PLAN;
  const records: FlightRecord[] = [];
  for (const captureCase of cases) {
    records.push(await captureProductionTrace(captureCase, options));
  }
  return records;
}

export function activeCaptureModel(): ModelOption {
  if (process.env.FLIGHT_CAPTURE_MODEL) {
    return getModelById(process.env.FLIGHT_CAPTURE_MODEL) ?? getDefaultModel();
  }
  if (process.env.OPENAI_API_KEY?.trim()) return getModelById("gpt-4o-mini") ?? getDefaultModel();
  if (process.env.ANTHROPIC_API_KEY?.trim()) return getModelById("claude-haiku") ?? getDefaultModel();
  return getDefaultModel();
}
