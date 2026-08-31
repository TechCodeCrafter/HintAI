import { ANSWER_MODES, modeLabel, type AnswerMode } from "@/lib/search/answer-mode";
import { cn } from "@/lib/cn";
import { useGround } from "@/lib/store";

export function AnswerModeControl() {
  const mode = useGround((s) => s.answerMode);
  const setAnswerMode = useGround((s) => s.setAnswerMode);

  return (
    <div
      className="answer-mode-control"
      role="radiogroup"
      aria-label="Answer mode"
    >
      {ANSWER_MODES.map((item) => {
        const on = mode === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={on}
            title={item.hint}
            data-mode={item.id}
            data-testid={`mode-${item.id}`}
            data-active={on ? "true" : undefined}
            className={cn("answer-mode-option", on && "is-on")}
            onClick={() => setAnswerMode(item.id)}
          >
            <span className={cn("answer-mode-dot", `is-${item.id}`)} aria-hidden="true" />
            <span className="hidden md:inline">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function AnswerModeBadge({ mode }: { mode: AnswerMode }) {
  return (
    <span data-testid="card-badge" className={cn("answer-mode-badge", `is-${mode}`)}>
      <span className={cn("answer-mode-dot", `is-${mode}`)} aria-hidden="true" />
      {modeLabel(mode)}
    </span>
  );
}
