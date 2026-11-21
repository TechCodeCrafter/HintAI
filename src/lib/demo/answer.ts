import { HOME_PROOF_CHIPS, NORTHSTAR } from "../repo/northstar.ts";
import type { Card } from "../repo/types.ts";
import { localCard } from "../search/local-card.ts";
import { buildChunks, retrieve } from "../search/retrieve.ts";

/** Questions the public demo offers. They are the same lines the signed-in home proof uses. */
export const DEMO_QUESTIONS = HOME_PROOF_CHIPS;

/**
 * A cited card from the built-in payments pack.
 * No account, no microphone, and no network. The pack is already in the bundle.
 */
export function demoAnswer(query: string, startedAt = performance.now()): Card {
  const question = query.trim();
  const hits = retrieve(question, buildChunks(NORTHSTAR));
  const card = localCard(question, hits, NORTHSTAR, Math.round(performance.now() - startedAt), null);
  return card;
}
