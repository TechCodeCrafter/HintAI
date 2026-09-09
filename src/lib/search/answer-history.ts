import type { Card, Citation } from "@/lib/repo/types";
import type { AnswerMode } from "./answer-mode";

export const ANSWER_HISTORY_LIMIT = 50;

export type AnswerHistoryBadge = "from-docs" | "synthesized" | "generated";

export type AnswerHistoryItem = {
  id: string;
  query: string;
  say: string | null;
  badge: AnswerHistoryBadge | null;
  citations: Citation[];
  timestamp: number;
};

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

export function historyItemFromCard(card: Card, at = Date.now()): AnswerHistoryItem {
  return {
    id: `${at}-${Math.random().toString(36).slice(2, 7)}`,
    query: card.query,
    say: card.say,
    badge:
      badgeFromAnswerMode(card.answerMode, card.usedEvidence ?? card.citations.length > 0) ??
      (card.say ? "from-docs" : null),
    citations: card.citations ?? [],
    timestamp: at,
  };
}

export function appendAnswerHistory(history: AnswerHistoryItem[], card: Card): AnswerHistoryItem[] {
  if (!card.query.trim()) return history;
  return [historyItemFromCard(card), ...history].slice(0, ANSWER_HISTORY_LIMIT);
}

export function cardFromHistory(item: AnswerHistoryItem): Card {
  return {
    say: item.say,
    reason: item.say ? undefined : "Could not generate an answer.",
    citations: item.citations,
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
