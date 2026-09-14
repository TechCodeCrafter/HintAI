import type { SpaceMaterialView } from "../context/material-view.ts";
import type { Card, Hit, RepoPack } from "../repo/types.ts";
import type { LocalCardContext } from "./local-card.ts";
import {
  generateAnswer,
  synthesizeAnswer,
  type AnswerResult,
  type AnswerTiming,
  type GenerateOpts,
  type GeneratedAnswer,
} from "./generate-answer.ts";
import { localCard } from "./local-card.ts";

const ERROR_REASON_CAP = 120;

export function silentCardReason(hitCount: number, errorMessage?: string): string {
  const message = errorMessage?.replace(/\s+/g, " ").trim();
  if (message) return `Couldn't produce a cited answer: ${message.slice(0, ERROR_REASON_CAP)}`;
  return hitCount === 0 ? "No matching material" : "Your material doesn't cover this";
}

export type AnswerTier = "grounded" | "synthesis" | "localCard" | "silent";

export type SearchLatency = {
  retrieveMs: number;
  llmMs: number;
  verifyMs: number;
  totalMs: number;
};

export type RoutedSearchAnswer = {
  card: Card;
  consumeQuota: boolean;
  tier: AnswerTier;
  latency: SearchLatency;
};

export type RouteSearchOpts = GenerateOpts & {
  pack?: RepoPack;
  material?: SpaceMaterialView;
  cardContext?: LocalCardContext;
  /** Time spent in retrieveHits before routing. */
  retrieveMs?: number;
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

function latencyOf(
  t0: number,
  retrieveMs: number,
  timing: AnswerTiming = { llmMs: 0, verifyMs: 0 },
): SearchLatency {
  return {
    retrieveMs,
    llmMs: timing.llmMs,
    verifyMs: timing.verifyMs,
    totalMs: Math.round(performance.now() - t0),
  };
}

function successCard(
  query: string,
  answer: GeneratedAnswer,
  fallbackSource: string,
  tier: AnswerTier,
  latency: SearchLatency,
): RoutedSearchAnswer {
  return {
    consumeQuota: true,
    tier,
    latency,
    card: {
      say: answer.say,
      citations: answer.citations,
      evidence: answer.evidence,
      query,
      latencyMs: answer.latencyMs,
      source: answer.modelName ?? fallbackSource,
      answerMode: answer.answerMode,
      usedEvidence: answer.usedEvidence,
      modelName: answer.modelName,
    },
  };
}

function localCardRoute(
  query: string,
  hits: Hit[],
  t0: number,
  retrieveMs: number,
  opts?: Pick<RouteSearchOpts, "pack" | "material" | "cardContext">,
): RoutedSearchAnswer | null {
  if (!opts?.pack) return null;
  const ctx: LocalCardContext = {
    ...opts.cardContext,
    material: opts.material ?? opts.cardContext?.material,
  };
  const local = localCard(query, hits, opts.pack, Math.round(performance.now() - t0), null, ctx);
  if (!local.say) return null;
  return {
    consumeQuota: false,
    tier: "localCard",
    latency: latencyOf(t0, retrieveMs),
    card: { ...local, answerMode: "docs", usedEvidence: true },
  };
}

function failedCard(
  query: string,
  hitCount: number,
  t0: number,
  retrieveMs: number,
  firstError: string | undefined,
): RoutedSearchAnswer {
  return {
    consumeQuota: false,
    tier: "silent",
    latency: latencyOf(t0, retrieveMs),
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

/**
 * Grounded first. Cited synthesis second. localCard third — never general knowledge.
 * Uncited weak synthesis is not returned; it would block the offline cited path.
 */
export async function routeSearchAnswer(
  query: string,
  hits: Hit[],
  t0: number,
  opts?: RouteSearchOpts,
): Promise<RoutedSearchAnswer> {
  const retrieveMs = opts?.retrieveMs ?? 0;
  let firstError: string | undefined;

  const grounded = await generateAnswer(query, hits, t0, opts);
  if (grounded.ok) {
    return successCard(query, grounded.answer, "local", "grounded", latencyOf(t0, retrieveMs, grounded.timing));
  }
  firstError = noteError(firstError, grounded);
  if (isTransportError(grounded)) return failedCard(query, hits.length, t0, retrieveMs, firstError);

  if (hits.length > 0) {
    const synthesized = await synthesizeAnswer(query, hits, t0, opts);
    if (
      synthesized.ok &&
      synthesized.answer.usedEvidence &&
      synthesized.answer.citations.length > 0
    ) {
      return successCard(
        query,
        synthesized.answer,
        "synthesize",
        "synthesis",
        latencyOf(t0, retrieveMs, synthesized.timing),
      );
    }
    firstError = noteError(firstError, synthesized);
    if (isTransportError(synthesized)) return failedCard(query, hits.length, t0, retrieveMs, firstError);
  }

  const local = localCardRoute(query, hits, t0, retrieveMs, opts);
  if (local) return local;

  return failedCard(query, hits.length, t0, retrieveMs, firstError);
}
