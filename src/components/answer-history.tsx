import { useState, type MouseEvent } from "react";
import { Copy } from "lucide-react";
import { AnswerModeBadge } from "@/components/answer-mode-control";
import { Button } from "@/components/ui/button";
import { answerModeFromBadge, type AnswerHistoryItem } from "@/lib/search/answer-history";
import { useMeetHint } from "@/lib/store";

function historyPreview(item: AnswerHistoryItem): string {
  return item.say ?? "Could not generate an answer.";
}

function formatHistoryTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function AnswerHistory({ items }: { items?: AnswerHistoryItem[] }) {
  const sessionHistory = useMeetHint((s) => s.answerHistory);
  const restoreAnswer = useMeetHint((s) => s.restoreAnswer);
  const history = items ?? sessionHistory;
  const [open, setOpen] = useState(false);
  const previous = history.slice(1);

  if (previous.length === 0) return null;

  return (
    <div className="answer-history" data-testid="answer-history">
      <button
        type="button"
        className="history-toggle"
        data-testid="answer-history-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Hide" : "Show"} {previous.length} previous {previous.length === 1 ? "answer" : "answers"}
      </button>
      {open ? (
        <div className="history-list" data-testid="answer-history-list">
          {previous.map((item) => (
            <HistoryRow key={item.id} item={item} onRestore={() => restoreAnswer(item.id)} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function HistoryRow({
  item,
  onRestore,
}: {
  item: AnswerHistoryItem;
  onRestore: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function copyAnswer(event: MouseEvent) {
    event.stopPropagation();
    if (!item.say) return;
    void navigator.clipboard.writeText(item.say);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div className="history-item" data-testid="answer-history-item">
      <button type="button" className="history-item-main" onClick={onRestore}>
        <div className="history-query">{item.query}</div>
        <div className="history-answer">{historyPreview(item)}</div>
        <div className="history-meta">
          {item.badge ? <AnswerModeBadge mode={answerModeFromBadge(item.badge)} /> : null}
          <span className="history-time">{formatHistoryTime(item.timestamp)}</span>
        </div>
      </button>
      {item.say ? (
        <Button type="button" variant="quiet" size="sm" className="history-copy" onClick={copyAnswer}>
          <Copy className="size-3.5" />
          {copied ? "Copied" : "Copy"}
        </Button>
      ) : null}
    </div>
  );
}
