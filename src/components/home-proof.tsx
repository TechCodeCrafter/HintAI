import { Link } from "@tanstack/react-router";
import { Check, Search } from "lucide-react";
import { useLayoutEffect } from "react";
import { AnswerSay } from "@/components/answer-say";
import { Button } from "@/components/ui/button";
import { HOME_PROOF_CHIPS } from "@/lib/repo/northstar";
import { citationText, citedLineRange, isDocumentCitation, isFileCitation } from "@/lib/search/cite";
import { useMeetHint } from "@/lib/store";

export function HomeProof() {
  const typedQuery = useMeetHint((s) => s.typedQuery);
  const setTypedQuery = useMeetHint((s) => s.setTypedQuery);
  const search = useMeetHint((s) => s.search);
  const searching = useMeetHint((s) => s.searching);
  const ready = useMeetHint((s) => s.contextStatus === "ready" && s.pack.id === "northstar-payments");
  const card = useMeetHint((s) => s.card);
  const speaking = Boolean(card?.say);
  const firstChip = HOME_PROOF_CHIPS[0];

  useLayoutEffect(() => {
    const store = useMeetHint.getState();
    store.resetPack();
    store.setTypedQuery(firstChip);
  }, [firstChip]);

  function ask(question: string) {
    setTypedQuery(question);
    void search(question);
  }

  return (
    <section className="space-y-5" data-testid="home-proof">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <textarea
          data-testid="search-input"
          value={typedQuery}
          onChange={(event) => setTypedQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void search();
            }
          }}
          rows={2}
          placeholder={firstChip}
          className="ground-input ground-question w-full"
        />
        <Button type="submit" size="sm" className="min-w-28" disabled={!ready || searching}>
          <Search className="size-3.5" />
          {searching ? "Searching…" : "Search"}
        </Button>
      </form>

      <div className="flex flex-wrap gap-2" data-testid="home-proof-chips">
        {HOME_PROOF_CHIPS.map((question) => (
          <button
            key={question}
            type="button"
            data-testid="home-proof-chip"
            disabled={!ready || searching}
            onClick={() => ask(question)}
            className="ground-chip text-xs disabled:opacity-40"
          >
            {question}
          </button>
        ))}
      </div>

      <p className="text-sm text-muted" data-testid="home-proof-hint">
        <Link to="/app" className="text-body underline-offset-4 hover:text-fg hover:underline">
          Load your own folder from the repo pane →
        </Link>
      </p>

      {speaking ? (
        <article className="answer-receipt" data-testid="card">
          <div className="answer-receipt-body">
            {card?.query ? (
              <div className="min-w-0">
                <p className="receipt-kicker">They asked</p>
                <p className="mt-2 text-[17px] font-semibold leading-snug text-fg">“{card.query}”</p>
              </div>
            ) : null}
            <div className="space-y-3">
              <p className="receipt-kicker receipt-kicker-accent">From your material</p>
              {card?.say ? <AnswerSay text={card.say} /> : null}
              {card && card.latencyMs > 0 ? (
                <p className="text-xs text-muted tabular-nums">Found in {(card.latencyMs / 1000).toFixed(2)}s</p>
              ) : null}
            </div>
            {card && card.citations.length > 0 ? (
              <ul className="answer-receipt-cites" data-testid="home-proof-cite">
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
                      <span className="break-all font-mono text-[12px] text-fg">{path}</span>
                      {lines ? <span className="font-mono text-[12px] text-fg">{lines}</span> : null}
                      <span className="sr-only">{citationText(cite)}</span>
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
