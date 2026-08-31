"use client";

import { ANSWER_MODES, modeLabel, type AnswerMode } from "@/lib/search/answer-mode";
import { cn } from "@/lib/cn";
import { useGround } from "@/lib/store";

export function AnswerModeControl() {
  const mode = useGround((s) => s.answerMode);
  const setAnswerMode = useGround((s) => s.setAnswerMode);

  function pick(next: AnswerMode) {
    setAnswerMode(next);
  }

  return (
    <div
      className="answer-mode-control"
      role="group"
      aria-label="Answer mode"
    >
      {ANSWER_MODES.map((item) => {
        const on = mode === item.id;
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={on}
            title={item.hint}
            data-mode={item.id}
            data-testid={`mode-${item.id}`}
            data-active={on ? "true" : undefined}
            className={cn("answer-mode-option", `is-${item.id}`, on && "is-on")}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              pick(item.id);
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              pick(item.id);
            }}
          >
            <span className={cn("answer-mode-dot", `is-${item.id}`)} aria-hidden="true" />
            <span>{item.label}</span>
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
