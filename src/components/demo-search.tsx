import { Check, Search } from "lucide-react";
import { useState } from "react";
import { AnswerSay } from "@/components/answer-say";
import { Button } from "@/components/ui/button";
import { DEMO_QUESTIONS, demoAnswer } from "@/lib/demo/answer";
import { citationText, citedLineRange, isDocumentCitation, isFileCitation } from "@/lib/search/cite";
import { receiptKicker } from "@/lib/search/answer-mode";
import type { Card } from "@/lib/repo/types";

/**
 * Search-only demo. The sample pack is in the page, so the first click can
 * cite a line without an account, a microphone prompt, or an index wait.
 */
export function DemoSearch() {
  const [query, setQuery] = useState("");
  const [card, setCard] = useState<Card | null>(null);

  function ask(question: string) {
    const next = question.trim();
    if (!next) return;
    setQuery(next);
    setCard(demoAnswer(next));
  }

  const speaking = Boolean(card?.say);

  return (
    <section className="mx-auto w-full max-w-2xl space-y-6 px-4 py-10" data-testid="demo-search">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Try a question on the sample repo</h1>
        <p className="text-sm leading-relaxed text-body">
          This is the built-in payments repository. Search only. No account, and the microphone stays off.
        </p>
      </div>

      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          ask(query);
        }}
      >
        <textarea
          data-testid="search-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              ask(query);
            }
          }}
          rows={2}
          placeholder={DEMO_QUESTIONS[0]}
          className="ground-input ground-question w-full"
        />
        <Button type="submit" size="sm" className="min-w-28">
          <Search className="size-3.5" />
          Search
        </Button>
      </form>

      <div className="flex flex-wrap gap-2" data-testid="demo-chips">
        {DEMO_QUESTIONS.map((question) => (
          <button
            key={question}
            type="button"
            data-testid="demo-chip"
            onClick={() => ask(question)}
            className="ground-chip text-xs"
          >
            {question}
          </button>
        ))}
      </div>

      {card ? (
        <article className="answer-receipt" data-testid="card">
          <div className="answer-receipt-body">
            <div className="min-w-0">
              <p className="receipt-kicker">They asked</p>
              <p className="mt-2 text-lg font-semibold leading-snug text-fg">“{card.query}”</p>
            </div>
            <div className="space-y-3">
              <p className="receipt-kicker receipt-kicker-accent">
                {speaking
                  ? receiptKicker(card.answerMode, card.usedEvidence ?? card.citations.length > 0)
                  : "Nothing to cite"}
              </p>
              {card.say ? <AnswerSay text={card.say} /> : <p className="text-sm text-body">{card.reason}</p>}
            </div>
            {speaking && card.citations.length > 0 ? (
              <ul className="answer-receipt-cites" data-testid="demo-cite">
                {card.citations.map((cite) => {
                  const range = citedLineRange(cite);
                  const lines =
                    range == null
                      ? null
                      : range.startLine === range.endLine
                        ? `line ${range.startLine}`
                        : `lines ${range.startLine}–${range.endLine}`;
                  const path = isFileCitation(cite) || isDocumentCitation(cite) ? cite.path : citationText(cite);
                  return (
                    <li key={cite.evidenceId ?? citationText(cite)} className="cite-chip">
                      <Check className="size-3.5 shrink-0 text-ok" aria-hidden="true" />
                      <span className="cite-status">Verified</span>
                      <span className="break-all font-mono text-xs text-fg">{path}</span>
                      {lines ? <span className="font-mono text-xs text-fg">{lines}</span> : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        </article>
      ) : null}
    </section>
  );
}
