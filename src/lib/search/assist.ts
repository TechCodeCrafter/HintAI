import type { Card } from "../repo/types.ts";
import type { ThreadContext } from "./thread.ts";

export function silentAssist(query: string, reason: string, latencyMs = 0): Card {
  return {
    say: null,
    reason,
    citations: [],
    query,
    latencyMs,
    source: "local",
    answerMode: "docs",
  };
}

export function applyAssist(query: string, _remoteSay: string | null, latencyMs: number): Card {
  return silentAssist(query, "Nothing to suggest.", latencyMs);
}

export async function assistCard(query: string, _thread: ThreadContext | null, t0: number): Promise<Card> {
  return silentAssist(query, "Nothing to suggest.", Math.round(performance.now() - t0));
}
