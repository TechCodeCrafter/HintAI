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
    answerMode: "grounded",
  };
}

export function applyAssist(query: string, remoteSay: string | null, latencyMs: number): Card {
  if (!remoteSay) return silentAssist(query, "Nothing to suggest.", latencyMs);
  return {
    say: remoteSay,
    reason: "Suggested — verify before using",
    citations: [],
    query,
    latencyMs,
    source: "assisted",
    answerMode: "assisted",
  };
}

export async function assistCard(query: string, thread: ThreadContext | null, t0: number): Promise<Card> {
  try {
    const { callCraftCard } = await import("@/lib/e2e-hooks");
    const remote = await Promise.race([
      callCraftCard({
        query,
        hits: [],
        threadContext: thread?.canonical ?? null,
        task: "assist",
        instruction:
          "Answer this meeting question from general knowledge. Be concise. If unsure, say so. Do not invent specific facts about the user's material.",
      }),
      new Promise<never>((_, reject) => {
        window.setTimeout(() => reject(new Error("timeout")), 4000);
      }),
    ]);
    return applyAssist(query, remote.say, Math.round(performance.now() - t0));
  } catch {
    return silentAssist(query, "Could not suggest an answer.", Math.round(performance.now() - t0));
  }
}
