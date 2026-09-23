/** Experimental truth-judge taxonomy — not wired to production routing. */
export const QUESTION_CLASSES = [
  "product_capability",
  "architecture",
  "implementation",
  "security_compliance",
  "contractual_sla",
  "pricing_packaging",
  "general_technical_reasoning",
  "current_external_fact",
  "other",
] as const;

export type QuestionClass = (typeof QUESTION_CLASSES)[number];

export function isQuestionClass(value: string): value is QuestionClass {
  return (QUESTION_CLASSES as readonly string[]).includes(value);
}
