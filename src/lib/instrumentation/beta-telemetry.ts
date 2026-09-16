/**
 * Closed-beta telemetry — privacy-safe, account-scoped localStorage only.
 *
 * Records funnel events, minimal answer metrics, and in-product feedback.
 * Never stores source bodies, evidence text, API keys, or full transcripts.
 */
import { readAccountStorage, writeAccountStorage } from "../auth/account-boundary.ts";
import { defaultWorkspaceId } from "../auth/workspace.ts";
import type { AnswerTier } from "../search/answer-route.ts";
import { assertFlightPrivacy } from "./answer-latency.ts";

export const BETA_TELEMETRY_STORAGE = "meethint.betaTelemetry";
const MAX_LINES = 2000;

export const NEGATIVE_FEEDBACK_CATEGORIES = [
  "wrong-answer",
  "missing-context",
  "wrong-source",
  "citation-incorrect",
  "too-vague",
  "too-slow",
  "should-have-stayed-silent",
  "other",
] as const;

export type NegativeFeedbackCategory = (typeof NEGATIVE_FEEDBACK_CATEGORIES)[number];

export type BetaFeedbackResult = "useful" | "not-useful";

/** Onboarding funnel + lifecycle events (privacy-safe). */
export type BetaLifecycleEvent =
  | "USER_CREATED"
  | "SIGNUP"
  | "SPACE_CREATED"
  | "SOURCE_CONNECTED"
  | "INDEX_READY"
  | "FIRST_QUESTION"
  | "FIRST_ASK"
  | "SUPPORTED_ANSWER"
  | "SILENT_ANSWER"
  | "ANSWER_MARKED_USEFUL"
  | "NEGATIVE_FEEDBACK"
  | "FIRST_LIVE_SESSION"
  | "QUESTION_DETECTED"
  | "SESSION_START"
  | "RETURN_DAY_1"
  | "RETURN_DAY_7";

export type BetaEventRecord = {
  kind: "event";
  timestamp: number;
  event: BetaLifecycleEvent;
  workspaceId?: string;
  spaceId?: string;
  meta?: Record<string, string | number | boolean | null>;
};

export type BetaAnswerRecord = {
  kind: "answer";
  timestamp: number;
  traceId: string;
  answerId: string;
  workspaceId?: string;
  spaceId?: string;
  sourceIds: string[];
  tier: AnswerTier;
  supported: boolean;
  latencyMs: number;
  evidenceCount: number;
  sourceCount: number;
};

export type BetaFeedbackRecord = {
  kind: "feedback";
  timestamp: number;
  traceId: string;
  answerId: string;
  workspaceId?: string;
  spaceId?: string;
  sourceIds: string[];
  tier: AnswerTier;
  latencyMs: number;
  result: BetaFeedbackResult;
  failureCategory?: NegativeFeedbackCategory;
};

export type BetaTelemetryRecord = BetaEventRecord | BetaAnswerRecord | BetaFeedbackRecord;

export type BetaFunnelStep =
  | "USER_CREATED"
  | "SPACE_CREATED"
  | "SOURCE_CONNECTED"
  | "INDEX_READY"
  | "FIRST_QUESTION"
  | "SUPPORTED_ANSWER"
  | "ANSWER_MARKED_USEFUL";

const FUNNEL_ORDER: BetaFunnelStep[] = [
  "USER_CREATED",
  "SPACE_CREATED",
  "SOURCE_CONNECTED",
  "INDEX_READY",
  "FIRST_QUESTION",
  "SUPPORTED_ANSWER",
  "ANSWER_MARKED_USEFUL",
];

export type BetaFunnelSummary = {
  steps: Array<{ step: BetaFunnelStep; timestamp: number | null }>;
  timeToFirstUsefulAnswerMs: number | null;
};

export type BetaLifecycleSummary = {
  signup: number;
  sourceConnected: number;
  firstKnowledgeSpace: number;
  firstAsk: number;
  firstLiveSession: number;
  questionsDetected: number;
  supportedAnswers: number;
  silentAnswers: number;
  usefulAnswers: number;
  negativeFeedback: number;
  sessionsPerUser: number;
  returnAfter1Day: number;
  returnAfter7Day: number;
};

let memoryLines: string[] = [];

export function isBetaTelemetryEnabled(): boolean {
  if (typeof process !== "undefined" && process.env?.VITE_BETA_TELEMETRY === "false") return false;
  try {
    const value = (import.meta as { env?: Record<string, unknown> }).env?.VITE_BETA_TELEMETRY;
    if (value === false || value === "false") return false;
  } catch {
    /* node --test */
  }
  if (typeof window === "undefined") {
    return typeof process !== "undefined" && process.env?.VITE_BETA_TELEMETRY === "true";
  }
  return true;
}

export function parseBetaTelemetryLine(line: string): BetaTelemetryRecord | null {
  try {
    const row = JSON.parse(line) as BetaTelemetryRecord;
    if (row.kind === "event" || row.kind === "answer" || row.kind === "feedback") return row;
    return null;
  } catch {
    return null;
  }
}

function loadLines(): string[] {
  const raw = readAccountStorage(BETA_TELEMETRY_STORAGE);
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
  writeAccountStorage(BETA_TELEMETRY_STORAGE, lines.length ? lines.join("\n") : null);
}

function appendRecord(record: BetaTelemetryRecord): void {
  assertFlightPrivacy(record as unknown as Record<string, unknown>);
  const lines = loadLines();
  lines.push(JSON.stringify(record));
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
  persistLines(lines);
}

export function betaTelemetryRecords(): BetaTelemetryRecord[] {
  return loadLines()
    .map(parseBetaTelemetryLine)
    .filter((row): row is BetaTelemetryRecord => row != null);
}

export function recordBetaEvent(
  event: BetaLifecycleEvent,
  input?: { workspaceId?: string; spaceId?: string; meta?: BetaEventRecord["meta"] },
): void {
  if (!isBetaTelemetryEnabled()) return;
  appendRecord({
    kind: "event",
    timestamp: Date.now(),
    event,
    workspaceId: input?.workspaceId ?? defaultWorkspaceId(),
    spaceId: input?.spaceId,
    meta: input?.meta,
  });
  trackReturnVisits();
}

/** Fire lifecycle event once per account (first occurrence only). */
export function recordBetaEventOnce(
  event: BetaLifecycleEvent,
  input?: { workspaceId?: string; spaceId?: string; meta?: BetaEventRecord["meta"] },
): void {
  if (!isBetaTelemetryEnabled()) return;
  const seen = betaTelemetryRecords().some((row) => row.kind === "event" && row.event === event);
  if (seen) return;
  recordBetaEvent(event, input);
}

export function recordBetaAnswer(input: Omit<BetaAnswerRecord, "kind" | "timestamp" | "answerId"> & { answerId?: string }): void {
  if (!isBetaTelemetryEnabled()) return;
  const answerId = input.answerId ?? input.traceId;
  appendRecord({
    kind: "answer",
    timestamp: Date.now(),
    answerId,
    workspaceId: input.workspaceId ?? defaultWorkspaceId(),
    ...input,
    traceId: input.traceId,
  });
}

export type BetaFeedbackInput = {
  traceId: string;
  answerId?: string;
  workspaceId?: string;
  spaceId?: string;
  sourceIds?: string[];
  tier: AnswerTier;
  latencyMs: number;
  result: BetaFeedbackResult;
  failureCategory?: NegativeFeedbackCategory;
};

export function recordBetaFeedback(input: BetaFeedbackInput): void {
  if (!isBetaTelemetryEnabled()) return;
  const answerId = input.answerId ?? input.traceId;
  appendRecord({
    kind: "feedback",
    timestamp: Date.now(),
    traceId: input.traceId,
    answerId,
    workspaceId: input.workspaceId ?? defaultWorkspaceId(),
    spaceId: input.spaceId,
    sourceIds: input.sourceIds ?? [],
    tier: input.tier,
    latencyMs: input.latencyMs,
    result: input.result,
    failureCategory: input.result === "not-useful" ? input.failureCategory : undefined,
  });
  if (input.result === "useful") {
    recordBetaEventOnce("ANSWER_MARKED_USEFUL", { workspaceId: input.workspaceId, spaceId: input.spaceId });
    recordBetaEvent("ANSWER_MARKED_USEFUL", { workspaceId: input.workspaceId, spaceId: input.spaceId });
  } else {
    recordBetaEvent("NEGATIVE_FEEDBACK", {
      workspaceId: input.workspaceId,
      spaceId: input.spaceId,
      meta: { category: input.failureCategory ?? "other" },
    });
  }
}

function firstEventTimestamp(event: BetaLifecycleEvent): number | null {
  const row = betaTelemetryRecords().find((record) => record.kind === "event" && record.event === event);
  return row?.timestamp ?? null;
}

export function summarizeBetaFunnel(): BetaFunnelSummary {
  const alias: Partial<Record<BetaFunnelStep, BetaLifecycleEvent[]>> = {
    USER_CREATED: ["USER_CREATED", "SIGNUP"],
    FIRST_QUESTION: ["FIRST_QUESTION", "FIRST_ASK"],
  };
  const steps = FUNNEL_ORDER.map((step) => {
    const events = alias[step] ?? [step];
    let timestamp: number | null = null;
    for (const event of events) {
      const ts = firstEventTimestamp(event);
      if (ts != null && (timestamp == null || ts < timestamp)) timestamp = ts;
    }
    return { step, timestamp };
  });
  const created = steps.find((row) => row.step === "USER_CREATED")?.timestamp;
  const useful = steps.find((row) => row.step === "ANSWER_MARKED_USEFUL")?.timestamp;
  return {
    steps,
    timeToFirstUsefulAnswerMs: created != null && useful != null ? useful - created : null,
  };
}

export function summarizeBetaLifecycle(): BetaLifecycleSummary {
  const records = betaTelemetryRecords();
  const events = records.filter((row): row is BetaEventRecord => row.kind === "event");
  const answers = records.filter((row): row is BetaAnswerRecord => row.kind === "answer");
  const feedback = records.filter((row): row is BetaFeedbackRecord => row.kind === "feedback");
  const count = (name: BetaLifecycleEvent) => events.filter((row) => row.event === name).length;
  return {
    signup: count("SIGNUP") + count("USER_CREATED"),
    sourceConnected: count("SOURCE_CONNECTED"),
    firstKnowledgeSpace: count("SPACE_CREATED"),
    firstAsk: count("FIRST_ASK") + count("FIRST_QUESTION"),
    firstLiveSession: count("FIRST_LIVE_SESSION"),
    questionsDetected: count("QUESTION_DETECTED") + answers.length,
    supportedAnswers: answers.filter((row) => row.supported).length,
    silentAnswers: answers.filter((row) => !row.supported).length,
    usefulAnswers: feedback.filter((row) => row.result === "useful").length,
    negativeFeedback: feedback.filter((row) => row.result === "not-useful").length,
    sessionsPerUser: count("SESSION_START"),
    returnAfter1Day: count("RETURN_DAY_1"),
    returnAfter7Day: count("RETURN_DAY_7"),
  };
}

const LAST_ACTIVE_KEY = "meethint.betaLastActive";

function trackReturnVisits(): void {
  if (typeof localStorage === "undefined") return;
  const now = Date.now();
  const raw = readAccountStorage(LAST_ACTIVE_KEY);
  const previous = raw ? Number(raw) : null;
  if (previous != null && Number.isFinite(previous)) {
    const dayMs = 24 * 60 * 60 * 1000;
    const elapsed = now - previous;
    if (elapsed >= dayMs && elapsed < dayMs * 2) recordBetaEventOnce("RETURN_DAY_1");
    if (elapsed >= dayMs * 7 && elapsed < dayMs * 8) recordBetaEventOnce("RETURN_DAY_7");
  }
  writeAccountStorage(LAST_ACTIVE_KEY, String(now));
}

export function noteBetaSessionStart(): void {
  if (!isBetaTelemetryEnabled()) return;
  recordBetaEventOnce("SESSION_START");
  recordBetaEvent("SESSION_START");
  trackReturnVisits();
}

export function noteBetaUserCreated(): void {
  if (!isBetaTelemetryEnabled()) return;
  recordBetaEventOnce("USER_CREATED");
  recordBetaEventOnce("SIGNUP");
}

export function exportBetaTelemetry(): { exportedAt: number; records: BetaTelemetryRecord[] } {
  return { exportedAt: Date.now(), records: betaTelemetryRecords() };
}

export function resetBetaTelemetry(): void {
  memoryLines = [];
  writeAccountStorage(BETA_TELEMETRY_STORAGE, null);
}
