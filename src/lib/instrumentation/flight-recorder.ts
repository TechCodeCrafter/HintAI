/**
 * Phase 0 meeting flight recorder — text and numbers only, local vault, debug-gated.
 *
 * Each answer or dropped-utterance event appends one JSONL line to account-scoped
 * localStorage. Nothing leaves the machine; no audio or embeddings are stored.
 */
import { readAccountStorage, writeAccountStorage } from "../auth/account-boundary.ts";
import { defaultWorkspaceId } from "../auth/workspace.ts";
import { isFlightRecorder } from "../debug.ts";
import type { DropReason } from "../listen/utterance-admission.ts";
import type { Citation, Utterance } from "../repo/types.ts";
import type { ModelProvider } from "../ai/models.ts";
import type { AnswerStageTimings, TranscriptSummary } from "./answer-latency.ts";
import { assertFlightPrivacy, newTraceId, summarizeTranscriptLanes } from "./answer-latency.ts";
import type { ProgressiveTiming } from "./progressive-timing.ts";
import type { AnswerTier, SearchLatency } from "../search/answer-route.ts";
import type { GateVerdict } from "../search/question.ts";
import type { Shape } from "../search/intent.ts";

const STORAGE_BASE = "meethint.flightLog";
const MAX_LINES = 500;

export type TranscriptLanes = {
  they: string[];
  you: string[];
};

export type GateVerdictSnapshot = {
  verdict: GateVerdict;
  question: string | null;
  triggered: boolean;
};

export type AnswerFlightRecord = {
  kind: "answer";
  /** Stable per-answer trace id (same as answerId for feedback linkage). */
  traceId: string;
  answerId: string;
  workspaceId?: string;
  contextId?: string;
  spaceId?: string;
  sourceIds?: string[];
  sourceCount?: number;
  evidenceCount?: number;
  hitCount?: number;
  questionShape?: Shape;
  supported?: boolean;
  fallbackReason?: string | null;
  timestamp: number;
  query: string;
  /** Privacy-safe transcript summary — full lanes omitted by default. */
  transcriptSummary: TranscriptSummary;
  /** @deprecated Full transcript lanes — omitted on new records. */
  transcript?: TranscriptLanes;
  gate: GateVerdictSnapshot | null;
  retrieval: string;
  tier: AnswerTier;
  /** Selected model metadata — no API keys or prompts. */
  modelId?: string;
  provider?: ModelProvider;
  modelName?: string;
  /** Manual capture scenario tag, e.g. "multi-repo-synthesis". */
  captureScenario?: string;
  progressive?: ProgressiveTiming;
  /** True when verified localCard skipped grounded/synthesis LLM (Step 5C). */
  llmBypassed?: boolean;
  latency: SearchLatency | AnswerStageTimings;
  say: string | null;
  reason: string | null;
  citations: Citation[];
  quotaRemaining: number;
  droppedUtterances: number;
};

export type DroppedUtteranceRecord = {
  kind: "dropped";
  timestamp: number;
  reason: DropReason;
  sileroProb: number | null;
  durationMs: number;
  energy: number;
};

export const FEEDBACK_REASONS = [
  "wrong-answer",
  "too-slow",
  "wrong-source",
  "missed-context",
  "other",
] as const;

export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];

export type FeedbackFlightRecord = {
  kind: "feedback";
  timestamp: number;
  answerId: string;
  reason: FeedbackReason;
  tier: AnswerTier;
  latencyMs: number;
};

export type FlightRecord = AnswerFlightRecord | DroppedUtteranceRecord | FeedbackFlightRecord;

export type FlightSessionExport = {
  exportedAt: number;
  records: FlightRecord[];
};

let memoryLines: string[] = [];
let droppedUtterances = 0;

declare global {
  interface Window {
    __groundFlight?: {
      records: () => FlightRecord[];
      droppedRecords: () => DroppedUtteranceRecord[];
      feedbackRecords: () => FeedbackFlightRecord[];
      reset: () => void;
      droppedUtterances: () => number;
    };
  }
}


export function parseFlightLine(line: string): FlightRecord | null {
  try {
    const row = JSON.parse(line) as FlightRecord;
    if (row.kind === "answer" || row.kind === "dropped" || row.kind === "feedback") return row;
    return null;
  } catch {
    return null;
  }
}

function loadLines(): string[] {
  const raw = readAccountStorage(STORAGE_BASE);
  if (raw) {
    try {
      memoryLines = raw.split("\n").filter(Boolean);
    } catch {
      memoryLines = [];
    }
  }
  return memoryLines;
}

function persistLines(lines: string[]): void {
  memoryLines = lines;
  writeAccountStorage(STORAGE_BASE, lines.length ? lines.join("\n") : null);
}

function installWindowHook(): void {
  if (typeof window === "undefined") return;
  window.__groundFlight = {
    records: () => flightRecords(),
    droppedRecords: () => droppedRecords(),
    feedbackRecords: () => feedbackRecords(),
    reset: () => resetFlightSession(),
    droppedUtterances: () => droppedUtterances,
  };
}

export function transcriptLanes(utterances: Utterance[]): TranscriptLanes {
  return {
    they: utterances.filter((row) => row.role === "them").map((row) => row.text),
    you: utterances.filter((row) => row.role === "you").map((row) => row.text),
  };
}

function appendRecord(record: FlightRecord): void {
  const lines = loadLines();
  lines.push(JSON.stringify(record));
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
  persistLines(lines);
  installWindowHook();
}

export function recordAnswerFlight(
  input: Omit<
    AnswerFlightRecord,
    "kind" | "traceId" | "answerId" | "workspaceId" | "timestamp" | "droppedUtterances" | "transcriptSummary"
  > & {
    workspaceId?: string;
    contextId?: string;
    spaceId?: string;
    sourceIds?: string[];
    sourceCount?: number;
    evidenceCount?: number;
    hitCount?: number;
    questionShape?: Shape;
    supported?: boolean;
    fallbackReason?: string | null;
    transcript?: TranscriptLanes;
    transcriptSummary?: TranscriptSummary;
    traceId?: string;
    modelId?: string;
    provider?: ModelProvider;
    modelName?: string;
    captureScenario?: string;
    progressive?: ProgressiveTiming;
  },
): string | null {
  if (!isFlightRecorder()) return null;
  const traceId = input.traceId ?? newTraceId();
  const { transcript, transcriptSummary: summaryIn, ...rest } = input;
  const transcriptSummary =
    summaryIn ?? (transcript ? summarizeTranscriptLanes(transcript) : { theyLines: 0, youLines: 0 });
  const record: AnswerFlightRecord = {
    kind: "answer",
    traceId,
    answerId: traceId,
    workspaceId: rest.workspaceId ?? defaultWorkspaceId(),
    timestamp: Date.now(),
    droppedUtterances,
    transcriptSummary,
    ...rest,
  };
  assertFlightPrivacy(record as unknown as Record<string, unknown>);
  appendRecord(record);
  return traceId;
}

export type AnswerFeedbackInput = {
  answerId: string;
  reason: FeedbackReason;
  tier: AnswerTier;
  latencyMs: number;
};

export function recordAnswerFeedback(input: AnswerFeedbackInput): void {
  if (!isFlightRecorder()) return;
  appendRecord({
    kind: "feedback",
    timestamp: Date.now(),
    ...input,
  });
}

export type DroppedUtteranceInput = {
  reason: DropReason;
  sileroProb: number | null;
  durationMs: number;
  energy: number;
};

export function noteDroppedUtterance(input: DroppedUtteranceInput): void {
  if (!isFlightRecorder()) return;
  droppedUtterances += 1;
  appendRecord({
    kind: "dropped",
    timestamp: Date.now(),
    ...input,
  });
}

export function flightRecords(): FlightRecord[] {
  return loadLines()
    .map(parseFlightLine)
    .filter((row): row is FlightRecord => row != null);
}

export function droppedRecords(): DroppedUtteranceRecord[] {
  return flightRecords().filter((row): row is DroppedUtteranceRecord => row.kind === "dropped");
}

export function feedbackRecords(): FeedbackFlightRecord[] {
  return flightRecords().filter((row): row is FeedbackFlightRecord => row.kind === "feedback");
}

export function exportFlightSession(): FlightSessionExport {
  return {
    exportedAt: Date.now(),
    records: flightRecords(),
  };
}

export function flightSessionJson(pretty = true): string {
  const payload = exportFlightSession();
  return pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload);
}

export function resetFlightSession(): void {
  memoryLines = [];
  droppedUtterances = 0;
  writeAccountStorage(STORAGE_BASE, null);
}

export function droppedUtteranceCount(): number {
  return droppedUtterances;
}

export function downloadFlightLog(filename?: string): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([flightSessionJson()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename ?? `meethint-flight-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
