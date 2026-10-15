import { shouldFailFastRetrieval } from "../search/answer-fast-path.ts";
import { textEvidence, verifyClaim } from "../search/evidence.ts";
import { evidenceFitsShape, shapeOf } from "../search/intent.ts";
import { isArchitectureQuery } from "../search/question.ts";
import { contentWords } from "../search/spoken.ts";
import type { Hit } from "../repo/types.ts";
import type { QuestionClass } from "./question-classes.ts";
import {
  type ApplicabilityDecision,
  type EscalationDecision,
  type EscalationInput,
  type EscalationResult,
  type EvidenceApplicabilityInput,
  type JudgeResult,
  type QuestionClassificationInput,
  type QuestionClassificationResult,
  type TruthJudge,
} from "./truth-judge.ts";

const EXTERNAL_FACT =
  /\b(weather|stock price|capital of|who won|score of|temperature today|exchange rate)\b/i;
const SECURITY =
  /\b(auth(entication)?|authorize|security|encrypt|gdpr|soc\s*2|hipaa|pci|secret|credential|session cookie|oauth)\b/i;
const SLA = /\b(sla|uptime guarantee|contract|terms of service|liability|indemnif)\b/i;
const PRICING = /\b(price|pricing|plan|subscription|billing|invoice|seat|tier|cost)\b/i;
const CAPABILITY = /\b(what does|what is the purpose|what can|capabilities|responsible for)\b/i;

function elapsed(start: number): number {
  return Math.round(performance.now() - start);
}

/** Keyword + shape heuristics aligned with existing MeetHint gates — experimental only. */
export function classifyQuestionDeterministic(question: string): QuestionClass {
  const q = question.trim();
  const lower = q.toLowerCase();
  if (EXTERNAL_FACT.test(lower)) return "current_external_fact";
  if (PRICING.test(lower)) return "pricing_packaging";
  if (SLA.test(lower)) return "contractual_sla";
  if (SECURITY.test(lower)) return "security_compliance";
  if (isArchitectureQuery(q) || /\b(architecture|system design|components|layout)\b/i.test(lower)) {
    return "architecture";
  }
  if (CAPABILITY.test(lower)) return "product_capability";
  const shape = shapeOf(q);
  if (shape === "where" || shape === "how" || /\b(implement|function|class|module|file)\b/i.test(lower)) {
    return "implementation";
  }
  if (shape === "why" || shape === "failure") return "general_technical_reasoning";
  return "other";
}

/** Overlap + shape + verifyClaim on first speakable sentence from evidence. */
export function assessApplicabilityDeterministic(input: EvidenceApplicabilityInput): ApplicabilityDecision {
  const { question, evidence } = input;
  if (EXTERNAL_FACT.test(question)) return "NOT_APPLICABLE";

  const shape = shapeOf(question);
  const terms = contentWords(question);
  const body = evidence.text.toLowerCase();
  const overlap = terms.filter((term) => body.includes(term.toLowerCase())).length;

  const firstSentence = evidence.text.split(/(?<=[.!?])\s+/).find((s) => s.trim().length >= 12)?.trim();
  const claim = firstSentence ?? evidence.text;
  const shapeOk = evidenceFitsShape(shape, claim);
  if (overlap === 0 && !shapeOk) return "NOT_APPLICABLE";

  if (firstSentence) {
    const start = evidence.text.indexOf(firstSentence);
    const span =
      start >= 0
        ? textEvidence({
            path: evidence.path,
            content: evidence.text,
            start,
            end: start + firstSentence.length,
            normalizedText: evidence.text,
          })
        : null;
    if (span && verifyClaim(firstSentence, [span]).ok && (overlap >= 1 || shapeOk)) {
      return "APPLICABLE";
    }
  }

  if (overlap >= 2 && shapeOk) return "APPLICABLE";
  if (overlap >= 3) return "APPLICABLE";
  return "NOT_APPLICABLE";
}

export function assessEscalationDeterministic(input: EscalationInput): EscalationDecision {
  const hits = input.topEvidence.map((row, index) => ({
    id: `hit-${index}`,
    path: row.path,
    text: row.text,
    score: row.score ?? (input.topEvidence.length - index),
    sourceId: row.sourceId ?? row.path,
  })) as Hit[];

  if (shouldFailFastRetrieval(input.question, hits)) return "SILENT";

  const top = hits[0];
  const topScore = top?.score ?? 0;
  if (topScore >= 4 && contentWords(input.question).length > 0) {
    const terms = contentWords(input.question);
    const corpus = hits.map((h) => h.text ?? "").join(" ").toLowerCase();
    const overlap = terms.filter((t) => corpus.includes(t.toLowerCase())).length;
    if (overlap >= 1) return "ANSWER_WITH_CURRENT_PIPELINE";
  }

  if (topScore >= 2) return "ESCALATE";
  return "SILENT";
}

export class DeterministicTruthJudge implements TruthJudge {
  readonly provider = "deterministic";

  async classifyQuestion(input: QuestionClassificationInput): Promise<QuestionClassificationResult> {
    const t0 = performance.now();
    const question = [input.context?.join(" "), input.question].filter(Boolean).join(" ").trim();
    return {
      provider: this.provider,
      latencyMs: elapsed(t0),
      class: classifyQuestionDeterministic(question || input.question),
      confidence: 1,
    };
  }

  async assessApplicability(input: EvidenceApplicabilityInput): Promise<JudgeResult> {
    const t0 = performance.now();
    const decision = assessApplicabilityDeterministic(input);
    return {
      provider: this.provider,
      latencyMs: elapsed(t0),
      decision,
      confidence: decision === "APPLICABLE" ? 0.85 : 0.9,
    };
  }

  async assessEscalation(input: EscalationInput): Promise<EscalationResult> {
    const t0 = performance.now();
    const decision = assessEscalationDeterministic(input);
    return {
      provider: this.provider,
      latencyMs: elapsed(t0),
      decision,
      confidence: 0.8,
    };
  }
}
