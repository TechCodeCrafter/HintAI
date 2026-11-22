import { HOME_PROOF_CHIPS, NORTHSTAR } from "../repo/northstar.ts";
import type { Card } from "../repo/types.ts";
import { localCard } from "../search/local-card.ts";
import { buildChunks, retrieve } from "../search/retrieve.ts";
import { reportSearchDebug, SEARCH_DEBUG_TOP } from "../search/search-debug.ts";
import { isSearchDebug } from "../debug.ts";

/** Questions the public demo offers. They are the same lines the signed-in home proof uses. */
export const DEMO_QUESTIONS = HOME_PROOF_CHIPS;

/**
 * A cited card from the built-in payments pack.
 * No account, no microphone, and no network. The pack is already in the bundle.
 */
export function demoAnswer(query: string, startedAt = performance.now()): Card {
  const question = query.trim();
  const chunks = buildChunks(NORTHSTAR);
  const hits = retrieve(question, chunks);
  const card = localCard(question, hits, NORTHSTAR, Math.round(performance.now() - startedAt), null);
  if (isSearchDebug()) {
    // The demo has one answer stage. The wider ranking is for the log only.
    reportSearchDebug({
      query: question,
      chunks,
      filesLoaded: NORTHSTAR.files.length,
      ranked: retrieve(question, chunks, SEARCH_DEBUG_TOP),
      sent: hits,
      stage: card.say ? "localCard" : "silence",
      reason: card.reason,
      totalMs: Math.round(performance.now() - startedAt),
    });
  }
  return card;
}
