import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { Card } from "@/lib/repo/types";
import { citationText } from "@/lib/search/cite";
import { OverlayPrefsControl, useOverlayPrefs } from "@/components/overlay-prefs-control";
import { EvidenceCard } from "@/components/evidence-view";
import { WhyAnswer } from "@/components/why-answer";
import { LexicalOnlyNote } from "@/components/lexical-only-note";
import { type SessionWire, watchSessionWire } from "@/lib/store/session-wire";

export const Route = createFileRoute("/relay")({ component: RelayPage });

declare global {
  interface Window {
    /** What this second screen last drew, for measuring how far behind the cockpit it runs. */
    __meethintRelay?: { seq: number | null; latencyMs: number | null; shown: number };
  }
}

function RelayPage() {
  const [wire, setWire] = useState<SessionWire | null>(null);
  const [prefs, setPrefs] = useOverlayPrefs();
  // The first read is whatever was already on the wire (a reload, a late
  // open). Only a card that arrives after it is timed against the cockpit.
  const primed = useRef(false);
  const shown = useRef(0);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  useEffect(() => watchSessionWire(setWire), []);

  useEffect(() => {
    if (!wire) return;
    const live = primed.current;
    primed.current = true;
    const latency = live && typeof wire.at === "number" ? Math.max(0, Date.now() - wire.at) : null;
    shown.current += 1;
    setLatencyMs(latency);
    window.__meethintRelay = { seq: wire.seq ?? null, latencyMs: latency, shown: shown.current };
  }, [wire]);

  const card: Card | null = wire?.card ?? null;
  const armed = wire?.armed ?? false;

  return (
    <div className="flex min-h-dvh w-full max-w-full flex-col overflow-x-hidden bg-bg px-5 py-8 text-fg">
      <header className="mb-6 flex items-center justify-between text-xs text-muted">
        <span className="brand-word text-[17px] text-fg">Hint</span>
        <span className="text-muted">{armed ? "Armed" : "Idle"} · phone card</span>
      </header>
      {/* Announced politely and never focused: a card arriving must not take
          the keyboard away from the meeting. */}
      <div className="relay-dock" data-position={prefs.position} data-testid="relay-dock">
        <EvidenceCard
          card={card}
          className="relay-card"
          style={{ opacity: prefs.opacity }}
          aria-live="polite"
          data-testid="relay-card"
          data-seq={wire?.seq ?? ""}
          data-latency-ms={latencyMs ?? ""}
        >
          {card?.say ? (
            <div className="space-y-8">
              <p className="text-3xl font-medium leading-tight tracking-tight" data-testid="relay-say">
                {card.say}
              </p>
              <ul className="space-y-3 font-mono text-sm text-muted">
                {/* Relay has no source pane. Citations stay text — including PDFs. */}
                {card.citations.map((c) => (
                  <li key={c.evidenceId ?? citationText(c)} className="min-w-0" data-testid="relay-citation">
                    <span className="block break-all text-fg">{citationText(c)}</span>
                    <span className="mt-1 block break-words text-xs">{c.label}</span>
                  </li>
                ))}
              </ul>
              <WhyAnswer card={card} />
              <LexicalOnlyNote card={card} />
            </div>
          ) : card?.reason ? (
            <div className="space-y-3">
              <p className="text-sm text-muted">Nothing to say for “{card.query}”.</p>
              <p className="text-lg text-body" data-testid="relay-reason">
                {card.reason}
              </p>
              <LexicalOnlyNote card={card} />
            </div>
          ) : (
            <p className="text-lg text-muted" data-testid="relay-empty">
              No card. Search from the cockpit and this screen follows.
            </p>
          )}
        </EvidenceCard>
      </div>
      <footer className="mt-8 flex flex-wrap items-center justify-between gap-4">
        <OverlayPrefsControl prefs={prefs} onChange={setPrefs} />
        <Link to="/app" className="text-sm text-faint hover:text-fg">
          Back to cockpit
        </Link>
      </footer>
    </div>
  );
}
