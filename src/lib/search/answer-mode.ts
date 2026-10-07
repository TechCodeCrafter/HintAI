export type AnswerMode = "docs" | "synthesized" | "generated" | "general";

/** A general-knowledge fallback answer: not from the user's files, clearly labeled. */
export function isGeneralAnswer(mode?: AnswerMode): boolean {
  return mode === "general";
}

/** Legacy history only — live Search never produces generated or uncited cards. */
export function isGeneratedAnswer(mode?: AnswerMode, usedEvidence?: boolean): boolean {
  return mode === "generated" || mode === "general" || (mode === "synthesized" && usedEvidence === false);
}

export function modeLabel(mode?: AnswerMode, usedEvidence?: boolean): string {
  if (mode === "general") return "General knowledge";
  if (isGeneratedAnswer(mode, usedEvidence)) return "Not from your files";
  return "From your files";
}

export function receiptKicker(mode?: AnswerMode, usedEvidence?: boolean): string {
  return modeLabel(mode, usedEvidence);
}

/** Resolve the evidence flag the badge and footer both use. */
export function cardUsedEvidence(card: { usedEvidence?: boolean; citations: { length: number } }): boolean {
  if (card.usedEvidence === true) return true;
  if (card.usedEvidence === false) return false;
  return card.citations.length > 0;
}
