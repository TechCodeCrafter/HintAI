export type AnswerMode = "docs";

/** Every live card is extracted from a file you brought. */
export function modeLabel(_mode?: AnswerMode): string {
  return "From your files";
}
