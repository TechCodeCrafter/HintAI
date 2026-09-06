export type AnswerMode = "docs" | "synthesized" | "generated";

export function modeLabel(mode?: AnswerMode): string {
  if (mode === "generated") return "Generated · not from your files";
  if (mode === "synthesized") return "Synthesized";
  return "From your files";
}

export function receiptKicker(mode?: AnswerMode): string {
  if (mode === "generated") return "Generated · not from your files";
  if (mode === "synthesized") return "Synthesized";
  return "From your files";
}
