import type { Card, Hit, RepoPack } from "../repo/types.ts";
import {
  generateAnswer,
  generateGeneralAnswer,
  synthesizeAnswer,
  type AnswerResult,
  type GenerateOpts,
  type GeneratedAnswer,
} from "./generate-answer.ts";
import { localCard } from "./local-card.ts";

const ERROR_REASON_CAP = 120;

export function silentCardReason(hitCount: number, errorMessage?: string): string {
  const message = errorMessage?.replace(/\s+/g, " ").trim();
  if (message) return `Couldn't generate an answer: ${message.slice(0, ERROR_REASON_CAP)}`;
  return hitCount === 0 ? "No matching material" : "Your material doesn't cover this";
}

export type RoutedSearchAnswer = {
  card: Card;
  consumeQuota: boolean;
};

function noteError(first: string | undefined, result: AnswerResult): string | undefined {
  if (first) return first;
  if (!result.ok && result.reason === "error" && result.message.trim()) return result.message.trim();
  return first;
}

function isTransportError(result: AnswerResult): boolean {
  if (result.ok || result.reason !== "error") return false;
  return /timeout|api key|empty prompt|\b401\b|\b403\b|\b429\b/i.test(result.message);
}

function successCard(query: string, answer: GeneratedAnswer, fallbackSource: string): RoutedSearchAnswer {
  return {
    consumeQuota: true,
    card: {
      say: answer.say,
      citations: answer.citations,
      query,
      latencyMs: answer.latencyMs,
      source: answer.modelName ?? fallbackSource,
      answerMode: answer.answerMode,
      usedEvidence: answer.usedEvidence,
      modelName: answer.modelName,
    },
  };
}

/**
 * Grounded first. If that fails and retrieval found something, synthesize
 * from the chunks. Only then general knowledge. localCard is the offline last resort.
 */
export async function routeSearchAnswer(
  query: string,
  hits: Hit[],
  t0: number,
  opts?: GenerateOpts & { pack?: RepoPack },
): Promise<RoutedSearchAnswer> {
  let firstError: string | undefined;

  const grounded = await generateAnswer(query, hits, t0, opts);
  if (grounded.ok) return successCard(query, grounded.answer, "local");
  firstError = noteError(firstError, grounded);
  if (isTransportError(grounded)) return failedCard(query, hits.length, t0, firstError);

  if (hits.length > 0) {
    const synthesized = await synthesizeAnswer(query, hits, t0, opts);
    if (synthesized.ok) return successCard(query, synthesized.answer, "synthesize");
    firstError = noteError(firstError, synthesized);
    if (isTransportError(synthesized)) return failedCard(query, hits.length, t0, firstError);
  }

  const general = await generateGeneralAnswer(query, t0, opts);
  if (general.ok) return successCard(query, general.answer, "generated");
  firstError = noteError(firstError, general);

  return silentRouted(query, hits, t0, firstError, opts?.pack);
}

function failedCard(
  query: string,
  hitCount: number,
  t0: number,
  firstError: string | undefined,
): RoutedSearchAnswer {
  return {
    consumeQuota: false,
    card: {
      say: null,
      reason: silentCardReason(hitCount, firstError),
      citations: [],
      query,
      latencyMs: Math.round(performance.now() - t0),
      source: "local",
    },
  };
}

function silentRouted(
  query: string,
  hits: Hit[],
  t0: number,
  firstError: string | undefined,
  pack?: RepoPack,
): RoutedSearchAnswer {
  if (pack) {
    const local = localCard(query, hits, pack, Math.round(performance.now() - t0));
    if (local.say) {
      return { consumeQuota: false, card: { ...local, answerMode: "docs" } };
    }
  }
  return failedCard(query, hits.length, t0, firstError);
}
