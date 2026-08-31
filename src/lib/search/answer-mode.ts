export type AnswerMode = "docs" | "free";

export const ANSWER_MODES: ReadonlyArray<{
  id: AnswerMode;
  label: string;
  hint: string;
}> = [
  {
    id: "docs",
    label: "From my docs",
    hint: "Retrieve your material, then write a spoken answer. Cites a source when the files cover it.",
  },
  {
    id: "free",
    label: "Freely",
    hint: "Write a spoken answer from general knowledge. No citations.",
  },
];

export function modeLabel(mode: AnswerMode | "grounded" | "polished" | "assisted"): string {
  if (mode === "free" || mode === "assisted") return "Generated";
  return "From your docs";
}

export function isAnswerMode(value: string | null | undefined): value is AnswerMode {
  return value === "docs" || value === "free";
}

/** Older sessions stored the three-mode names. */
export function readStoredAnswerMode(value: string | null | undefined): AnswerMode {
  if (value === "free" || value === "assisted") return "free";
  if (value === "docs" || value === "grounded" || value === "polished") return "docs";
  return "docs";
}

/**
 * Live search always generates. This only decides whether retrieval may cite.
 */
export function shouldCiteFromDocs(mode: AnswerMode): boolean {
  return mode === "docs";
}
