export type AnswerMode = "docs" | "synthesized" | "generated";

export function modeLabel(mode?: AnswerMode, usedEvidence?: boolean): string {
  if (mode === "generated" || (mode === "synthesized" && usedEvidence === false)) {
    return "Generated · not from your files";
  }
  if (mode === "synthesized") return "Synthesized";
  return "From your files";
}

export function receiptKicker(mode?: AnswerMode, usedEvidence?: boolean): string {
  return modeLabel(mode, usedEvidence);
}
