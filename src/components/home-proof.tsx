import { Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useLayoutEffect } from "react";
import { Button } from "@/components/ui/button";
import { AUTH_SERVICE_LINE, AUTH_SERVICE_PATH, HOME_TRY_QUESTION } from "@/lib/repo/northstar";
import { useMeetHint } from "@/lib/store";

export function HomeProof() {
  const typedQuery = useMeetHint((s) => s.typedQuery);
  const setTypedQuery = useMeetHint((s) => s.setTypedQuery);
  const search = useMeetHint((s) => s.search);
  const searching = useMeetHint((s) => s.searching);
  const ready = useMeetHint((s) => s.contextStatus === "ready" && s.pack.id === "northstar-payments");
  const card = useMeetHint((s) => s.card);
  const speaking = Boolean(card?.say);

  useLayoutEffect(() => {
    const store = useMeetHint.getState();
    store.resetPack();
    store.setTypedQuery(HOME_TRY_QUESTION);
  }, []);

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
          placeholder={HOME_TRY_QUESTION}
          className="ground-input ground-question w-full"
        />
        <Button type="submit" size="sm" className="min-w-28" disabled={!ready || searching}>
          <Search className="size-3.5" />
          {searching ? "Searching…" : "Search"}
        </Button>
      </form>

      <button
        type="button"
        data-testid="home-try-question"
        disabled={!ready || searching}
        onClick={() => void search(HOME_TRY_QUESTION)}
        className="text-left text-sm text-body hover:text-fg disabled:opacity-40"
      >
        Try: '{HOME_TRY_QUESTION}'
      </button>

      {speaking ? (
        <article className="mh-panel space-y-4 p-5" data-testid="card">
          <p data-testid="card-say" className="font-serif text-xl leading-snug text-fg md:text-2xl">
            {card?.say}
          </p>
          {card && card.latencyMs > 0 ? (
            <p className="text-xs text-muted tabular-nums">Found in {card.latencyMs} ms</p>
          ) : null}
          <p data-testid="home-proof-cite" className="text-sm text-body">
            This line came from {AUTH_SERVICE_PATH} line {AUTH_SERVICE_LINE}.{" "}
            <Link to="/create" className="text-accent underline-offset-4 hover:underline">
              Load your own folder
            </Link>{" "}
            to ask about your code.
          </p>
        </article>
      ) : null}
    </section>
  );
}
