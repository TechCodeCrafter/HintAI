/**
 * Live-answer latency schema and privacy-safe telemetry helpers.
 *
 * Privacy policy:
 * - Never store raw file contents, chunk text, or embedding vectors.
 * - Transcripts are summarized (counts + last question snippet), not full lanes.
 * - Citations retain paths/source ids only — no evidence body text.
 * - Query strings are kept (user-spoken); they are not source material.
 */
import type { Utterance } from "../repo/types.ts";
import type { Shape } from "../search/intent.ts";
import type { AnswerTier } from "../search/answer-route.ts";
import type { TranscriptLanes } from "./flight-recorder.ts";

/** Product target — measurement baseline, not a enforced SLA in tests. */
export const P95_SUPPORTED_ANSWER_TARGET_MS = 2000;

export type TranscriptSummary = {
  theyLines: number;
  youLines: number;
  /** Last them-side question snippet, capped. */
  lastQuestion?: string;
};

/** Stages that are actually observed on the production search() hot path. */
export type AnswerStageTimings = {
  /** Gate timestamp → search() start when live-triggered; null when typed/direct. */
  transcriptFinalizeMs?: number | null;
  canonicalizeMs?: number;
  materialPrepMs?: number;
  scopePrepMs?: number;
  /** Lazy PDF NormalizedDocument loads for document hits only. */
  documentHydrateMs?: number;
  retrieveMs: number;
  /** Wall time inside routeSearchAnswer (post-retrieval). */
  routeMs?: number;
  groundedMs?: number;
  synthesisMs?: number;
  localCardMs?: number;
  llmMs: number;
  verifyMs: number;
  /** search() entry → routed card ready. */
  totalMs: number;
  /** finish() store apply after routing. */
  uiApplyMs?: number;
};

export type AnswerTraceMeta = {
  traceId: string;
  workspaceId: string;
  spaceId?: string;
  sourceIds: string[];
  sourceCount: number;
  questionShape?: Shape;
  hitCount: number;
  evidenceCount: number;
  tier: AnswerTier;
  supported: boolean;
  fallbackReason?: string | null;
};

const TRANSCRIPT_SNIPPET_CAP = 160;

export function newTraceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `trace-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function summarizeTranscript(utterances: Utterance[]): TranscriptSummary {
  const they = utterances.filter((row) => row.role === "them");
  const you = utterances.filter((row) => row.role === "you");
  const lastThem = they.at(-1)?.text.trim();
  return {
    theyLines: they.length,
    youLines: you.length,
    lastQuestion: lastThem ? lastThem.slice(0, TRANSCRIPT_SNIPPET_CAP) : undefined,
  };
}

export function summarizeTranscriptLanes(lanes: TranscriptLanes): TranscriptSummary {
  const lastThem = lanes.they.at(-1)?.trim();
  return {
    theyLines: lanes.they.length,
    youLines: lanes.you.length,
    lastQuestion: lastThem ? lastThem.slice(0, TRANSCRIPT_SNIPPET_CAP) : undefined,
  };
}

/** Strip fields that could carry source bodies from a flight record payload. */
export function assertFlightPrivacy(payload: Record<string, unknown>): void {
  const json = JSON.stringify(payload);
  if (/"content"\s*:\s*"[^"]{500,}/.test(json)) {
    throw new Error("flight telemetry must not include large content fields");
  }
  if (/"evidence"\s*:\s*\[/.test(json)) {
    throw new Error("flight telemetry must not include evidence bodies");
  }
}

export function stageValues(records: AnswerStageTimings[], key: keyof AnswerStageTimings): number[] {
  return records
    .map((row) => row[key])
    .filter((value): value is number => typeof value === "number" && value >= 0)
    .sort((a, b) => a - b);
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))]!;
}

export function latencyPercentiles(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };
}
