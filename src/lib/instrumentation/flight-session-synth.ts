/**
 * Synthetic realistic flight sessions for Step 5B analysis validation.
 * Latency distributions are seeded from Step 5A local benchmarks + production-shaped LLM tiers.
 */
import { defaultWorkspaceId } from "../auth/workspace.ts";
import type { AnswerFlightRecord, FlightRecord } from "./flight-recorder.ts";
import { buildProgressiveTiming } from "./progressive-timing.ts";
import type { AnswerStageTimings } from "./answer-latency.ts";
import type { AnswerTier } from "../search/answer-route.ts";

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function pick(rng: () => number, values: number[]): number {
  return values[Math.floor(rng() * values.length)]!;
}

function pickTier(rng: () => number, tiers: readonly AnswerTier[]): AnswerTier {
  return tiers[Math.floor(rng() * tiers.length)]!;
}

type TraceInput = Omit<
  AnswerFlightRecord,
  "kind" | "traceId" | "answerId" | "timestamp" | "droppedUtterances" | "latency" | "transcriptSummary"
> & {
  totalMs: number;
  tier: AnswerTier;
  latency?: Partial<AnswerStageTimings>;
};

function traceRow(partial: TraceInput): AnswerFlightRecord {
  const id = `synth-${partial.tier}-${Math.floor(partial.totalMs)}-${Math.floor(Math.random() * 1e6)}`;
  const baseLatency = partial.latency ?? {};
  const retrieveMs = baseLatency.retrieveMs ?? pick(seededRandom(partial.totalMs), [1, 2, 3, 5, 8, 12, 18, 24]);
  const llmMs = baseLatency.llmMs ?? 0;
  const verifyMs = baseLatency.verifyMs ?? 0;
  const shadowSupported = partial.progressive?.shadowLocalCardSupported ?? partial.tier === "localCard";
  const progressive =
    partial.progressive ??
    buildProgressiveTiming({
      tier: partial.tier,
      totalMs: partial.totalMs,
      shadowLocalCardSupported: shadowSupported,
      earliestSupportedMs: shadowSupported ? Math.min(partial.totalMs, retrieveMs + pick(seededRandom(llmMs + 1), [2, 5, 12, 21, 30])) : null,
      shadowLocalCardMs: pick(seededRandom(verifyMs + 2), [2, 5, 8, 12, 21]),
    });

  return {
    kind: "answer",
    traceId: id,
    answerId: id,
    timestamp: Date.now(),
    droppedUtterances: 0,
    workspaceId: defaultWorkspaceId(),
    ...partial,
    transcriptSummary: { theyLines: 1, youLines: 0, lastQuestion: partial.query.slice(0, 80) },
    latency: {
      ...baseLatency,
      retrieveMs,
      llmMs,
      verifyMs,
      totalMs: partial.totalMs,
    },
    progressive,
  };
}

/** Build a representative session mixing tiers for analysis when live capture is incomplete. */
export function buildSyntheticFlightSession(seed = 42): FlightRecord[] {
  const rng = seededRandom(seed);
  const records: FlightRecord[] = [];

  const llmLatencies = [420, 580, 720, 890, 1050, 1180, 1350, 980, 640, 510];
  const verifyLatencies = [8, 12, 18, 24, 32, 45, 55, 15, 22, 38];

  for (let i = 0; i < 35; i += 1) {
    const totalMs = pick(rng, [2, 3, 5, 7, 12, 18, 21, 30, 45, 8]);
    records.push(
      traceRow({
        query: "Why does that retry three times?",
        spaceId: "space-single",
        sourceIds: ["repo-a"],
        sourceCount: 1,
        hitCount: pick(rng, [3, 4, 5, 6]),
        evidenceCount: 1,
        supported: true,
        tier: "localCard",
        totalMs,
        modelId: "gpt-4o-mini",
        provider: "openai",
        modelName: "GPT-4o Mini",
        captureScenario: "single-repo-factual",
        gate: { verdict: "question", question: "Why does that retry three times?", triggered: true },
        retrieval: "42 chunks | 0 excluded | 4 hits",
        latency: { retrieveMs: pick(rng, [1, 2, 3]), llmMs: 0, verifyMs: 0, localCardMs: totalMs - 2 },
        say: "Attempts are capped at three.",
        reason: null,
        citations: [{ kind: "file", path: "src/retry.ts", line: 12, label: "repo-a", sourceId: "repo-a" }],
        quotaRemaining: 20,
      }),
    );
  }

  for (let i = 0; i < 18; i += 1) {
    const llmMs = pick(rng, llmLatencies);
    const verifyMs = pick(rng, verifyLatencies);
    const retrieveMs = pick(rng, [2, 3, 5, 8]);
    const totalMs = retrieveMs + llmMs + verifyMs + pick(rng, [5, 12, 20]);
    records.push(
      traceRow({
        query: "How do COMBO_TOKEN and COMBO_TIMEOUT govern checkout?",
        spaceId: "space-multi",
        sourceIds: ["repo-a", "repo-b"],
        sourceCount: 2,
        hitCount: 6,
        evidenceCount: 2,
        supported: true,
        tier: "grounded",
        totalMs,
        modelId: i % 3 === 0 ? "claude-haiku" : "gpt-4o-mini",
        provider: i % 3 === 0 ? "anthropic" : "openai",
        modelName: i % 3 === 0 ? "Claude 3.5 Haiku" : "GPT-4o Mini",
        captureScenario: "multi-repo-synthesis",
        gate: null,
        retrieval: "80 chunks | 0 excluded | 6 hits",
        latency: { retrieveMs, llmMs, verifyMs, groundedMs: llmMs + verifyMs, routeMs: llmMs + verifyMs + 5 },
        say: "Checkout requires both token and timeout.",
        reason: null,
        citations: [
          { kind: "file", path: "a/src/main.ts", line: 1, sourceId: "repo-a", label: "" },
          { kind: "file", path: "b/src/main.ts", line: 1, sourceId: "repo-b", label: "" },
        ],
        quotaRemaining: 18,
        progressive: buildProgressiveTiming({
          tier: "grounded",
          totalMs,
          shadowLocalCardSupported: i % 4 !== 0,
          earliestSupportedMs: i % 4 !== 0 ? retrieveMs + pick(rng, [8, 15, 22]) : null,
          shadowLocalCardMs: pick(rng, [8, 15, 22]),
        }),
      }),
    );
  }

  for (let i = 0; i < 17; i += 1) {
    const llmMs = pick(rng, llmLatencies) + pick(rng, [0, 80, 120]);
    const verifyMs = pick(rng, verifyLatencies);
    const retrieveMs = pick(rng, [3, 5, 12, 24]);
    const totalMs = retrieveMs + llmMs + verifyMs + 15;
    records.push(
      traceRow({
        query: "What does the PDF say about retention?",
        spaceId: "space-pdf",
        sourceIds: ["repo-a", "pdf-1"],
        sourceCount: 2,
        hitCount: 4,
        evidenceCount: 2,
        supported: true,
        tier: "synthesis",
        totalMs,
        modelId: "gpt-4o",
        provider: "openai",
        modelName: "GPT-4o",
        captureScenario: "repo-pdf-synthesis",
        gate: null,
        retrieval: "55 chunks | 0 excluded | 4 hits",
        latency: {
          retrieveMs,
          documentHydrateMs: pick(rng, [0, 5, 12, 47]),
          llmMs,
          verifyMs,
          synthesisMs: llmMs + verifyMs,
          routeMs: llmMs + verifyMs + 20,
        },
        say: "Retention spans repo and PDF policy.",
        reason: null,
        citations: [
          { kind: "file", path: "src/policy.ts", line: 3, sourceId: "repo-a", label: "" },
          { kind: "document", sourceId: "pdf-1", path: "policy.pdf", page: 2, label: "" },
        ],
        quotaRemaining: 17,
        progressive: buildProgressiveTiming({
          tier: "synthesis",
          totalMs,
          shadowLocalCardSupported: false,
          earliestSupportedMs: null,
          shadowLocalCardMs: pick(rng, [12, 25, 40]),
        }),
      }),
    );
  }

  for (let i = 0; i < 22; i += 1) {
    const tier = pickTier(rng, ["grounded", "synthesis", "localCard"] as const);
    const retrieveMs = pick(rng, [2, 4, 6, 9, 14]);
    const llmMs = tier === "localCard" ? 0 : pick(rng, llmLatencies);
    const verifyMs = tier === "localCard" ? 0 : pick(rng, verifyLatencies);
    const totalMs = tier === "localCard" ? pick(rng, [3, 7, 12]) : retrieveMs + llmMs + verifyMs + 10;
    records.push(
      traceRow({
        query: "Multi-source combo question",
        spaceId: "space-quad",
        sourceIds: ["r1", "r2", "r3", "r4"].slice(0, pick(rng, [2, 3, 4])),
        sourceCount: pick(rng, [2, 3, 4]),
        hitCount: 6,
        evidenceCount: pick(rng, [2, 3]),
        supported: true,
        tier,
        totalMs,
        modelId: "gpt-4o-mini",
        provider: "openai",
        modelName: "GPT-4o Mini",
        captureScenario: "quad-repo",
        gate: null,
        retrieval: "120 chunks | 0 excluded | 6 hits",
        latency: { retrieveMs, llmMs, verifyMs, localCardMs: tier === "localCard" ? totalMs - retrieveMs : undefined },
        say: "Combined answer.",
        reason: null,
        citations: [{ kind: "file", path: "x.ts", line: 1, sourceId: "r1", label: "" }],
        quotaRemaining: 16,
      }),
    );
  }

  for (let i = 0; i < 12; i += 1) {
    records.push(
      traceRow({
        query: "What is the weather in Tokyo?",
        spaceId: "space-single",
        sourceIds: ["repo-a"],
        sourceCount: 1,
        hitCount: 0,
        evidenceCount: 0,
        supported: false,
        tier: "silent",
        totalMs: pick(rng, [3, 5, 8, 450, 920]),
        modelId: "gpt-4o-mini",
        provider: "openai",
        modelName: "GPT-4o Mini",
        captureScenario: "should-stay-silent",
        gate: null,
        retrieval: "42 chunks | 0 excluded | 0 hits",
        latency: {
          retrieveMs: pick(rng, [2, 3, 5]),
          llmMs: i % 2 === 0 ? pick(rng, [400, 520]) : 0,
          verifyMs: 0,
        },
        say: null,
        reason: "No matching material",
        citations: [],
        quotaRemaining: 20,
        fallbackReason: "No matching material",
      }),
    );
  }

  for (let i = 0; i < 8; i += 1) {
    const totalMs = pick(rng, [4, 6, 9, 14]);
    records.push(
      traceRow({
        query: i % 2 === 0 ? "Why does that retry three times?" : "Why retry three times?",
        spaceId: "space-single",
        sourceIds: ["repo-a"],
        sourceCount: 1,
        hitCount: 4,
        evidenceCount: 1,
        supported: true,
        tier: "localCard",
        totalMs,
        modelId: "gpt-4o-mini",
        provider: "openai",
        modelName: "GPT-4o Mini",
        captureScenario: "rephrased-question",
        gate: { verdict: "follow-up", question: "Why retry three times?", triggered: true },
        retrieval: "42 chunks | 0 excluded | 4 hits",
        latency: { retrieveMs: 2, llmMs: 0, verifyMs: 0, localCardMs: totalMs - 2 },
        say: "Attempts are capped at three.",
        reason: null,
        citations: [{ kind: "file", path: "src/retry.ts", line: 12, sourceId: "repo-a", label: "" }],
        quotaRemaining: 19,
      }),
    );
  }

  return records;
}
