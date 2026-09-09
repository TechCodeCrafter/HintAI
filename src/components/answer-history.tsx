import { useState, type MouseEvent } from "react";
import { Copy } from "lucide-react";
import { AnswerModeBadge } from "@/components/answer-mode-control";
import { Button } from "@/components/ui/button";
import { VerifiedCitations } from "@/components/verified-citations";
import type { Citation } from "@/lib/repo/types";
import { isDocumentCitation, isFileCitation } from "@/lib/search/cite";
import { answerModeFromBadge, type AnswerHistoryItem } from "@/lib/search/answer-history";
import { useMeetHint } from "@/lib/store";

function historyPreview(item: AnswerHistoryItem): string {
  return item.say ?? "Could not generate an answer.";
}

function formatHistoryTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function AnswerHistory({
  items,
  onOpenCited,
  overlay = false,
}: {
  items?: AnswerHistoryItem[];
  onOpenCited?: (cite: Citation) => void;
  overlay?: boolean;
}) {
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
            <HistoryRow
              key={item.id}
              item={item}
              onRestore={() => restoreAnswer(item.id)}
              onOpenCited={onOpenCited}
              overlay={overlay}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function HistoryRow({
  item,
  onRestore,
  onOpenCited,
  overlay = false,
}: {
  item: AnswerHistoryItem;
  onRestore: () => void;
  onOpenCited?: (cite: Citation) => void;
  overlay?: boolean;
}) {
  const overlayOn = useMeetHint((s) => s.overlay);
  const setOpenFile = useMeetHint((s) => s.setOpenFile);
  const openDocumentCitation = useMeetHint((s) => s.openDocumentCitation);
  const [copied, setCopied] = useState(false);

  function copyAnswer(event: MouseEvent) {
    event.stopPropagation();
    if (!item.say) return;
    void navigator.clipboard.writeText(item.say);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  function openCited(cite: Citation) {
    if (onOpenCited) {
      onOpenCited(cite);
      return;
    }
    if (isFileCitation(cite)) {
      setOpenFile(cite.path);
      return;
    }
    if (isDocumentCitation(cite) && !overlayOn) openDocumentCitation(cite);
  }

  const cites = item.badge === "generated" ? [] : item.citations;
  const hideOverlay = overlay || overlayOn;

  return (
    <div className="history-item" data-testid="answer-history-item">
      <div className="history-item-body">
        <button type="button" className="history-item-main" onClick={onRestore}>
          <div className="history-query">{item.query}</div>
          <div className="history-answer">{historyPreview(item)}</div>
          <div className="history-meta">
            {item.badge ? <AnswerModeBadge mode={answerModeFromBadge(item.badge)} /> : null}
            <span className="history-time">{formatHistoryTime(item.timestamp)}</span>
          </div>
        </button>
        {cites.length > 0 ? (
          <div className="history-cites">
            <VerifiedCitations citations={cites} overlay={hideOverlay} onOpenCited={openCited} />
          </div>
        ) : null}
      </div>
      {item.say ? (
        <Button type="button" variant="quiet" size="sm" className="history-copy" onClick={copyAnswer}>
          <Copy className="size-3.5" />
          {copied ? "Copied" : "Copy"}
        </Button>
      ) : null}
    </div>
  );
}
