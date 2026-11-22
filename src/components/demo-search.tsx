import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AnswerSay } from "@/components/answer-say";
import { MeetHintMark } from "@/components/meethint-mark";
import { Button } from "@/components/ui/button";
import { MEETHINT_NAME } from "@/lib/brand";
import { DEMO_QUESTIONS, demoAnswer } from "@/lib/demo/answer";
import { citationText, citedLineRange, isDocumentCitation, isFileCitation } from "@/lib/search/cite";
import type { Card } from "@/lib/repo/types";
import { ConsideredSources } from "@/components/considered-sources";

/**
 * Search-only demo. The sample pack is in the page, so the first click can
 * cite a line without an account, a microphone prompt, or an index wait.
 */
export function DemoSearch() {
  const [query, setQuery] = useState("");
  const [card, setCard] = useState<Card | null>(null);
  const cardRef = useRef<HTMLElement>(null);

  function ask(question: string) {
    const next = question.trim();
    if (!next) return;
    setQuery(next);
    setCard(demoAnswer(next));
  }

  useEffect(() => {
    if (!card) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    cardRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest" });
  }, [card]);

  const speaking = Boolean(card?.say);
  const close = !card
    ? {
        title: "Want this on the files you get asked about?",
        body: "The sample shows the rule. Sign in and add a repo, PDF, deck, or doc. You get the line, or it stays quiet.",
      }
    : speaking
      ? {
          title: "That was our repo. Walk in with yours.",
          body: "Sign in and add what your team actually uses. The card cites the line, with the file beside it.",
        }
      : {
          title: "It stayed quiet.",
          body: "That question is not in the sample, so there is nothing to say. On your files, you get the line or you get silence.",
        };

  return (
    <div className="min-h-dvh bg-bg text-fg" data-testid="demo-search">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2 text-fg">
            <MeetHintMark className="size-6" />
            <span className="text-sm font-semibold tracking-tight">{MEETHINT_NAME}</span>
          </Link>
          <p className="text-xs text-muted">Sample</p>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 sm:py-14">
        <div className="max-w-xl space-y-3">
          <p className="ds-overline">No account</p>
          <h1 className="ds-display">Ask the sample.</h1>
          <p className="ds-body">
            A payments repository is already loaded. You get a cited line, or silence.
          </p>
        </div>

        <section className="ds-surface-elevated">
          <div className="border-b border-line px-5 py-4">
            <p className="ds-card-title">Payments repository</p>
            <p className="ds-caption mt-1">Search only. The microphone stays off.</p>
          </div>
          <form
            className="space-y-4 px-5 py-5"
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
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex flex-wrap gap-2" data-testid="demo-chips">
                {DEMO_QUESTIONS.map((question) => (
                  <button
                    key={question}
                    type="button"
                    data-testid="demo-chip"
                    data-current={query === question ? "true" : undefined}
                    aria-pressed={query === question}
                    onClick={() => ask(question)}
                    className="ground-chip text-xs"
                  >
                    {question}
                  </button>
                ))}
              </div>
              <Button type="submit" size="sm" className="w-full shrink-0 sm:w-auto sm:min-w-28">
                <Search className="size-3.5" />
                Search
              </Button>
            </div>
          </form>
        </section>

        {card ? (
          <article
            key={`${card.query}:${card.say ?? "quiet"}`}
            ref={cardRef}
            className="ds-surface-elevated demo-arrive overflow-hidden"
            data-testid="card"
            aria-live="polite"
          >
            <div className={speaking ? "h-0.5 bg-accent" : "h-0.5 bg-line"} aria-hidden="true" />
            <div className="answer-receipt-body">
              <div className="min-w-0">
                <p className="receipt-kicker">They asked</p>
                <p className="mt-2 text-lg font-semibold leading-snug text-fg">“{card.query}”</p>
              </div>
              <div className="space-y-3">
                <p className="receipt-kicker receipt-kicker-accent">
                  {speaking ? "From the sample" : "Nothing to cite"}
                </p>
                {card.say ? <AnswerSay text={card.say} /> : <p className="ds-body">{card.reason}</p>}
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
              {/* The demo has no file viewer, so these are stated and not clickable. */}
              <ConsideredSources sources={card.considered ?? []} silent={!speaking} />
            </div>
          </article>
        ) : null}

        <aside className="ds-surface-elevated" data-testid="demo-close">
          <div className="flex flex-col gap-5 border-l-2 border-accent px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
            <div className="min-w-0 space-y-1">
              <p className="receipt-kicker">Your files</p>
              <p className="ds-section-title">{close.title}</p>
              <p className="ds-body">{close.body}</p>
            </div>
            <Link
              to="/home"
              data-testid="demo-own-files"
              className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-on-accent transition-[background-color,transform] duration-150 ease-out hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:outline-none active:scale-[0.98] sm:w-auto"
            >
              Try it on your files
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
        </aside>
      </main>
    </div>
  );
}
