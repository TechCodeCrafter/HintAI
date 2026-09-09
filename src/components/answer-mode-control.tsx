import { modeLabel, type AnswerMode } from "@/lib/search/answer-mode";

export function AnswerModeBadge({ mode, usedEvidence }: { mode?: AnswerMode; usedEvidence?: boolean }) {
  const label = modeLabel(mode, usedEvidence);
  const kind = label.startsWith("Generated") ? "generated" : mode === "synthesized" ? "synthesized" : "from-docs";
  return (
    <span data-testid="card-badge" data-kind={kind} className={`answer-mode-badge badge-${kind}`}>
      {label}
    </span>
  );
}
