import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AnswerSay } from "@/components/answer-say";
import { AnswerModeBadge } from "@/components/answer-mode-control";
import { ContextShell } from "@/components/context-shell";
import { VerifiedCitations } from "@/components/verified-citations";
import { cardUsedEvidence } from "@/lib/search/answer-mode";
import { useAccountVaultReady } from "@/lib/auth/account-session";
import { useMeetHint } from "@/lib/store";

export function AskPanel({ spaceId }: { spaceId: string }) {
  const { ready: vaultReady } = useAccountVaultReady();
  const activeSpaceId = useMeetHint((s) => s.activeSpaceId);
  const pack = useMeetHint((s) => s.pack);
  const card = useMeetHint((s) => s.card);
  const searching = useMeetHint((s) => s.searching);
  const contextStatus = useMeetHint((s) => s.contextStatus);
  const search = useMeetHint((s) => s.search);
  const setOpenFile = useMeetHint((s) => s.setOpenFile);
  const openDocumentCitation = useMeetHint((s) => s.openDocumentCitation);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!vaultReady) return;
    void useMeetHint.getState().activateSpace(spaceId);
  }, [spaceId, vaultReady]);

  const ready = contextStatus === "ready" && activeSpaceId === spaceId;

  return (
    <ContextShell>
      <main className="mh-rise mx-auto max-w-2xl space-y-8 pb-16 pt-8">
        <div className="space-y-2">
          <p className="mh-eyebrow">Ask</p>
          <h1 className="mh-display text-4xl sm:text-5xl">{pack.name}</h1>
          <p className="text-sm text-muted">
            Questions search every authorized source in this Knowledge Space.
          </p>
        </div>

        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            const text = query.trim();
            if (!text || !ready) return;
            void search(text);
          }}
        >
          <label className="sr-only" htmlFor="ask-query">
            Question
          </label>
          <textarea
            id="ask-query"
            data-testid="ask-query"
            rows={3}
            value={query}
            disabled={!ready || searching}
            placeholder={ready ? "Ask about this Knowledge Space…" : "Loading sources…"}
            className="w-full rounded-sm border border-line bg-surface px-3 py-2 text-sm text-fg"
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button type="submit" data-testid="ask-submit" className="mh-cta" disabled={!ready || searching || !query.trim()}>
              {searching ? "Searching…" : "Ask"}
            </button>
            <Link
              to="/context/$id/live"
              params={{ id: spaceId }}
              className="inline-flex h-11 items-center justify-center rounded-sm border border-line px-4 text-xs font-medium text-secondary hover:border-accent hover:text-fg"
            >
              Start live session
            </Link>
            <Link
              to="/context/$id"
              params={{ id: spaceId }}
              className="inline-flex h-11 items-center justify-center rounded-sm border border-line px-4 text-xs font-medium text-secondary hover:border-accent hover:text-fg"
            >
              Open Knowledge Space
            </Link>
          </div>
        </form>

        {card?.query ? (
          <article className="mh-panel space-y-4 p-5" data-testid="ask-card">
            <p className="text-xs text-muted">{card.query}</p>
            {card.say ? (
              <AnswerSay text={card.say} />
            ) : (
              <p className="text-sm text-muted">{card.reason ?? "No cited answer."}</p>
            )}
            {card.answerMode ? (
              <AnswerModeBadge mode={card.answerMode} usedEvidence={cardUsedEvidence(card)} />
            ) : null}
            <VerifiedCitations
              citations={card.citations}
              onOpenCited={(cite) => {
                if (cite.kind === "file") setOpenFile(cite.path);
                if (cite.kind === "document") openDocumentCitation(cite);
              }}
            />
          </article>
        ) : null}
      </main>
    </ContextShell>
  );
}
