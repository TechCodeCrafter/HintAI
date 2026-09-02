import { Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useLayoutEffect } from "react";
import { Button } from "@/components/ui/button";
import { HOME_PROOF_CHIPS } from "@/lib/repo/northstar";
import { citationText } from "@/lib/search/cite";
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
        <article className="mh-panel space-y-4 p-5" data-testid="card">
          <p data-testid="card-say" className="font-serif text-xl leading-snug text-fg md:text-2xl">
            {card?.say}
          </p>
          {card && card.latencyMs > 0 ? (
            <p className="text-xs text-muted tabular-nums">Found in {card.latencyMs} ms</p>
          ) : null}
          {card && card.citations.length > 0 ? (
            <p data-testid="home-proof-cite" className="text-sm text-body">
              {card.citations.map((cite) => citationText(cite)).join(" · ")}
            </p>
          ) : null}
        </article>
      ) : null}
    </section>
  );
}
