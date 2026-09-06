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
