import { modeLabel } from "@/lib/search/answer-mode";

export function AnswerModeBadge() {
  return (
    <span data-testid="card-badge" className="answer-mode-badge">
      {modeLabel()}
    </span>
  );
}
