import { modeLabel, type AnswerMode } from "@/lib/search/answer-mode";

export function AnswerModeBadge({ mode }: { mode?: AnswerMode }) {
  const kind = mode === "synthesized" ? "synthesized" : mode === "generated" ? "generated" : "from-docs";
  return (
    <span data-testid="card-badge" data-kind={kind} className={`answer-mode-badge badge-${kind}`}>
      {modeLabel(mode)}
    </span>
  );
}
