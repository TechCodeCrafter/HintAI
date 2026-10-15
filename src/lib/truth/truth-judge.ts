import type { QuestionClass } from "./question-classes.ts";

/** Bounded applicability — not final VERIFIED / cite-or-silence truth. */
export type ApplicabilityDecision = "APPLICABLE" | "NOT_APPLICABLE";

/** Experimental escalation hint — does not replace answer-route tiers. */
export type EscalationDecision =
  | "ANSWER_WITH_CURRENT_PIPELINE"
  | "ESCALATE"
  | "SILENT";

export interface JudgeTiming {
  provider: string;
  latencyMs: number;
}

export interface QuestionClassificationInput {
  question: string;
  /** Prior utterances oldest-first (optional). */
  context?: string[];
}

export interface QuestionClassificationResult extends JudgeTiming {
  class: QuestionClass;
  confidence?: number;
  /** Per-class probabilities when the provider returns them (e.g. Jev choice). */
  probabilities?: Partial<Record<QuestionClass, number>>;
}

export interface CandidateEvidence {
  path: string;
  text: string;
  score?: number;
  sourceId?: string;
}

export interface EvidenceApplicabilityInput {
  question: string;
  evidence: CandidateEvidence;
}

export interface JudgeResult extends JudgeTiming {
  decision: ApplicabilityDecision;
  confidence?: number;
}

export interface EscalationInput {
  question: string;
  topEvidence: CandidateEvidence[];
}

export interface EscalationResult extends JudgeTiming {
  decision: EscalationDecision;
  confidence?: number;
}

/**
 * Provider-independent bounded judge contract.
 * Advises only — never sets VERIFIED / CONFLICTING / final cite-or-silence outcomes.
 */
export interface TruthJudge {
  readonly provider: string;

  classifyQuestion(input: QuestionClassificationInput): Promise<QuestionClassificationResult>;

  assessApplicability(input: EvidenceApplicabilityInput): Promise<JudgeResult>;

  assessEscalation(input: EscalationInput): Promise<EscalationResult>;
}

export type TruthJudgeKind = "deterministic" | "jev" | "llm";
