export type AnswerMode = "grounded" | "polished" | "assisted";

export const ANSWER_MODES: ReadonlyArray<{
  id: AnswerMode;
  label: string;
  hint: string;
}> = [
  { id: "grounded", label: "Grounded", hint: "Exact citations from your material only" },
  { id: "polished", label: "Polished", hint: "Your material, rewritten to sound natural" },
  { id: "assisted", label: "Assisted", hint: "Suggests answers when your material is silent" },
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
