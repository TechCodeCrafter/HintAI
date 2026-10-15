import { QUESTION_CLASSES, type QuestionClass, isQuestionClass } from "./question-classes.ts";
import { callJev, jevConfigured, readJevChoice, readJevNoul } from "./jev-client.ts";
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

const CLASS_CRITERIA = Object.fromEntries(
  QUESTION_CLASSES.map((key) => [key, key.replace(/_/g, " ")]),
) as Record<QuestionClass, string>;

export class JevTruthJudge implements TruthJudge {
  readonly provider = "jev";

  static available(): boolean {
    return jevConfigured();
  }

  async classifyQuestion(input: QuestionClassificationInput): Promise<QuestionClassificationResult> {
    const t0 = performance.now();
    const response = await callJev({
      state: {
        question: input.question,
        context: input.context ?? [],
      },
      questions: {
        question_class: {
          type: "choice",
          instructions:
            "Classify the user question for a technical meeting assistant that answers only from connected files.",
          criteria: CLASS_CRITERIA,
        },
      },
    });

    const parsed = readJevChoice(response.answers?.question_class);
    const raw = parsed.choice ?? "other";
    const className = isQuestionClass(raw) ? raw : "other";

    return {
      provider: this.provider,
      latencyMs: elapsed(t0),
      class: className,
      confidence: parsed.confidence,
      probabilities: parsed.probabilities as Partial<Record<QuestionClass, number>> | undefined,
    };
  }

  async assessApplicability(input: EvidenceApplicabilityInput): Promise<JudgeResult> {
    const t0 = performance.now();
    const response = await callJev({
      state: {
        question: input.question,
        evidence_path: input.evidence.path,
        evidence_excerpt: input.evidence.text.slice(0, 2000),
      },
      questions: {
        applicable: {
          type: "noul",
          instructions:
            "Is this evidence excerpt directly applicable to answering the question from connected material? Ignore world knowledge outside the excerpt.",
          criteria: {
            true: "The excerpt contains facts that could support a cited answer to the question.",
            false: "The excerpt is irrelevant, wrong topic, wrong file role, or only tangentially related.",
          },
        },
      },
    });

    const noul = readJevNoul(response.answers?.applicable) ?? 0;
    return {
      provider: this.provider,
      latencyMs: elapsed(t0),
      decision: noul >= 0.5 ? "APPLICABLE" : "NOT_APPLICABLE",
      confidence: noul,
    };
  }

  async assessEscalation(input: EscalationInput): Promise<EscalationResult> {
    const t0 = performance.now();
    const response = await callJev({
      state: {
        question: input.question,
        top_evidence: input.topEvidence.slice(0, 5).map((row) => ({
          path: row.path,
          score: row.score,
          excerpt: row.text.slice(0, 800),
        })),
      },
      questions: {
        escalation: {
          type: "choice",
          instructions:
            "Given retrieved evidence, what should a cite-or-silence assistant do next? Never invent facts not in evidence.",
          criteria: {
            ANSWER_WITH_CURRENT_PIPELINE:
              "Evidence strongly supports a local cited answer without heavier synthesis.",
            ESCALATE: "Evidence is partial or ambiguous — needs stronger synthesis or multi-source handling.",
            SILENT: "Evidence does not support answering; stay silent rather than guess.",
          },
        },
      },
    });

    const esc = readJevChoice(response.answers?.escalation);
    const choice = esc.choice;
    const decision =
      choice === "ANSWER_WITH_CURRENT_PIPELINE" || choice === "ESCALATE" || choice === "SILENT"
        ? choice
        : "ESCALATE";

    return {
      provider: this.provider,
      latencyMs: elapsed(t0),
      decision,
      confidence: esc.confidence,
    };
  }
}
