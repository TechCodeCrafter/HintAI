"use client";

import * as Tooltip from "@radix-ui/react-tooltip";
import { ANSWER_MODES, modeLabel, type AnswerMode } from "@/lib/search/answer-mode";
import { cn } from "@/lib/cn";
import { useGround } from "@/lib/store";

export function AnswerModeControl() {
  const mode = useGround((s) => s.answerMode);
  const setAnswerMode = useGround((s) => s.setAnswerMode);

  return (
    <Tooltip.Provider delayDuration={200} skipDelayDuration={120}>
      <div className="answer-mode-control" role="group" aria-label="Answer mode">
        {ANSWER_MODES.map((item) => {
          const on = mode === item.id;
          return (
            <Tooltip.Root key={item.id}>
              <Tooltip.Trigger asChild>
                <button
                  type="button"
                  aria-pressed={on}
                  data-mode={item.id}
                  data-testid={`mode-${item.id}`}
                  data-active={on ? "true" : undefined}
                  className={cn("answer-mode-option", on && "is-on")}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setAnswerMode(item.id);
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setAnswerMode(item.id);
                  }}
                >
                  {item.label}
                </button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content
                  className="answer-mode-tooltip"
                  side="top"
                  align="center"
                  sideOffset={8}
                  data-testid={`mode-${item.id}-tip`}
                >
                  <p className="answer-mode-tooltip-title">{item.label}</p>
                  <p>{item.hint}</p>
                  <Tooltip.Arrow className="answer-mode-tooltip-arrow" />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          );
        })}
      </div>
    </Tooltip.Provider>
  );
}

export function AnswerModeBadge({ mode }: { mode: AnswerMode | "grounded" | "polished" | "assisted" }) {
  return (
    <span data-testid="card-badge" className="answer-mode-badge">
      {modeLabel(mode)}
    </span>
  );
}
