export type AnswerMode = "docs" | "synthesized" | "generated";

export function modeLabel(mode?: AnswerMode): string {
  if (mode === "synthesized") return "Synthesized";
  if (mode === "generated") return "Generated";
  return "From your docs";
}

export function receiptKicker(mode?: AnswerMode): string {
  if (mode === "synthesized") return "Synthesized";
  if (mode === "generated") return "Generated";
  return "From your docs";
}
