import type { AnswerStageTimings } from "../instrumentation/answer-latency.ts";
import { classifyProgressiveAgreement } from "../instrumentation/progressive-agreement.ts";
import { buildProgressiveTiming, type ProgressiveTiming } from "../instrumentation/progressive-timing.ts";
import type { SpaceMaterialView } from "../context/material-view.ts";
import type { Card, Hit, RepoPack } from "../repo/types.ts";
import { failFastCause, localCardFastPathEligible } from "./answer-fast-path.ts";
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
import { explainSilence, type FailFastCause, type Silence } from "./silence.ts";
import { withConsidered } from "./considered.ts";

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
  /**
   * Chunks in the index that retrieval searched. Zero with no hits is reported
   * as an empty index, not as "nothing covers this".
   */
  indexedChunks?: number;
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

/**
 * The only way the route goes silent. It never speaks, never spends quota, and
 * always says why: `why` comes from `explainSilence`, which has no empty case.
 */
function failedCard(
  query: string,
  why: Silence,
  t0: number,
  retrieveMs: number,
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
      reason: why.reason,
      silence: why.kind,
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
 *
 * Every silent exit goes through `silence()` below, so each one names its own
 * cause: nothing indexed, no match, weak match, model unreachable, or what the
 * composer found missing in the hits it read.
 */
export async function routeSearchAnswer(
  query: string,
  hits: Hit[],
  t0: number,
  opts?: RouteSearchOpts,
): Promise<RoutedSearchAnswer> {
  const routed = await routeAnswer(query, hits, t0, opts);
  // Whichever tier answered (composer, grounded model, synthesis, or none),
  // the Card lists the other loaded files these same hits came from. Done once
  // here so a model answer and a composer answer cannot differ in what they show.
  const card = withConsidered(routed.card, hits, {
    pack: opts?.pack,
    material: opts?.material ?? opts?.cardContext?.material,
    document: opts?.cardContext?.document,
  });
  return { ...routed, card };
}

async function routeAnswer(
  query: string,
  hits: Hit[],
  t0: number,
  opts?: RouteSearchOpts,
): Promise<RoutedSearchAnswer> {
  const retrieveMs = opts?.retrieveMs ?? 0;
  const routeStart = performance.now();
  let firstError: string | undefined;
  // A model stage ran to the end and declined ("insufficient", or a line that
  // failed verification). Once that is true the files were read, so a
  // transport error from another stage is not why the room hears nothing.
  let modelDeclined = false;
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

  const silence = (failFast: FailFastCause | null = null): RoutedSearchAnswer => {
    const latency = latencyOf(t0, retrieveMs, { llmMs, verifyMs }, routeStages());
    const why = explainSilence({
      hitCount: hits.length,
      failFast,
      indexedChunks: opts?.indexedChunks,
      modelError: firstError,
      modelDeclined,
      // What the composer said about the hits it read. Only its silence is
      // reported; a composer that spoke was already returned as the answer.
      local: localAttempt && !localAttempt.card.say ? localAttempt.card : null,
    });
    return failedCard(query, why, t0, retrieveMs, routeStages(), progressiveFor("silent", latency.totalMs, null));
  };

  const failFast = failFastCause(query, hits);
  if (failFast) return silence(failFast);

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

  // The offline composer's answer, when it has one. Used as the last resort
  // and, crucially, when the model cannot be reached at all (no key, network
  // down): a cited answer from the files beats "API key required".
  const localFallback = () => {
    if (!localAttempt) return null;
    const local = localCardRouteFromAttempt(
      query,
      t0,
      retrieveMs,
      localAttempt,
      routeStages(),
      progressiveFor("localCard", Math.round(performance.now() - t0), localAttempt.say),
    );
    return local
      ? { ...local, progressive: progressiveFor("localCard", local.latency.totalMs, local.card.say) }
      : null;
  };

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
  if (grounded.reason === "insufficient") modelDeclined = true;
  if (isTransportError(grounded)) {
    const local = localFallback();
    if (local) return local;
    return silence();
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
    // An uncited or unverified synthesis is the model declining too: it read
    // the hits and produced nothing that may be said.
    if (synthesized.ok || synthesized.reason === "insufficient") modelDeclined = true;
    if (isTransportError(synthesized)) {
      const local = localFallback();
      if (local) return local;
      return silence();
    }
  }

  const local = localFallback();
  if (local) return local;

  return silence();
}
