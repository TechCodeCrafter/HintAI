import { completeChat } from "../ai/synthesis-client.ts";
import { getDefaultModel } from "../ai/models.ts";
import { QUESTION_CLASSES, isQuestionClass } from "./question-classes.ts";
import type {
  EscalationInput,
  EscalationResult,
  EvidenceApplicabilityInput,
  JudgeResult,
  QuestionClassificationInput,
  QuestionClassificationResult,
  TruthJudge,
} from "./truth-judge.ts";

function elapsed(start: number): number {
  return Math.round(performance.now() - start);
}

function llmKeyAvailable(): boolean {
  if (typeof window !== "undefined") return false;
  return Boolean(
    process.env.OPENAI_API_KEY?.trim() ||
      process.env.ANTHROPIC_API_KEY?.trim() ||
      process.env.XAI_API_KEY?.trim(),
  );
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1) return {};
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const SYSTEM =
  "You are a bounded decision judge for MeetHint experiments. Respond with JSON only — no prose, no markdown fences. Never generate final user-facing answers.";

export class LLMTruthJudge implements TruthJudge {
  readonly provider = "llm";

  static available(): boolean {
    return llmKeyAvailable();
  }

  private async decide(user: string): Promise<{ body: Record<string, unknown>; latencyMs: number }> {
    const t0 = performance.now();
    const model = getDefaultModel();
    const completion = await completeChat(SYSTEM, user, model, undefined, 12000, 256);
    const text = typeof completion === "string" ? completion : completion.raw ?? "";
    return { body: parseJsonObject(text), latencyMs: elapsed(t0) };
  }

  async classifyQuestion(input: QuestionClassificationInput): Promise<QuestionClassificationResult> {
    const { body, latencyMs } = await this.decide(
      JSON.stringify({
        task: "question_classification",
        classes: QUESTION_CLASSES,
        question: input.question,
        context: input.context ?? [],
        output: { class: "one of classes", confidence: "0-1" },
      }),
    );
    const raw = String(body.class ?? "other");
    return {
      provider: this.provider,
      latencyMs,
      class: isQuestionClass(raw) ? raw : "other",
      confidence: typeof body.confidence === "number" ? body.confidence : undefined,
    };
  }

  async assessApplicability(input: EvidenceApplicabilityInput): Promise<JudgeResult> {
    const { body, latencyMs } = await this.decide(
      JSON.stringify({
        task: "evidence_applicability",
        question: input.question,
        evidence: { path: input.evidence.path, text: input.evidence.text.slice(0, 2000) },
        output: { decision: "APPLICABLE or NOT_APPLICABLE", confidence: "0-1" },
      }),
    );
    const decision = body.decision === "APPLICABLE" ? "APPLICABLE" : "NOT_APPLICABLE";
    return {
      provider: this.provider,
      latencyMs,
      decision,
      confidence: typeof body.confidence === "number" ? body.confidence : undefined,
    };
  }

  async assessEscalation(input: EscalationInput): Promise<EscalationResult> {
    const { body, latencyMs } = await this.decide(
      JSON.stringify({
        task: "escalation",
        question: input.question,
        top_evidence: input.topEvidence.slice(0, 5).map((row) => ({
          path: row.path,
          score: row.score,
          text: row.text.slice(0, 800),
        })),
        output: {
          decision: "ANSWER_WITH_CURRENT_PIPELINE | ESCALATE | SILENT",
          confidence: "0-1",
        },
      }),
    );
    const raw = String(body.decision ?? "ESCALATE");
    const decision =
      raw === "ANSWER_WITH_CURRENT_PIPELINE" || raw === "ESCALATE" || raw === "SILENT" ? raw : "ESCALATE";
    return {
      provider: this.provider,
      latencyMs,
      decision,
      confidence: typeof body.confidence === "number" ? body.confidence : undefined,
    };
  }
}
