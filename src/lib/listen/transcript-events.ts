import type { HeardEvent, Utterance } from "@/lib/repo/types";
import { cleanCaption } from "../search/question.ts";

/**
 * What a committed clip did to the transcript.
 *
 * The rule this file exists to enforce: DEDUPE EVENTS, NOT TEXT. Whisper cannot
 * tell "how does the export work?" asked once from the same words asked twice —
 * only the commit boundary knows, so identity is carried from there and text
 * equality never decides whether something is new.
 */
export type HeardOutcome =
  /** Nothing to record — empty after cleaning. */
  | { kind: "empty"; utterances: Utterance[] }
  /** The same commit event re-emitted unchanged. */
  | { kind: "ignored"; utterances: Utterance[]; text: string }
  /** The same commit event, re-decoded into better text. One line, updated. */
  | { kind: "rewritten"; utterances: Utterance[]; text: string }
  /** A clip we have not seen before, whatever it happens to say. */
  | { kind: "appended"; utterances: Utterance[]; text: string };

export function applyHeard(utterances: Utterance[], event: HeardEvent, at: number): HeardOutcome {
  const text = cleanCaption(event.text);
  if (!text) return { kind: "empty", utterances };

  const owned = utterances.find((u) => u.id === event.id);
  if (owned) {
    if (owned.text === text) return { kind: "ignored", utterances, text };
    return {
      kind: "rewritten",
      text,
      utterances: utterances.map((u) => (u.id === event.id ? { ...u, text } : u)),
    };
  }

  return {
    kind: "appended",
    text,
    utterances: [
      ...utterances,
      {
        id: event.id,
        at,
        speaker: event.role === "them" ? "They" : "You",
        role: event.role,
        text,
      },
    ],
  };
}

/**
 * The line a decision should be judged against: the newest thing the other
 * person said. An older clip finishing late may correct the transcript, but it
 * is not what the room is asking about now.
 */
export function newestFrom(utterances: Utterance[]): Utterance | undefined {
  return utterances.filter((u) => u.role === "them").at(-1);
}
