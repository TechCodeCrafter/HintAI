import type { AnswerHistoryItem } from "./answer-history.ts";
import { citationChipText } from "./cite.ts";

export type SessionReceiptEntry =
  | { kind: "answered"; item: AnswerHistoryItem }
  | { kind: "unsupported"; item: AnswerHistoryItem };

export type SessionReceipt = {
  spaceName: string;
  generatedAt: string;
  entries: SessionReceiptEntry[];
  answeredCount: number;
  unsupportedCount: number;
};

/** A receipt line may only claim an answer when citations back it (cite-or-silence). */
export function isReceiptAnswer(item: AnswerHistoryItem): boolean {
  if (!item.say?.trim()) return false;
  if (item.badge === "generated") return false;
  if (item.badge === "synthesized" && item.citations.length === 0) return false;
  return item.citations.length > 0;
}

export function buildSessionReceipt(
  items: AnswerHistoryItem[],
  spaceName: string,
  at = new Date(),
): SessionReceipt {
  const chronological = [...items].sort((a, b) => a.timestamp - b.timestamp);
  const entries: SessionReceiptEntry[] = chronological.map((item) =>
    isReceiptAnswer(item) ? { kind: "answered", item } : { kind: "unsupported", item },
  );
  const answeredCount = entries.filter((row) => row.kind === "answered").length;
  return {
    spaceName,
    generatedAt: at.toISOString(),
    entries,
    answeredCount,
    unsupportedCount: entries.length - answeredCount,
  };
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatCitations(item: AnswerHistoryItem): string[] {
  return item.citations.map((cite) => citationChipText(cite));
}

/**
 * Plain-text session receipt — safe to paste into email or Slack.
 * Unsupported questions are listed without invented answers.
 */
export function formatSessionReceiptText(receipt: SessionReceipt): string {
  const lines: string[] = [
    "MeetHint — Session receipt",
    `Knowledge Space: ${receipt.spaceName}`,
    `Generated: ${new Date(receipt.generatedAt).toLocaleString()}`,
    "",
    `Summary: ${receipt.answeredCount} cited answer${receipt.answeredCount === 1 ? "" : "s"}, ${receipt.unsupportedCount} unsupported question${receipt.unsupportedCount === 1 ? "" : "s"}`,
    "",
  ];

  if (receipt.entries.length === 0) {
    lines.push("No questions were recorded in this session.");
    return lines.join("\n");
  }

  let index = 0;
  for (const entry of receipt.entries) {
    index += 1;
    const { item } = entry;
    lines.push(`--- ${index}. ${formatTime(item.timestamp)} ---`);
    lines.push(`Question: ${item.query}`);
    if (entry.kind === "answered") {
      lines.push(`Answer: ${item.say}`);
      const cites = formatCitations(item);
      if (cites.length > 0) {
        lines.push("Evidence:");
        for (const cite of cites) lines.push(`  • ${cite}`);
      }
    } else {
      lines.push("Answer: Not supported — no cited evidence in authorized material.");
    }
    lines.push("");
  }

  lines.push(
    "—",
    "Every answer above is backed by the cited source coordinates in your Knowledge Space.",
    "Questions marked unsupported had no speakable, cited evidence.",
  );
  return lines.join("\n");
}
