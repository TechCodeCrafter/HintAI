import type { AnswerStageTimings } from "../instrumentation/answer-latency.ts";
import { classifyProgressiveAgreement } from "../instrumentation/progressive-agreement.ts";
import { buildProgressiveTiming, type ProgressiveTiming } from "../instrumentation/progressive-timing.ts";
import type { SpaceMaterialView } from "../context/material-view.ts";
import type { Card, Hit, RepoPack } from "../repo/types.ts";
import {
  localCardFastPathEligible,
  shouldFailFastRetrieval,
} from "./answer-fast-path.ts";
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

/** Backward-compatible latency object; extended stages are optional on older records. */
export type SearchLatency = AnswerStageTimings;

export type RoutedSearchAnswer = {
  card: Card;
  consumeQuota: boolean;
  tier: AnswerTier;
  latency: SearchLatency;
  /** True when a verified localCard skipped grounded/synthesis LLM. */
  llmBypassed?: boolean;
  /** Observation-only shadow localCard timing when measureProgressive is set. */
  progressive?: ProgressiveTiming;
};

export type RouteSearchOpts = GenerateOpts & {
  pack?: RepoPack;
  material?: SpaceMaterialView;
  cardContext?: LocalCardContext;
  /** Time spent in retrieveHits before routing. */
  retrieveMs?: number;
  /** Shadow localCard before LLM tiers — flight capture only, does not change routing. */
  measureProgressive?: boolean;
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
  stages?: Partial<AnswerStageTimings>,
): SearchLatency {
  return {
    retrieveMs,
    llmMs: timing.llmMs,
    verifyMs: timing.verifyMs,
    totalMs: Math.round(performance.now() - t0),
    ...stages,
  };
}

function successCard(
  query: string,
  answer: GeneratedAnswer,
  fallbackSource: string,
  tier: AnswerTier,
  latency: SearchLatency,
  progressive?: ProgressiveTiming,
  llmBypassed?: boolean,
): RoutedSearchAnswer {
  return {
    consumeQuota: true,
    tier,
    latency,
    progressive,
    llmBypassed,
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

type LocalAttempt = {
  card: Card;
  localCardMs: number;
  supported: boolean;
  say: string | null;
};

function runLocalCard(
  query: string,
  hits: Hit[],
  t0: number,
  opts?: Pick<RouteSearchOpts, "pack" | "material" | "cardContext">,
): LocalAttempt | null {
  if (!opts?.pack) return null;
  const ctx: LocalCardContext = {
    ...opts.cardContext,
    material: opts.material ?? opts.cardContext?.material,
  };
  const localStart = performance.now();
  const card = localCard(query, hits, opts.pack, Math.round(performance.now() - t0), null, ctx);
  const localCardMs = Math.round(performance.now() - localStart);
  return {
    card,
    localCardMs,
    supported: Boolean(card.say),
    say: card.say ?? null,
  };
}

function localCardRouteFromAttempt(
  query: string,
  t0: number,
  retrieveMs: number,
  attempt: LocalAttempt,
  routeStages?: Partial<AnswerStageTimings>,
  progressive?: ProgressiveTiming,
  llmBypassed?: boolean,
): RoutedSearchAnswer | null {
  if (!attempt.card.say) return null;
  return {
    consumeQuota: false,
    tier: "localCard",
    llmBypassed,
    latency: latencyOf(
      t0,
      retrieveMs,
      { llmMs: 0, verifyMs: 0 },
      { ...routeStages, localCardMs: attempt.localCardMs },
    ),
    progressive,
    card: { ...attempt.card, answerMode: "docs", usedEvidence: true },
  };
}

function failedCard(
  query: string,
  hitCount: number,
  t0: number,
  retrieveMs: number,
  firstError: string | undefined,
  stages?: Partial<AnswerStageTimings>,
  progressive?: ProgressiveTiming,
): RoutedSearchAnswer {
  return {
    consumeQuota: false,
    tier: "silent",
    latency: latencyOf(t0, retrieveMs, { llmMs: stages?.llmMs ?? 0, verifyMs: stages?.verifyMs ?? 0 }, stages),
    progressive,
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
 * Production routing (Milestone 2 Step 5C):
 * 1. Fail-fast on empty/weak retrieval — no LLM
 * 2. High-confidence verified localCard — skip LLM when evidence contract is already satisfied
 * 3. Grounded LLM (generateAnswer)
 * 4. Cited synthesis LLM (synthesizeAnswer)
 * 5. localCard fallback — never general knowledge
 */
export async function routeSearchAnswer(
  query: string,
  hits: Hit[],
  t0: number,
  opts?: RouteSearchOpts,
): Promise<RoutedSearchAnswer> {
  const retrieveMs = opts?.retrieveMs ?? 0;
  const routeStart = performance.now();
  let firstError: string | undefined;
  let llmMs = 0;
  let verifyMs = 0;
  let groundedMs = 0;
  let synthesisMs = 0;
  let localCardMs = 0;

  const routeStages = (): Partial<AnswerStageTimings> => ({
    routeMs: Math.round(performance.now() - routeStart),
    groundedMs,
    synthesisMs,
    localCardMs,
    llmMs,
    verifyMs,
  });

  const localAttempt = runLocalCard(query, hits, t0, opts);
  if (localAttempt) localCardMs = localAttempt.localCardMs;

  const shadow = opts?.measureProgressive && localAttempt
    ? {
        supported: localAttempt.supported,
        ms: localAttempt.localCardMs,
        earliestSupportedMs: localAttempt.supported ? Math.round(performance.now() - t0) : null as number | null,
        say: localAttempt.say,
      }
    : { supported: false, ms: 0, earliestSupportedMs: null as number | null, say: null as string | null };

  const progressiveFor = (tier: AnswerTier, totalMs: number, finalSay: string | null): ProgressiveTiming =>
    buildProgressiveTiming({
      tier,
      totalMs,
      shadowLocalCardSupported: shadow.supported,
      earliestSupportedMs: shadow.earliestSupportedMs,
      shadowLocalCardMs: shadow.ms,
      progressiveAgreement: opts?.measureProgressive
        ? classifyProgressiveAgreement(shadow.say, finalSay, tier)
        : undefined,
    });

  if (shouldFailFastRetrieval(query, hits)) {
    const latency = latencyOf(t0, retrieveMs, { llmMs: 0, verifyMs: 0 }, routeStages());
    return failedCard(query, hits.length, t0, retrieveMs, firstError, routeStages(), progressiveFor("silent", latency.totalMs, null));
  }

  if (localAttempt && localCardFastPathEligible(localAttempt.card, hits)) {
    const routed = localCardRouteFromAttempt(
      query,
      t0,
      retrieveMs,
      localAttempt,
      routeStages(),
      progressiveFor("localCard", Math.round(performance.now() - t0), localAttempt.say),
      true,
    );
    if (routed) return routed;
  }

  const groundedStart = performance.now();
  const grounded = await generateAnswer(query, hits, t0, opts);
  groundedMs = Math.round(performance.now() - groundedStart);
  if (grounded.timing) {
    llmMs += grounded.timing.llmMs;
    verifyMs += grounded.timing.verifyMs;
  }

  if (grounded.ok) {
    const latency = latencyOf(t0, retrieveMs, grounded.timing, routeStages());
    return successCard(
      query,
      grounded.answer,
      "local",
      "grounded",
      latency,
      progressiveFor("grounded", latency.totalMs, grounded.answer.say),
    );
  }
  firstError = noteError(firstError, grounded);
  if (isTransportError(grounded)) {
    const latency = latencyOf(t0, retrieveMs, { llmMs, verifyMs }, routeStages());
    return failedCard(query, hits.length, t0, retrieveMs, firstError, routeStages(), progressiveFor("silent", latency.totalMs, null));
  }

  if (hits.length > 0) {
    const synthesisStart = performance.now();
    const synthesized = await synthesizeAnswer(query, hits, t0, opts);
    synthesisMs = Math.round(performance.now() - synthesisStart);
    if (synthesized.timing) {
      llmMs += synthesized.timing.llmMs;
      verifyMs += synthesized.timing.verifyMs;
    }
    if (
      synthesized.ok &&
      synthesized.answer.usedEvidence &&
      synthesized.answer.citations.length > 0
    ) {
      const latency = latencyOf(t0, retrieveMs, synthesized.timing, routeStages());
      return successCard(
        query,
        synthesized.answer,
        "synthesize",
        "synthesis",
        latency,
        progressiveFor("synthesis", latency.totalMs, synthesized.answer.say),
      );
    }
    firstError = noteError(firstError, synthesized);
    if (isTransportError(synthesized)) {
      const latency = latencyOf(t0, retrieveMs, { llmMs, verifyMs }, routeStages());
      return failedCard(query, hits.length, t0, retrieveMs, firstError, routeStages(), progressiveFor("silent", latency.totalMs, null));
    }
  }

  if (localAttempt) {
    const local = localCardRouteFromAttempt(
      query,
      t0,
      retrieveMs,
      localAttempt,
      routeStages(),
      progressiveFor("localCard", Math.round(performance.now() - t0), localAttempt.say),
    );
    if (local) {
      return {
        ...local,
        progressive: progressiveFor("localCard", local.latency.totalMs, local.card.say),
      };
    }
  }

  const latency = latencyOf(t0, retrieveMs, { llmMs, verifyMs }, routeStages());
  return failedCard(query, hits.length, t0, retrieveMs, firstError, routeStages(), progressiveFor("silent", latency.totalMs, null));
}
