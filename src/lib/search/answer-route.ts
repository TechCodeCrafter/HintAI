import type { Card, Hit, RepoPack } from "../repo/types.ts";
import { generateAnswer, generateGeneralAnswer, type GenerateOpts } from "./generate-answer.ts";
import { localCard } from "./local-card.ts";

/** Strong lexical overlap — extract only from the files. */
export const STRONG_EVIDENCE_SCORE = 6;
/** Some overlap — use the files when they help, general knowledge when they do not. */
export const WEAK_EVIDENCE_SCORE = 2;

export type AnswerRoute = "extract" | "synthesize" | "freely";

export function routeFromScore(score: number): AnswerRoute {
  if (score >= STRONG_EVIDENCE_SCORE) return "extract";
  if (score >= WEAK_EVIDENCE_SCORE) return "synthesize";
  return "freely";
}

export function silentCardReason(hitCount: number): string {
  return hitCount === 0 ? "No matching material" : "Your material doesn't cover this";
}

export type RoutedSearchAnswer = {
  card: Card;
  consumeQuota: boolean;
};

/**
 * Grounded attempt first. If that fails, general knowledge.
 * localCard is only the offline fallback when both LLM paths return null.
 */
export async function routeSearchAnswer(
  query: string,
  hits: Hit[],
  t0: number,
  opts?: GenerateOpts & { pack?: RepoPack },
): Promise<RoutedSearchAnswer> {
  const grounded = await generateAnswer(query, hits, t0, opts);
  if (grounded) {
    return {
      consumeQuota: true,
      card: {
        say: grounded.say,
        citations: grounded.citations,
        query,
        latencyMs: grounded.latencyMs,
        source: grounded.modelName ?? "local",
        answerMode: "docs",
        modelName: grounded.modelName,
      },
    };
  }

  const general = await generateGeneralAnswer(query, t0, opts);
  if (general) {
    return {
      consumeQuota: true,
      card: {
        say: general.say,
        citations: [],
        query,
        latencyMs: general.latencyMs,
        source: general.modelName ?? "generated",
        answerMode: "generated",
        modelName: general.modelName,
      },
    };
  }

  const pack = opts?.pack;
  if (pack) {
    const local = localCard(query, hits, pack, Math.round(performance.now() - t0));
    if (local.say) {
      return { consumeQuota: false, card: { ...local, answerMode: "docs" } };
    }
  }

  return {
    consumeQuota: false,
    card: {
      say: null,
      reason: silentCardReason(hits.length),
      citations: [],
      query,
      latencyMs: Math.round(performance.now() - t0),
      source: "local",
    },
  };
}
