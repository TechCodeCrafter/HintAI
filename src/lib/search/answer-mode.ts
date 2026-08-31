export type AnswerMode = "grounded" | "polished" | "assisted";

export const ANSWER_MODES: ReadonlyArray<{
  id: AnswerMode;
  label: string;
  hint: string;
}> = [
  {
    id: "grounded",
    label: "Grounded",
    hint: "Use when you need proof. Speaks only a line already in your files, and stays silent if nothing matches.",
  },
  {
    id: "polished",
    label: "Polished",
    hint: "Use when the file has the answer but the wording is too raw to say in the room. Same citation, clearer sentence.",
  },
  {
    id: "assisted",
    label: "Assisted",
    hint: "Use when you still want a suggestion if your material is silent. Marks it as general knowledge — verify before using.",
  },
];

export function modeLabel(mode: AnswerMode): string {
  switch (mode) {
    case "grounded":
      return "From your docs";
    case "polished":
      return "Polished from your docs";
    case "assisted":
      return "Suggested";
  }
}

export function modeColor(mode: AnswerMode): "green" | "purple" | "blue" {
  switch (mode) {
    case "grounded":
      return "green";
    case "polished":
      return "purple";
    case "assisted":
      return "blue";
  }
}

export function isAnswerMode(value: string | null | undefined): value is AnswerMode {
  return value === "grounded" || value === "polished" || value === "assisted";
}

/**
 * What the LLM layer may do after evidence has already run.
 * Evidence always wins when it speaks. Document cards never polish.
 */
export function nextAnswerAction(input: {
  mode: AnswerMode;
  evidenceSpeaks: boolean;
  mayPolish: boolean;
}): "grounded" | "polish" | "assist" {
  if (input.evidenceSpeaks) {
    return input.mode === "polished" && input.mayPolish ? "polish" : "grounded";
  }
  return input.mode === "assisted" ? "assist" : "grounded";
}
