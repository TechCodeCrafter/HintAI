import type { Card, Hit } from "../repo/types.ts";
import { verifyClaim } from "./evidence.ts";
import { refinePayload } from "./refine-payload.ts";

export function applyPolish(evidenceCard: Card, remoteSay: string | null, latencyMs: number): Card {
  if (!remoteSay || remoteSay === evidenceCard.say) {
    return { ...evidenceCard, answerMode: "docs", latencyMs };
  }
  const evidence = evidenceCard.evidence ?? [];
  // A rewrite that cannot be admitted is the model's sentence. Keep the extract.
  if (evidence.length === 0 || !verifyClaim(remoteSay, evidence).ok) {
    return { ...evidenceCard, answerMode: "docs", latencyMs };
  }
  return {
    ...evidenceCard,
    say: remoteSay,
    latencyMs,
    source: "local",
    answerMode: "docs",
    evidence: evidenceCard.evidence,
    citations: evidenceCard.citations,
  };
}

export async function polishCard(
  evidenceCard: Card,
  query: string,
  hits: Hit[],
  t0: number,
): Promise<Card> {
  try {
    const { callCraftCard } = await import("@/lib/e2e-hooks");
    const remote = await Promise.race([
      callCraftCard({
        query,
        hits: refinePayload(hits),
        evidenceSay: evidenceCard.say ?? undefined,
        task: "polish",
        instruction:
          "Rewrite this answer to sound more natural in a spoken meeting, but DO NOT change any facts. Keep the citation.",
      }),
      new Promise<never>((_, reject) => {
        window.setTimeout(() => reject(new Error("timeout")), 4000);
      }),
    ]);
    return applyPolish(evidenceCard, remote.say, Math.round(performance.now() - t0));
  } catch {
    return { ...evidenceCard, answerMode: "docs" };
  }
}
