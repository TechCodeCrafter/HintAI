import { Check, ClipboardList, Copy, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { citationChipText } from "@/lib/search/cite";
import type { AnswerHistoryItem } from "@/lib/search/answer-history";
import {
  buildSessionReceipt,
  formatSessionReceiptText,
  isReceiptAnswer,
} from "@/lib/search/session-receipt";

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function SessionReceiptPanel({
  open,
  onClose,
  spaceName,
  history,
}: {
  open: boolean;
  onClose: () => void;
  spaceName: string;
  history: AnswerHistoryItem[];
}) {
  const receipt = useMemo(
    () => buildSessionReceipt(history, spaceName),
    [history, spaceName],
  );
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  async function copyReceipt() {
    await navigator.clipboard.writeText(formatSessionReceiptText(receipt));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  function downloadReceipt() {
    const blob = new Blob([formatSessionReceiptText(receipt)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `meethint-receipt-${spaceName.replace(/\s+/g, "-").toLowerCase()}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-sm border border-line bg-surface shadow-lg"
        role="dialog"
        aria-labelledby="session-receipt-title"
        aria-modal="true"
        data-testid="session-receipt-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 space-y-1">
            <p id="session-receipt-title" className="text-base font-semibold text-fg">
              Session receipt
            </p>
            <p className="text-sm text-muted">
              {spaceName} · {receipt.answeredCount} cited · {receipt.unsupportedCount} unsupported
            </p>
          </div>
          <button
            type="button"
            className="rounded-sm p-1 text-muted hover:bg-hover hover:text-fg"
            aria-label="Close session receipt"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-auto px-5 py-4">
          {receipt.entries.length === 0 ? (
            <p className="text-sm text-muted">No questions recorded yet. Ask during Live to build a receipt.</p>
          ) : (
            receipt.entries.map((entry, index) => {
              const { item } = entry;
              const cited = isReceiptAnswer(item);
              return (
                <article
                  key={item.id}
                  className="answer-receipt"
                  data-testid={cited ? "session-receipt-answered" : "session-receipt-unsupported"}
                >
                  <div className="answer-receipt-body space-y-3">
                    <div>
                      <p className="receipt-kicker">
                        {index + 1}. {formatTime(item.timestamp)}
                      </p>
                      <p className="mt-1 text-[15px] font-semibold text-fg">“{item.query}”</p>
                    </div>
                    {cited ? (
                      <>
                        <p className="text-sm leading-relaxed text-body">{item.say}</p>
                        {item.citations.length > 0 ? (
                          <ul className="answer-receipt-cites">
                            {item.citations.map((cite) => (
                              <li key={cite.evidenceId ?? citationChipText(cite)} className="cite-chip">
                                <Check className="size-3.5 shrink-0 text-ok" aria-hidden="true" />
                                <span className="cite-status">Verified</span>
                                <span className="break-all font-mono text-[12px] text-fg">
                                  {citationChipText(cite)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </>
                    ) : (
                      <p className="text-sm text-muted">
                        Not supported — no cited evidence in authorized material.
                      </p>
                    )}
                  </div>
                </article>
              );
            })
          )}
        </div>

        <div className="flex flex-wrap gap-2 border-t border-line px-5 py-4">
          <Button
            variant="primary"
            size="sm"
            data-testid="session-receipt-copy"
            disabled={receipt.entries.length === 0}
            onClick={() => void copyReceipt()}
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : "Copy for customer"}
          </Button>
          <Button
            variant="quiet"
            size="sm"
            data-testid="session-receipt-download"
            disabled={receipt.entries.length === 0}
            onClick={downloadReceipt}
          >
            <ClipboardList className="size-3.5" />
            Download .txt
          </Button>
        </div>
      </div>
    </div>
  );
}
