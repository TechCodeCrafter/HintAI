import type { Card, Citation, ConsideredSource } from "@/lib/repo/types";
import { sourceIdsFromCitations, sourceIdsFromEvidence } from "../context/material-view.ts";
import type { AnswerMode } from "./answer-mode";
import type { SilenceKind } from "./silence.ts";
import type { Evidence } from "./evidence.ts";

export const ANSWER_HISTORY_LIMIT = 50;

export type AnswerHistoryBadge = "from-docs" | "synthesized" | "generated";

export type AnswerHistoryScope = {
  workspaceId?: string;
  /** Compatibility alias — primary context when a space has one member. */
  contextId?: string;
  spaceId?: string;
  sourceIds?: string[];
  evidenceCount?: number;
};

export type AnswerHistoryItem = {
  id: string;
  workspaceId?: string;
  contextId?: string;
  spaceId?: string;
  sourceIds?: string[];
  evidenceCount?: number;
  query: string;
  say: string | null;
  /** Why a silent answer was silent. Absent on spoken answers and on items saved before this was recorded. */
  reason?: string;
  silence?: SilenceKind;
  badge: AnswerHistoryBadge | null;
  citations: Citation[];
  /** Other loaded files retrieval ranked for the question. Never evidence. */
  considered?: ConsideredSource[];
  /**
   * The exact spans a spoken answer was read from, so "Why this answer?" still
   * opens on an answer restored from history. Absent on silent answers and on
   * items saved before this was recorded.
   */
  evidence?: Evidence[];
  parts?: Card["parts"];
  timestamp: number;
};

/** Shown for a silent item saved before its reason was recorded. */
export const UNRECORDED_SILENCE_REASON = "No cited answer. The reason was not recorded for this question.";

export function badgeFromAnswerMode(mode?: AnswerMode, usedEvidence?: boolean): AnswerHistoryBadge | null {
  if (mode === "synthesized" && usedEvidence === false) return "generated";
  if (mode === "synthesized") return "synthesized";
  if (mode === "generated") return "generated";
  if (mode === "docs") return "from-docs";
  return null;
}

export function answerModeFromBadge(badge: AnswerHistoryBadge | null | undefined): AnswerMode | undefined {
  if (badge === "from-docs") return "docs";
  if (badge === "synthesized") return "synthesized";
  if (badge === "generated") return "generated";
  return undefined;
}

export function telemetryFromCard(card: Card, scope?: AnswerHistoryScope) {
  const fromEvidence = card.evidence?.length ? sourceIdsFromEvidence(card.evidence) : [];
  const fromCitations = sourceIdsFromCitations(card.citations ?? []);
  const sourceIds = scope?.sourceIds ?? [...new Set([...fromEvidence, ...fromCitations])];
  const evidenceCount =
    scope?.evidenceCount ??
    (card.evidence && card.evidence.length > 0 ? card.evidence.length : card.citations.length);
  return { sourceIds, evidenceCount };
}

export function historyItemFromCard(
  card: Card,
  at = Date.now(),
  scope?: AnswerHistoryScope,
): AnswerHistoryItem {
  const telemetry = telemetryFromCard(card, scope);
  return {
    id: `${at}-${Math.random().toString(36).slice(2, 7)}`,
    workspaceId: scope?.workspaceId,
    contextId: scope?.contextId,
    spaceId: scope?.spaceId,
    sourceIds: telemetry.sourceIds,
    evidenceCount: telemetry.evidenceCount,
    query: card.query,
    say: card.say,
    ...(card.say ? {} : { reason: card.reason, silence: card.silence }),
    badge:
      badgeFromAnswerMode(card.answerMode, card.usedEvidence ?? card.citations.length > 0) ??
      (card.say ? "from-docs" : null),
    citations: card.citations ?? [],
    ...(card.considered?.length ? { considered: card.considered } : {}),
    ...(card.say && card.evidence?.length ? { evidence: card.evidence } : {}),
    ...(card.say && card.parts?.length ? { parts: card.parts } : {}),
    timestamp: at,
  };
}

export function appendAnswerHistory(
  history: AnswerHistoryItem[],
  card: Card,
  scope?: AnswerHistoryScope,
): AnswerHistoryItem[] {
  if (!card.query.trim()) return history;
  return [historyItemFromCard(card, Date.now(), scope), ...history].slice(0, ANSWER_HISTORY_LIMIT);
}

export function cardFromHistory(item: AnswerHistoryItem): Card {
  return {
    say: item.say,
    reason: item.say ? undefined : item.reason?.trim() || UNRECORDED_SILENCE_REASON,
    silence: item.say ? undefined : item.silence,
    citations: item.citations,
    ...(item.considered?.length ? { considered: item.considered } : {}),
    ...(item.say && item.evidence?.length ? { evidence: item.evidence } : {}),
    ...(item.say && item.parts?.length ? { parts: item.parts } : {}),
    query: item.query,
    latencyMs: 0,
    source: item.badge ?? "local",
    answerMode: answerModeFromBadge(item.badge),
  };
}

export function findHistoryItem(
  id: string,
  ...lists: Array<AnswerHistoryItem[] | undefined>
): AnswerHistoryItem | undefined {
  for (const list of lists) {
    const found = list?.find((item) => item.id === id);
    if (found) return found;
  }
  return undefined;
}
